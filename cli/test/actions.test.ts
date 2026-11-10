import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { compile, describe, type Action } from "../src/actions.ts";
import { compilePolicy } from "../src/policy.ts";
import { chainById } from "../src/config.ts";
import { erc20Abi, positionManagerAbi, SEL } from "../src/abi.ts";
import { poolAddress } from "../src/v3.ts";

const chain = chainById(97);
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const wbnb = chain.assets.find((a) => a.symbol === "WBNB")!;
const usdt = chain.assets.find((a) => a.symbol === "USDT")!;
const scope = compilePolicy(chain, { nativeCap: "0.2", tokens: [{ symbol: "WBNB", cap: "0.5" }, { symbol: "USDT", cap: "500" }] }, 1800000000).scope;
const opts = { scope, keyId8: "abcd1234", positions: {} };
const [t0, t1] = BigInt(wbnb.address) < BigInt(usdt.address) ? [wbnb, usdt] : [usdt, wbnb];
const enter: Action[] = [
  { type: "wrap", amount: "0.05" },
  { type: "swap", tokenIn: "WBNB", tokenOut: "USDT", fee: 500, amountIn: "0.025", minAmountOut: "1" },
  { type: "mint", token0: t0.symbol, token1: t1.symbol, fee: 500, tickLower: -60000, tickUpper: -50000, amount0Desired: "0.02", amount1Desired: "0.02" },
];

test("enter batch: exact approvals sit right before their use, recipients are the wallet", () => {
  const calls = compile(chain, wallet, enter, 1900000000);
  assert.deepEqual(calls.map((c) => c.data.slice(0, 10)), [SEL.deposit, SEL.approve, SEL.pancakeSwap, SEL.approve, SEL.approve, SEL.mint]);
  assert.equal(calls[0].value, 5n * 10n ** 16n);
  const d = describe(chain, wallet, calls, opts);
  assert.deepEqual(d.violations, []);
  assert.equal(d.kind, "lp");
  assert.equal(d.ruleKey, `sovereign:97:abcd1234:lp:${poolAddress(chain, wbnb.address, usdt.address, 500).toLowerCase()}`);
  assert.match(d.sentence, /On BNB Chain testnet, from wallet 0x1111\.\.\.1111: wrap 0\.05 tBNB; swap 0\.025 WBNB for at least 1 USDT/);
  assert.match(d.sentence, /Exact approvals in this batch/);
  assert.match(d.sentence, /Always lets the agent run future batches for this pool/);
});

test("the same input always encodes the same batch", () => {
  assert.deepEqual(compile(chain, wallet, enter, 1900000000), compile(chain, wallet, enter, 1900000000));
});

test("a swap-only batch gets a swap key, and a different pool gets a different key", () => {
  const d = describe(chain, wallet, compile(chain, wallet, [enter[1]], 1), opts);
  assert.equal(d.kind, "swap");
  assert.equal(d.ruleKey, "sovereign:97:abcd1234:swap:WBNB:USDT");
  const other = describe(chain, wallet, compile(chain, wallet, [{ ...(enter[2] as any), fee: 2500, tickLower: -60000, tickUpper: -50000 }], 1), opts);
  assert.notEqual(other.ruleKey, describe(chain, wallet, compile(chain, wallet, [enter[2]], 1), opts).ruleKey);
});

test("a raw transfer is described from its calldata and never gets a reusable key", () => {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [other, 5n * 10n ** 18n] });
  const calls = compile(chain, wallet, [{ type: "raw", to: usdt.address, data }], 1);
  const a = describe(chain, wallet, calls, opts);
  const b = describe(chain, wallet, calls, opts);
  assert.equal(a.kind, "raw");
  assert.deepEqual(a.violations, []);
  assert.match(a.sentence, /transfer 5 USDT to 0x2222222222222222222222222222222222222222/);
  assert.match(a.sentence, /expected to refuse it/);
  assert.match(a.ruleKey, /^sovereign:97:once:/);
  assert.notEqual(a.ruleKey, b.ruleKey);
});

test("a raw call that the session covers is refused", () => {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [other, 1n] });
  const d = describe(chain, wallet, compile(chain, wallet, [{ type: "raw", to: usdt.address, data }], 1), opts);
  assert.ok(d.violations.some((v) => /neither the PancakeSwap V3 router nor its position manager/.test(v)));
});

test("hand-built calls with a foreign recipient or spender are flagged", () => {
  const collect = encodeFunctionData({ abi: positionManagerAbi, functionName: "collect", args: [{ tokenId: 7n, recipient: other, amount0Max: 1n, amount1Max: 1n }] });
  const d = describe(chain, wallet, [{ to: chain.dex.positionManager, data: collect, value: 0n }], opts);
  assert.ok(d.violations.some((v) => /not to the wallet/.test(v)));
  assert.match(d.ruleKey, /:once:/);
});

test("an unknown position never gets a reusable key; a cached one does", () => {
  const exit: Action[] = [
    { type: "decrease", tokenId: "42", token0: t0.symbol, token1: t1.symbol, liquidity: "1000" },
    { type: "collect", tokenId: "42" },
    { type: "burn", tokenId: "42" },
  ];
  const calls = compile(chain, wallet, exit, 1);
  assert.match(describe(chain, wallet, calls, opts).ruleKey, /:once:/);
  const known = describe(chain, wallet, calls, { ...opts, positions: { "42": { token0: t0.address, token1: t1.address, fee: 500, tickLower: -60000, tickUpper: -50000, liquidity: "1000" } } });
  assert.equal(known.kind, "lp");
  assert.match(known.sentence, /remove all liquidity from position #42 \((WBNB\/USDT|USDT\/WBNB) 0\.05%\)/);
});

test("bad actions are refused before anything is encoded", () => {
  assert.throws(() => compile(chain, wallet, [], 1), /empty/);
  assert.throws(() => compile(chain, wallet, [{ type: "swap", tokenIn: "WBNB", tokenOut: "DOGE", fee: 500, amountIn: "1", minAmountOut: "1" }], 1), /asset list/);
  assert.throws(() => compile(chain, wallet, [{ type: "swap", tokenIn: "WBNB", tokenOut: "USDT", fee: 3000, amountIn: "1", minAmountOut: "1" }], 1), /no 0.3% fee tier/);
  assert.throws(() => compile(chain, wallet, [{ ...(enter[2] as any), tickLower: -60005 }], 1), /multiples of 10/);
  assert.throws(() => compile(chain, wallet, [{ ...(enter[2] as any), token0: t1.symbol, token1: t0.symbol }], 1), /lower address/);
  assert.throws(() => compile(chain, wallet, [enter[0], { type: "raw", to: usdt.address, data: "0x" }], 1), /cannot share a batch/);
  assert.throws(() => compile(chain, wallet, [enter[0], { type: "transfer", token: "USDT", to: other, amount: "1" }], 1), /cannot share a batch/);
});

test("Uniswap batches use the SwapRouter02 struct", () => {
  const sep = chainById(11155111);
  const calls = compile(sep, wallet, [{ type: "swap", tokenIn: "WETH", tokenOut: "USDC", fee: 500, amountIn: "0.01", minAmountOut: "1" }], 1);
  assert.equal(calls[1].data.slice(0, 10), SEL.uniswapSwap);
  const sepScope = compilePolicy(sep, { nativeCap: "0.05", tokens: [{ symbol: "WETH", cap: "0.1" }, { symbol: "USDC", cap: "200" }] }, 1800000000).scope;
  const d = describe(sep, wallet, calls, { scope: sepScope, keyId8: "abcd1234", positions: {} });
  assert.deepEqual(d.violations, []);
  assert.match(d.sentence, /swap 0\.01 WETH for at least 1 USDC on Uniswap V3 \(0\.05% pool\)/);
});

test("a transfer action encodes a plain token or native send, which the V3 LP scope does not cover", () => {
  const token = compile(chain, wallet, [{ type: "transfer", token: "USDT", to: other, amount: "5" }], 1);
  assert.equal(token[0].to, usdt.address);
  assert.equal(token[0].data.slice(0, 10), SEL.transfer);
  const d = describe(chain, wallet, token, opts);
  assert.equal(d.kind, "raw");
  assert.deepEqual(d.violations, []);
  assert.match(d.sentence, /transfer 5 USDT to 0x2222222222222222222222222222222222222222\. The session does not cover this call/);
  const coin = compile(chain, wallet, [{ type: "transfer", token: "tBNB", to: other, amount: "0.01" }], 1);
  assert.deepEqual(coin, [{ to: other, data: "0x", value: 10n ** 16n }]);
  assert.match(describe(chain, wallet, coin, opts).sentence, /send 0\.01 tBNB to 0x2222222222222222222222222222222222222222/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePolicy, presetFor } from "../src/policy.ts";
import { chainById } from "../src/config.ts";
import { SEL } from "../src/abi.ts";

test("preset compiles to explicit calls and per-token caps on BNB testnet", () => {
  const chain = chainById(97);
  const p = compilePolicy(chain, { nativeCap: "0.2", tokens: [{ symbol: "WBNB", cap: "0.5" }, { symbol: "USDT", cap: "500" }] }, 1800000000);
  const calls = p.permissions.calls as { to: string; signature: string }[];
  assert.equal(calls.length, 10);
  assert.ok(calls.every((c) => c.to && c.signature && c.signature.startsWith("0x") && c.signature.length === 10));
  assert.ok(calls.some((c) => c.to === chain.dex.router && c.signature === SEL.pancakeSwap));
  assert.ok(!calls.some((c) => c.signature === SEL.transfer));
  const spend = p.permissions.spend as { token?: string; limit: bigint }[];
  assert.equal(spend.length, 3);
  assert.equal(spend[0].token, undefined);
  assert.equal(spend[0].limit, 2n * 10n ** 17n);
  assert.equal(spend[2].limit, 500n * 10n ** 18n);
});

test("decimals follow the network: USDC has 6 on Sepolia and 18 on BNB Chain", () => {
  const sep = compilePolicy(chainById(11155111), { nativeCap: "0.05", tokens: [{ symbol: "WETH", cap: "0.1" }, { symbol: "USDC", cap: "200" }] }, 1800000000);
  assert.equal((sep.permissions.spend as any[])[2].limit, 200n * 10n ** 6n);
  assert.ok((sep.permissions.calls as any[]).some((c) => c.signature === SEL.uniswapSwap));
  const bnb = compilePolicy(chainById(56), { nativeCap: "0.03", tokens: [{ symbol: "USDC", cap: "30" }] }, 1800000000);
  assert.equal((bnb.permissions.spend as any[])[1].limit, 30n * 10n ** 18n);
});

test("bad input is refused", () => {
  const chain = chainById(97);
  assert.throws(() => compilePolicy(chain, { nativeCap: "0", tokens: [{ symbol: "WBNB", cap: "1" }] }, 1), /greater than zero/);
  assert.throws(() => compilePolicy(chain, { nativeCap: "1", tokens: [] }, 1), /at least one token/);
  assert.throws(() => compilePolicy(chain, { nativeCap: "1", tokens: [{ symbol: "DOGE", cap: "1" }] }, 1), /not in this plugin's asset list/);
  assert.throws(() => compilePolicy(chain, { nativeCap: "1", tokens: [{ symbol: "WBNB", cap: "1" }, { symbol: "wbnb", cap: "2" }] }, 1), /listed twice/);
});

test("every chain's preset names real assets", () => {
  for (const id of [97, 11155111, 56, 1]) {
    const chain = chainById(id);
    const preset = presetFor(chain);
    const input = { nativeCap: preset.native.cap, tokens: preset.tokens.filter((t) => t.checked).map((t) => ({ symbol: t.symbol, cap: t.cap })) };
    const p = compilePolicy(chain, input, 1800000000);
    assert.ok(p.scopeText.length >= 7);
  }
});

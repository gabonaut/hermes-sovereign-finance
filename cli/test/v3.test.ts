import { test } from "node:test";
import assert from "node:assert/strict";
import { SEL } from "../src/abi.ts";
import { sqrtRatioAtTick, Q96, amountsForLiquidity, liquidityForAmounts, poolAddress, floorToSpacing, ceilToSpacing, tickSpacingFor } from "../src/v3.ts";
import { chainById, rpc } from "../src/config.ts";
import { factoryAbi, pancakePoolAbi, uniswapPoolAbi } from "../src/abi.ts";

test("selectors match the deployed contracts", () => {
  assert.equal(SEL.mint, "0x88316456");
  assert.equal(SEL.increaseLiquidity, "0x219f5d17");
  assert.equal(SEL.decreaseLiquidity, "0x0c49ccbe");
  assert.equal(SEL.collect, "0xfc6f7865");
  assert.equal(SEL.burn, "0x42966c68");
  assert.equal(SEL.pancakeSwap, "0x414bf389");
  assert.equal(SEL.uniswapSwap, "0x04e45aaf");
  assert.equal(SEL.approve, "0x095ea7b3");
  assert.equal(SEL.transfer, "0xa9059cbb");
  assert.equal(SEL.deposit, "0xd0e30db0");
  assert.equal(SEL.withdraw, "0x2e1a7d4d");
});

test("tick math endpoints", () => {
  assert.equal(sqrtRatioAtTick(0), Q96);
  assert.equal(sqrtRatioAtTick(-887272), 4295128739n);
  assert.equal(sqrtRatioAtTick(887272), 1461446703485210103287273052203988822378723970342n);
});

test("spacing helpers", () => {
  assert.equal(floorToSpacing(-15, 10), -20);
  assert.equal(ceilToSpacing(-15, 10), -10);
  assert.equal(floorToSpacing(25, 10), 20);
  assert.equal(ceilToSpacing(25, 10), 30);
});

test("liquidity round trip", () => {
  const sqrtP = sqrtRatioAtTick(100);
  const L = liquidityForAmounts(sqrtP, -600, 600, 10n ** 18n, 10n ** 18n);
  const [a0, a1] = amountsForLiquidity(sqrtP, -600, 600, L);
  assert.ok(a0 <= 10n ** 18n && a1 <= 10n ** 18n);
  assert.ok(a0 > 9n * 10n ** 17n || a1 > 9n * 10n ** 17n);
});

// Live reads: the offline pool address must equal factory.getPool, and slot0 must agree with our tick math.
for (const [chainId, a, b, fee] of [
  [97, "WBNB", "USDT", 500],
  [11155111, "WETH", "USDC", 500],
  [56, "WBNB", "USDT", 500],
  [1, "WETH", "USDC", 500],
] as const) {
  test(`pool address and slot0 on chain ${chainId}`, async () => {
    const chain = chainById(chainId);
    const ta = chain.assets.find((x) => x.symbol === a)!;
    const tb = chain.assets.find((x) => x.symbol === b)!;
    const expected = await rpc(chain).readContract({ address: chain.dex.factory, abi: factoryAbi, functionName: "getPool", args: [ta.address, tb.address, fee] });
    assert.equal(poolAddress(chain, ta.address, tb.address, fee).toLowerCase(), expected.toLowerCase());
    const abi = chain.dex.kind === "pancake" ? pancakePoolAbi : uniswapPoolAbi;
    const [slot0, spacing] = await Promise.all([
      rpc(chain).readContract({ address: expected, abi, functionName: "slot0" }),
      rpc(chain).readContract({ address: expected, abi, functionName: "tickSpacing" }),
    ]);
    const [sqrtP, tick] = slot0 as readonly [bigint, number];
    assert.ok(sqrtRatioAtTick(tick) <= sqrtP && sqrtP < sqrtRatioAtTick(tick + 1), "slot0 tick and sqrt price agree with sqrtRatioAtTick");
    assert.equal(Number(spacing), tickSpacingFor(chain, fee));
  });
}

// Uniswap V3 math shared by PancakeSwap V3: ticks, prices, liquidity amounts, pool addresses.
import { encodeAbiParameters, getContractAddress, keccak256, type Address } from "viem";
import type { Chain, Asset } from "./config.ts";

export const Q96 = 1n << 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const MAX_UINT256 = (1n << 256n) - 1n;

export function tickSpacingFor(chain: Chain, fee: number): number {
  const table: Record<string, Record<number, number>> = {
    pancake: { 100: 1, 500: 10, 2500: 50, 10000: 200 },
    uniswap: { 100: 1, 500: 10, 3000: 60, 10000: 200 },
  };
  const spacing = table[chain.dex.kind]?.[fee];
  if (!spacing) throw new Error(`${chain.dex.name} has no ${fee / 10000}% fee tier. Tiers: ${chain.dex.feeTiers.map((f) => `${f / 10000}%`).join(", ")}`);
  return spacing;
}

/** TickMath.getSqrtRatioAtTick, exact. */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new Error(`Tick ${tick} is out of range`);
  const abs = BigInt(Math.abs(tick));
  let ratio = (abs & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const steps: [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, mul] of steps) if ((abs & bit) !== 0n) ratio = (ratio * mul) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/** Amounts of token0 and token1 held by `liquidity` in [tickLower, tickUpper) at the current sqrt price. */
export function amountsForLiquidity(sqrtP: bigint, tickLower: number, tickUpper: number, liquidity: bigint): [bigint, bigint] {
  const a = sqrtRatioAtTick(tickLower);
  const b = sqrtRatioAtTick(tickUpper);
  const amount0 = (lo: bigint, hi: bigint) => (((liquidity << 96n) * (hi - lo)) / hi) / lo;
  const amount1 = (lo: bigint, hi: bigint) => (liquidity * (hi - lo)) / Q96;
  if (sqrtP <= a) return [amount0(a, b), 0n];
  if (sqrtP < b) return [amount0(sqrtP, b), amount1(a, sqrtP)];
  return [0n, amount1(a, b)];
}

/** LiquidityAmounts.getLiquidityForAmounts. */
export function liquidityForAmounts(sqrtP: bigint, tickLower: number, tickUpper: number, amount0: bigint, amount1: bigint): bigint {
  const a = sqrtRatioAtTick(tickLower);
  const b = sqrtRatioAtTick(tickUpper);
  const l0 = (lo: bigint, hi: bigint) => (amount0 * ((lo * hi) / Q96)) / (hi - lo);
  const l1 = (lo: bigint, hi: bigint) => (amount1 * Q96) / (hi - lo);
  if (sqrtP <= a) return l0(a, b);
  if (sqrtP < b) {
    const x = l0(sqrtP, b);
    const y = l1(a, sqrtP);
    return x < y ? x : y;
  }
  return l1(a, b);
}

/** token1 per token0 in human units, from a sqrt price. */
export function priceFromSqrt(sqrtP: bigint, dec0: number, dec1: number): number {
  const r = Number(sqrtP) / 2 ** 96;
  return r * r * 10 ** (dec0 - dec1);
}
export function priceFromTick(tick: number, dec0: number, dec1: number): number {
  return 1.0001 ** tick * 10 ** (dec0 - dec1);
}
export function tickFromPrice(price: number, dec0: number, dec1: number): number {
  return Math.floor(Math.log(price / 10 ** (dec0 - dec1)) / Math.log(1.0001));
}
export const floorToSpacing = (tick: number, spacing: number) => Math.floor(tick / spacing) * spacing;
export const ceilToSpacing = (tick: number, spacing: number) => Math.ceil(tick / spacing) * spacing;

export function sortAssets(x: Asset, y: Asset): [Asset, Asset] {
  if (x.address.toLowerCase() === y.address.toLowerCase()) throw new Error("A pool needs two different tokens");
  return BigInt(x.address) < BigInt(y.address) ? [x, y] : [y, x];
}

/** The pool address, computed without a network call. PancakeSwap deploys pools from a separate PoolDeployer. */
export function poolAddress(chain: Chain, tokenA: Address, tokenB: Address, fee: number): Address {
  const [t0, t1] = BigInt(tokenA) < BigInt(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
  const salt = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }], [t0, t1, fee]));
  return getContractAddress({ opcode: "CREATE2", from: chain.dex.poolDeployer, salt, bytecodeHash: chain.dex.poolInitCodeHash });
}

/** Trim a float for display without scientific notation. */
export function fmt(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : Math.min(18, Math.max(digits, Math.ceil(-Math.log10(abs)) + 3));
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

// The wallet's V3 positions on one network, read from the position manager and the pools.
import { formatUnits, type Address } from "viem";
import { pancakePoolAbi, positionManagerAbi, uniswapPoolAbi } from "./abi.ts";
import { rpc, type Asset, type Chain } from "./config.ts";
import type { PositionCache } from "./actions.ts";
import type { Store } from "./store.ts";
import { amountsForLiquidity, fmt, poolAddress, priceFromSqrt, priceFromTick } from "./v3.ts";

const MAX_UINT128 = (1n << 128n) - 1n;
const STABLES = new Set(["USDT", "USDC", "BUSD", "DAI"]);
const poolAbi = (chain: Chain) => (chain.dex.kind === "pancake" ? pancakePoolAbi : uniswapPoolAbi);

export async function poolState(chain: Chain, pool: Address) {
  const client = rpc(chain);
  const abi = poolAbi(chain);
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: pool, abi, functionName: "slot0" }) as Promise<readonly [bigint, number, ...unknown[]]>,
    client.readContract({ address: pool, abi, functionName: "liquidity" }) as Promise<bigint>,
  ]);
  // The protocol keeps part of every swap fee. PancakeSwap stores it per direction in units of
  // 1/10000 (two 16-bit halves); Uniswap stores a denominator per direction (two 4-bit halves).
  const packed = Number(slot0[5] ?? 0);
  let protocolShare = 0;
  if (chain.dex.kind === "pancake") protocolShare = ((packed & 0xffff) + (packed >>> 16)) / 2 / 10_000;
  else {
    const d0 = packed & 0xf;
    const d1 = packed >> 4;
    protocolShare = ((d0 ? 1 / d0 : 0) + (d1 ? 1 / d1 : 0)) / 2;
  }
  return { sqrtPriceX96: slot0[0], tick: Number(slot0[1]), liquidity, protocolShare };
}

/** Prices are quoted in the stable token when the pair has one, otherwise in token1. */
export function orient(t0: Asset, t1: Asset) {
  const invert = STABLES.has(t0.symbol) && !STABLES.has(t1.symbol);
  return { invert, unit: invert ? `${t0.symbol} per ${t1.symbol}` : `${t1.symbol} per ${t0.symbol}` };
}

export function positionCache(store: Store, chainId: number): PositionCache {
  return store.readJson<PositionCache>(`cache/positions-${chainId}.json`) ?? {};
}

export async function listPositions(store: Store, chain: Chain, wallet: Address) {
  const client = rpc(chain);
  const npm = chain.dex.positionManager;
  const count = Number(await client.readContract({ address: npm, abi: positionManagerAbi, functionName: "balanceOf", args: [wallet] }));
  const ids = await Promise.all(
    Array.from({ length: Math.min(count, 50) }, (_, i) => client.readContract({ address: npm, abi: positionManagerAbi, functionName: "tokenOfOwnerByIndex", args: [wallet, BigInt(i)] }) as Promise<bigint>),
  );
  const cache: PositionCache = {};
  const seen = store.readJson<Record<string, string>>(`history/first-seen-${chain.chainId}.json`) ?? {};
  const out: any[] = [];
  for (const id of ids) {
    const p = (await client.readContract({ address: npm, abi: positionManagerAbi, functionName: "positions", args: [id] })) as readonly any[];
    const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = p;
    cache[id.toString()] = { token0, token1, fee: Number(fee), tickLower: Number(tickLower), tickUpper: Number(tickUpper), liquidity: (liquidity as bigint).toString() };
    if (!seen[id.toString()]) seen[id.toString()] = new Date().toISOString();
    const t0 = chain.assets.find((a) => a.address.toLowerCase() === token0.toLowerCase());
    const t1 = chain.assets.find((a) => a.address.toLowerCase() === token1.toLowerCase());
    if (!t0 || !t1) continue; // a position in tokens this plugin does not manage
    const pool = poolAddress(chain, t0.address, t1.address, Number(fee));
    const state = await poolState(chain, pool);
    const [a0, a1] = amountsForLiquidity(state.sqrtPriceX96, Number(tickLower), Number(tickUpper), liquidity as bigint);
    let fees: readonly [bigint, bigint] = [0n, 0n];
    try {
      const sim = await client.simulateContract({ address: npm, abi: positionManagerAbi, functionName: "collect", args: [{ tokenId: id, recipient: wallet, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }], account: wallet });
      fees = sim.result as readonly [bigint, bigint];
    } catch {
      /* fees stay at zero when the simulation is unavailable */
    }
    if ((liquidity as bigint) === 0n && fees[0] === 0n && fees[1] === 0n) continue; // closed and empty
    const { invert, unit } = orient(t0, t1);
    const pLo = priceFromTick(Number(tickLower), t0.decimals, t1.decimals);
    const pHi = priceFromTick(Number(tickUpper), t0.decimals, t1.decimals);
    const pNow = priceFromSqrt(state.sqrtPriceX96, t0.decimals, t1.decimals);
    out.push({
      tokenId: id.toString(),
      pool,
      pair: `${t0.symbol}/${t1.symbol}`,
      token0: t0.symbol,
      token1: t1.symbol,
      fee: Number(fee),
      feePct: String(Number(fee) / 10000),
      tickLower: Number(tickLower),
      tickUpper: Number(tickUpper),
      currentTick: state.tick,
      inRange: Number(tickLower) <= state.tick && state.tick < Number(tickUpper) && (liquidity as bigint) > 0n,
      liquidity: (liquidity as bigint).toString(),
      priceLower: fmt(invert ? 1 / pHi : pLo),
      priceUpper: fmt(invert ? 1 / pLo : pHi),
      priceCurrent: fmt(invert ? 1 / pNow : pNow),
      priceUnit: unit,
      amounts: [{ symbol: t0.symbol, amount: formatUnits(a0, t0.decimals) }, { symbol: t1.symbol, amount: formatUnits(a1, t1.decimals) }],
      unclaimedFees: [{ symbol: t0.symbol, amount: formatUnits(fees[0], t0.decimals) }, { symbol: t1.symbol, amount: formatUnits(fees[1], t1.decimals) }],
      mintedAt: seen[id.toString()] ?? null,
    });
  }
  store.writeJson(`cache/positions-${chain.chainId}.json`, cache);
  store.writeJson(`history/first-seen-${chain.chainId}.json`, seen);
  return out;
}

// Read-only planning: the pool list, swap quotes, and LP plans that come back as ready-to-run actions.
import { formatUnits, getAddress, isAddress, parseUnits, type Address } from "viem";
import { erc20Abi, pancakePoolAbi, positionManagerAbi, quoterAbi, uniswapPoolAbi } from "./abi.ts";
import type { Action } from "./actions.ts";
import { findAsset, requireAsset, rpc, type Asset, type Chain } from "./config.ts";
import { CliError } from "./errors.ts";
import { orient, poolState } from "./positions.ts";
import type { ScopeRecord } from "./store.ts";
import { amountsForLiquidity, ceilToSpacing, floorToSpacing, fmt, liquidityForAmounts, MAX_TICK, MIN_TICK, poolAddress, priceFromSqrt, priceFromTick, Q96, sortAssets, tickSpacingFor } from "./v3.ts";

const bps = (n: unknown, fallback: number) => {
  const v = n === undefined || n === null ? fallback : Number(n);
  if (!Number.isFinite(v) || v < 0 || v > 5000) throw new CliError("BAD_INPUT", "slippageBps must be between 0 and 5000.");
  return BigInt(Math.round(v));
};
const less = (amount: bigint, slippage: bigint) => (amount * (10_000n - slippage)) / 10_000n;
const text = (raw: bigint, asset: Asset) => formatUnits(raw, asset.decimals);

async function quoteExact(chain: Chain, tin: Asset, tout: Asset, fee: number, amountIn: bigint) {
  const sim = await rpc(chain).simulateContract({
    address: chain.dex.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn: tin.address, tokenOut: tout.address, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  const [amountOut, sqrtAfter] = sim.result as readonly [bigint, bigint, number, bigint];
  return { amountOut, sqrtAfter };
}

export async function quoteSwap(chain: Chain, input: { tokenIn: string; tokenOut: string; fee: number; amountIn: string; slippageBps?: number }) {
  const tin = requireAsset(chain, input.tokenIn);
  const tout = requireAsset(chain, input.tokenOut);
  const fee = Number(input.fee);
  tickSpacingFor(chain, fee);
  let amountIn: bigint;
  try {
    amountIn = parseUnits(String(input.amountIn), tin.decimals);
  } catch {
    throw new CliError("BAD_INPUT", `"${input.amountIn}" is not an amount of ${tin.symbol}.`);
  }
  if (amountIn <= 0n) throw new CliError("BAD_INPUT", "amountIn must be greater than zero.");
  const slippage = bps(input.slippageBps, 50);
  let q;
  try {
    q = await quoteExact(chain, tin, tout, fee, amountIn);
  } catch {
    throw new CliError("NO_ROUTE", `${chain.dex.name} has no usable ${tin.symbol}/${tout.symbol} ${fee / 10000}% pool for this amount.`);
  }
  const minOut = less(q.amountOut, slippage);
  return {
    amountOut: text(q.amountOut, tout),
    minAmountOut: text(minOut, tout),
    pool: poolAddress(chain, tin.address, tout.address, fee),
    actions: [{ type: "swap", tokenIn: tin.symbol, tokenOut: tout.symbol, fee, amountIn: text(amountIn, tin), minAmountOut: text(minOut, tout) }] as Action[],
  };
}

// ---- pools ------------------------------------------------------------------

const DEX_IDS: Record<string, string> = { pancake: "pancakeswap", uniswap: "uniswap" };

export async function listPools(chain: Chain, scope: ScopeRecord | null, limit = 10) {
  const allowed = scope ? new Set(scope.spend.map((s) => s.symbol)) : null;
  const inScope = (a?: Asset, b?: Asset) => (allowed && a && b ? allowed.has(a.symbol) && allowed.has(b.symbol) : false);
  const abi = chain.dex.kind === "pancake" ? pancakePoolAbi : uniswapPoolAbi;
  const client = rpc(chain);

  if (!chain.dexscreenerChain) {
    // Testnets have no market data: list the pools that exist between the known assets, by liquidity.
    const rows: any[] = [];
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < chain.assets.length; i++) {
      for (let j = i + 1; j < chain.assets.length; j++) {
        for (const fee of chain.dex.feeTiers) {
          const [t0, t1] = sortAssets(chain.assets[i], chain.assets[j]);
          const pool = poolAddress(chain, t0.address, t1.address, fee);
          jobs.push(
            poolState(chain, pool)
              .then((s) => {
                if (s.liquidity === 0n) return;
                const { invert, unit } = orient(t0, t1);
                const p = priceFromSqrt(s.sqrtPriceX96, t0.decimals, t1.decimals);
                rows.push({ pool, pair: `${t0.symbol}/${t1.symbol}`, token0: t0.symbol, token1: t1.symbol, fee, feePct: String(fee / 10000), tickSpacing: tickSpacingFor(chain, fee), currentTick: s.tick, price: fmt(invert ? 1 / p : p), priceUnit: unit, activeLiquidity: s.liquidity.toString(), volume24hUsd: null, tvlUsd: null, feeAprPct: null, inScope: inScope(t0, t1) });
              })
              .catch(() => {}),
          );
        }
      }
    }
    await Promise.all(jobs);
    rows.sort((a, b) => (BigInt(b.activeLiquidity) > BigInt(a.activeLiquidity) ? 1 : -1));
    return { source: "onchain factory scan (testnets have no volume data)", pools: rows.slice(0, limit) };
  }

  const found = new Map<string, any>();
  await Promise.all(
    chain.assets.map(async (asset) => {
      const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/${chain.dexscreenerChain}/${asset.address}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return;
      const pairs: any[] = await res.json();
      for (const p of pairs) {
        if (p?.dexId !== DEX_IDS[chain.dex.kind] || !(p.labels ?? []).includes("v3")) continue;
        found.set(String(p.pairAddress).toLowerCase(), p);
      }
    }),
  );
  if (found.size === 0) throw new CliError("NO_DATA", "DexScreener returned no V3 pools right now. Try again shortly.");
  const top = [...found.values()].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)).slice(0, limit);
  const pools = await Promise.all(
    top.map(async (p) => {
      const pool = getAddress(p.pairAddress);
      const [fee, state] = await Promise.all([client.readContract({ address: pool, abi, functionName: "fee" }).then(Number), poolState(chain, pool)]);
      const a = findAsset(chain, p.baseToken.address);
      const b = findAsset(chain, p.quoteToken.address);
      const volume = Number(p.volume?.h24 ?? 0);
      const tvl = Number(p.liquidity?.usd ?? 0);
      const row: any = {
        pool,
        pair: `${p.baseToken.symbol}/${p.quoteToken.symbol}`,
        fee,
        feePct: String(fee / 10000),
        currentTick: state.tick,
        volume24hUsd: Math.round(volume),
        tvlUsd: Math.round(tvl),
        feeAprPct: tvl > 0 ? Number((((volume * fee) / 1e6 / tvl) * 365 * 100 * (1 - state.protocolShare)).toFixed(1)) : null,
        protocolFeePct: Number((state.protocolShare * 100).toFixed(1)),
        supported: Boolean(a && b),
        inScope: inScope(a, b),
      };
      if (a && b) {
        const [t0, t1] = sortAssets(a, b);
        const { invert, unit } = orient(t0, t1);
        const price = priceFromSqrt(state.sqrtPriceX96, t0.decimals, t1.decimals);
        Object.assign(row, { pair: `${t0.symbol}/${t1.symbol}`, token0: t0.symbol, token1: t1.symbol, tickSpacing: tickSpacingFor(chain, fee), price: fmt(invert ? 1 / price : price), priceUnit: unit });
      }
      return row;
    }),
  );
  return { source: "DexScreener 24 h volume and liquidity; fee tier, protocol fee share and tick read onchain. Fee APR = volume x fee x (1 - protocol share) / TVL x 365, for liquidity spread like the pool's average. A narrow range that stays in range earns more.", pools };
}

// ---- LP plans ---------------------------------------------------------------

async function resolvePool(chain: Chain, input: any): Promise<{ t0: Asset; t1: Asset; fee: number; pool: Address }> {
  if (input.pool && isAddress(String(input.pool))) {
    const pool = getAddress(String(input.pool));
    const abi = chain.dex.kind === "pancake" ? pancakePoolAbi : uniswapPoolAbi;
    const client = rpc(chain);
    const [a, b, fee] = await Promise.all([
      client.readContract({ address: pool, abi, functionName: "token0" }) as Promise<Address>,
      client.readContract({ address: pool, abi, functionName: "token1" }) as Promise<Address>,
      client.readContract({ address: pool, abi, functionName: "fee" }).then(Number),
    ]).catch(() => {
      throw new CliError("BAD_INPUT", `${pool} is not a ${chain.dex.name} pool on ${chain.name}.`);
    });
    const t0 = findAsset(chain, a);
    const t1 = findAsset(chain, b);
    if (!t0 || !t1) throw new CliError("UNSUPPORTED_POOL", `That pool holds a token outside this plugin's asset list (${chain.assets.map((x) => x.symbol).join(", ")}).`);
    if (poolAddress(chain, t0.address, t1.address, fee).toLowerCase() !== pool.toLowerCase()) throw new CliError("BAD_INPUT", `${pool} is not a genuine ${chain.dex.name} pool.`);
    return { t0, t1, fee, pool };
  }
  if (!input.token0 || !input.token1 || input.fee === undefined) throw new CliError("BAD_INPUT", "Give a pool address, or token0, token1 and fee.");
  const [t0, t1] = sortAssets(requireAsset(chain, input.token0), requireAsset(chain, input.token1));
  const fee = Number(input.fee);
  tickSpacingFor(chain, fee);
  return { t0, t1, fee, pool: poolAddress(chain, t0.address, t1.address, fee) };
}

export async function lpPlan(chain: Chain, wallet: Address, input: any) {
  const { t0, t1, fee, pool } = await resolvePool(chain, input);
  const spacing = tickSpacingFor(chain, fee);
  const state = await poolState(chain, pool).catch(() => {
    throw new CliError("NO_POOL", `There is no ${t0.symbol}/${t1.symbol} ${fee / 10000}% pool on ${chain.dex.name}.`);
  });
  if (state.liquidity === 0n && state.sqrtPriceX96 === 0n) throw new CliError("NO_POOL", "That pool is not initialized.");
  const slippage = bps(input.slippageBps, 100);

  // Range: explicit ticks, or a percentage either side of a reference tick.
  const explicit = input.tickLower !== undefined || input.tickUpper !== undefined;
  let lo = 0;
  let hi = 0;
  const pct = input.rangePct === undefined ? 1 : Number(input.rangePct);
  if (explicit) {
    lo = Number(input.tickLower);
    hi = Number(input.tickUpper);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo >= hi) throw new CliError("BAD_INPUT", "tickLower must be an integer below tickUpper.");
    if (lo % spacing !== 0 || hi % spacing !== 0) throw new CliError("BAD_INPUT", `Ticks must be multiples of ${spacing} in this pool.`);
  } else if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
    throw new CliError("BAD_INPUT", "rangePct must be between 0 and 90.");
  }
  const centreOn = (tick: number) => {
    const delta = Math.log(1 + pct / 100) / Math.log(1.0001);
    lo = floorToSpacing(Math.floor(tick - delta), spacing);
    hi = ceilToSpacing(Math.ceil(tick + delta), spacing);
    if (lo >= tick) lo -= spacing;
    if (hi <= tick) hi += spacing;
  };
  if (!explicit) centreOn(state.tick);
  if (lo < MIN_TICK || hi > MAX_TICK) throw new CliError("BAD_INPUT", "The range is outside the pool's tick limits.");

  // What the plan may use
  const actions: Action[] = [];
  const notes: string[] = [];
  let h0 = 0n;
  let h1 = 0n;
  const client = rpc(chain);
  if (input.budget === "balances") {
    [h0, h1] = (await Promise.all([t0, t1].map((t) => client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] })))) as [bigint, bigint];
    if (h0 === 0n && h1 === 0n) throw new CliError("NOTHING_TO_DEPLOY", `The wallet holds no ${t0.symbol} or ${t1.symbol} on ${chain.name}.`);
  } else if (input.budget && typeof input.budget === "object") {
    const symbol = String(input.budget.symbol ?? "");
    const isNative = symbol.toLowerCase() === chain.nativeSymbol.toLowerCase() || symbol.toLowerCase() === "native";
    const source = isNative ? chain.wrappedNative : requireAsset(chain, symbol);
    let amount: bigint;
    try {
      amount = parseUnits(String(input.budget.amount), source.decimals);
    } catch {
      throw new CliError("BAD_INPUT", `"${input.budget.amount}" is not an amount of ${symbol}.`);
    }
    if (amount <= 0n) throw new CliError("BAD_INPUT", "The budget must be greater than zero.");
    if (isNative) actions.push({ type: "wrap", amount: formatUnits(amount, 18) });
    let funded = source;
    if (source.address !== t0.address && source.address !== t1.address) {
      // Fund from a third token: one swap into token1 through the deepest direct pool.
      let best: { fee: number; out: bigint } | null = null;
      for (const tier of chain.dex.feeTiers) {
        const q = await quoteExact(chain, source, t1, tier, amount).catch(() => null);
        if (q && (!best || q.amountOut > best.out)) best = { fee: tier, out: q.amountOut };
      }
      if (!best) throw new CliError("NO_ROUTE", `No direct ${source.symbol}/${t1.symbol} pool to fund this position from ${source.symbol}.`);
      const minOut = less(best.out, 50n);
      actions.push({ type: "swap", tokenIn: source.symbol, tokenOut: t1.symbol, fee: best.fee, amountIn: text(amount, source), minAmountOut: text(minOut, t1) });
      amount = minOut;
      funded = t1;
    }
    if (funded.address === t0.address) h0 = amount;
    else h1 = amount;
  } else {
    throw new CliError("BAD_INPUT", 'budget must be {"symbol": ..., "amount": ...} or "balances".');
  }

  // Split to the range's ratio with one swap between the pool's two tokens, through the deepest fee tier.
  // A swap through the LP pool itself moves that pool's price, so the range is re-centred on the
  // price the swap leaves behind (when the range was given as a percentage).
  const Q192 = Q96 * Q96;
  const tickOfSqrt = (sqrtP: bigint) => Math.floor(Math.log((Number(sqrtP) / 2 ** 96) ** 2) / Math.log(1.0001));
  const start0 = h0;
  const start1 = h1;
  let sqrtForMint = state.sqrtPriceX96;
  let swap: Action | null = null;
  let impactPct = 0;
  // The price the split is computed at. It starts at the pool price and, when the swap goes
  // through the LP pool, moves to the price that swap leaves behind until the two agree.
  let sqrtRef = state.sqrtPriceX96;
  let previousIn = 0n;
  for (let round = 0; round < 4; round++) {
    h0 = start0;
    h1 = start1;
    swap = null;
    if (!explicit && round > 0) centreOn(tickOfSqrt(sqrtRef));
    const price192 = sqrtRef * sqrtRef; // token1 per token0, scaled by 2^192
    const [r0, r1] = amountsForLiquidity(sqrtRef, lo, hi, 10n ** 30n);
    const valueIn1 = (h0 * price192) / Q192 + h1;
    const denom = (r0 * price192) / Q192 + r1;
    if (denom === 0n || valueIn1 === 0n) throw new CliError("BAD_INPUT", "The budget is too small for this pool.");
    const target0 = (valueIn1 * r0) / denom;
    const target1 = (valueIn1 * r1) / denom;
    const from0 = h0 > target0;
    const tin = from0 ? t0 : t1;
    const tout = from0 ? t1 : t0;
    const held = from0 ? h0 : h1;
    const amountIn = from0 ? h0 - target0 : h1 > target1 ? h1 - target1 : 0n;
    if (amountIn * 1000n < held || amountIn === 0n) {
      sqrtForMint = state.sqrtPriceX96;
      break; // under 0.1% of the holding: not worth a swap
    }
    const quotes = await Promise.all(chain.dex.feeTiers.map((tier) => quoteExact(chain, tin, tout, tier, amountIn).then((q) => ({ tier, ...q })).catch(() => null)));
    const best = quotes.filter(Boolean).sort((x, y) => (y!.amountOut > x!.amountOut ? 1 : -1))[0];
    if (!best) throw new CliError("NO_ROUTE", `No ${t0.symbol}/${t1.symbol} pool on ${chain.dex.name} can absorb a swap of ${text(amountIn, tin)} ${tin.symbol}.`);
    const minOut = less(best.amountOut, 50n);
    swap = { type: "swap", tokenIn: tin.symbol, tokenOut: tout.symbol, fee: best.tier, amountIn: text(amountIn, tin), minAmountOut: text(minOut, tout) };
    if (from0) {
      h0 = target0;
      h1 += minOut;
    } else {
      h1 = target1;
      h0 += minOut;
    }
    // What the swap does to the price it trades at, against the pool price before it.
    const fair = from0 ? (amountIn * state.sqrtPriceX96 * state.sqrtPriceX96) / Q192 : (amountIn * Q192) / (state.sqrtPriceX96 * state.sqrtPriceX96);
    impactPct = fair > 0n ? Number(((fair - best.amountOut) * 10_000n) / fair) / 100 : 0;
    if (best.tier !== fee) {
      sqrtForMint = state.sqrtPriceX96;
      break; // the LP pool's price is untouched
    }
    sqrtForMint = best.sqrtAfter;
    const change = amountIn > previousIn ? amountIn - previousIn : previousIn - amountIn;
    if (round > 0 && change * 100n <= amountIn) break; // the split has settled
    previousIn = amountIn;
    sqrtRef = best.sqrtAfter;
  }
  if (swap) actions.push(swap);
  if (impactPct > 2) notes.push(`This pool is thin: the entry swap trades about ${impactPct.toFixed(1)}% away from the pool price. A smaller budget loses less.`);

  const liquidity = liquidityForAmounts(sqrtForMint, lo, hi, h0, h1);
  if (liquidity === 0n) throw new CliError("BAD_INPUT", "The budget is too small to mint any liquidity in this range.");
  const [u0, u1] = amountsForLiquidity(sqrtForMint, lo, hi, liquidity);
  actions.push({
    type: "mint", token0: t0.symbol, token1: t1.symbol, fee, tickLower: lo, tickUpper: hi,
    amount0Desired: text(h0, t0), amount1Desired: text(h1, t1), amount0Min: text(less(u0, slippage), t0), amount1Min: text(less(u1, slippage), t1),
  });

  const { invert, unit } = orient(t0, t1);
  const pLo = priceFromTick(lo, t0.decimals, t1.decimals);
  const pHi = priceFromTick(hi, t0.decimals, t1.decimals);
  const pNow = priceFromSqrt(state.sqrtPriceX96, t0.decimals, t1.decimals);
  const tickAtMint = sqrtForMint === state.sqrtPriceX96 ? state.tick : tickOfSqrt(sqrtForMint);
  const inRange = lo <= tickAtMint && tickAtMint < hi;
  if (!inRange) notes.push("This range does not contain the price at mint time, so the position starts out of range and holds one token.");
  notes.push("Pass `actions` unchanged to sovereign_execute. Approvals are added for you in the same batch.");
  return {
    pool,
    pair: `${t0.symbol}/${t1.symbol}`,
    fee,
    currentTick: state.tick,
    range: { tickLower: lo, tickUpper: hi, priceLower: fmt(invert ? 1 / pHi : pLo), priceUpper: fmt(invert ? 1 / pLo : pHi), priceCurrent: fmt(invert ? 1 / pNow : pNow), priceUnit: unit, inRange },
    expected: [{ symbol: t0.symbol, amount: text(u0, t0) }, { symbol: t1.symbol, amount: text(u1, t1) }],
    actions,
    notes,
  };
}

export async function exitPlan(chain: Chain, wallet: Address, input: { tokenId: string; slippageBps?: number }) {
  if (!/^\d{1,30}$/.test(String(input?.tokenId ?? ""))) throw new CliError("BAD_INPUT", "tokenId must be a position id.");
  const id = BigInt(input.tokenId);
  const client = rpc(chain);
  const npm = chain.dex.positionManager;
  const owner = (await client.readContract({ address: npm, abi: positionManagerAbi, functionName: "ownerOf", args: [id] }).catch(() => null)) as Address | null;
  if (!owner || owner.toLowerCase() !== wallet.toLowerCase()) throw new CliError("NOT_YOURS", `Position #${id} does not belong to the wallet.`);
  const p = (await client.readContract({ address: npm, abi: positionManagerAbi, functionName: "positions", args: [id] })) as readonly any[];
  const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = p;
  const t0 = findAsset(chain, token0);
  const t1 = findAsset(chain, token1);
  if (!t0 || !t1) throw new CliError("UNSUPPORTED_POOL", "That position holds a token outside this plugin's asset list.");
  const slippage = bps(input.slippageBps, 100);
  const actions: Action[] = [];
  if ((liquidity as bigint) > 0n) {
    const state = await poolState(chain, poolAddress(chain, t0.address, t1.address, Number(fee)));
    const [a0, a1] = amountsForLiquidity(state.sqrtPriceX96, Number(tickLower), Number(tickUpper), liquidity as bigint);
    actions.push({ type: "decrease", tokenId: id.toString(), token0: t0.symbol, token1: t1.symbol, liquidity: (liquidity as bigint).toString(), amount0Min: text(less(a0, slippage), t0), amount1Min: text(less(a1, slippage), t1) });
  }
  actions.push({ type: "collect", tokenId: id.toString() }, { type: "burn", tokenId: id.toString() });
  return { tokenId: id.toString(), pair: `${t0.symbol}/${t1.symbol}`, fee: Number(fee), actions, notes: ["Pass `actions` unchanged to sovereign_execute. To re-enter, ask for an lp-plan with budget \"balances\" afterwards."] };
}

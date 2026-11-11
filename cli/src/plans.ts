// Plans by name. A model that copies a long actions array can drop or change a step, so a batch can
// also be given as what the user asked for: `open` (a new position) or `close` (an existing one),
// or as the `planId` a quote returned. The plugin then builds the actions itself. A plan is kept for
// ten minutes, so the batch that runs is the one the approval sentence described.
import crypto from "node:crypto";
import type { Address } from "viem";
import type { Action } from "./actions.ts";
import { type Chain } from "./config.ts";
import { CliError } from "./errors.ts";
import { poolState } from "./positions.ts";
import { exitPlan, lpPlan } from "./quote.ts";
import type { Store } from "./store.ts";
import { poolAddress, sortAssets, tickSpacingFor } from "./v3.ts";

const PLAN_TTL_MS = 10 * 60 * 1000;
const EXAMPLE = '{"pair": "USDT/WBNB", "fee": 500, "budget": {"symbol": "BNB", "amount": "0.004"}, "rangePct": 3}';

type Saved = { id: string; chainId: number; createdAt: number; actions: Action[]; summary: unknown };

const NATIVE_NAMES = new Set(["native", "bnb", "tbnb", "eth", "sepoliaeth", "ether"]);

function symbolOf(chain: Chain, text: unknown): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === chain.nativeSymbol.toLowerCase() || NATIVE_NAMES.has(lower)) return chain.nativeSymbol;
  const hit = [chain.wrappedNative, ...chain.assets].find((a) => a.symbol.toLowerCase() === lower);
  return hit ? hit.symbol : raw;
}

/** A fee tier from 500, "500", 0.05, "0.05" or "0.05%". */
function feeOf(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim();
  const n = Number(text.replace("%", ""));
  if (!Number.isFinite(n) || n <= 0) throw new CliError("BAD_INPUT", `fee "${value}" is not a fee tier. Use 500 for 0.05%.`);
  return text.includes("%") || n < 10 ? Math.round(n * 10000) : Math.round(n);
}

function budgetOf(chain: Chain, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.toLowerCase() === "balances") return "balances";
    const m = /^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)$/.exec(text);
    if (m) return { symbol: symbolOf(chain, m[2]), amount: m[1] };
    throw new CliError("BAD_INPUT", `budget "${value}" is not understood. Use {"symbol": "${chain.nativeSymbol}", "amount": "0.004"} or "balances".`);
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    const symbol = symbolOf(chain, v.symbol ?? v.token ?? v.asset ?? v.currency);
    const amount = v.amount ?? v.value;
    if (symbol && amount !== undefined) return { symbol, amount: String(amount).trim() };
  }
  throw new CliError("BAD_INPUT", `budget needs a symbol and an amount, for example {"symbol": "${chain.nativeSymbol}", "amount": "0.004"}, or the string "balances".`);
}

/** Turn what a caller wrote for a new position into the planner's input. Forgiving about spelling, strict about meaning. */
export async function normalizeOpen(chain: Chain, raw: any): Promise<Record<string, unknown>> {
  if (!raw || typeof raw !== "object") throw new CliError("BAD_INPUT", `Say which position to open, for example ${EXAMPLE}.`);
  const out: Record<string, unknown> = {};
  let a = raw.token0 ?? raw.tokenA;
  let b = raw.token1 ?? raw.tokenB;
  if (raw.pair && (!a || !b)) [a, b] = String(raw.pair).split(/[\/\-\s,]+/).filter(Boolean);
  if (raw.pool && /^0x[0-9a-fA-F]{40}$/.test(String(raw.pool).trim())) out.pool = String(raw.pool).trim();
  else if (a && b) {
    out.token0 = symbolOf(chain, a) === chain.nativeSymbol ? chain.wrappedNative.symbol : symbolOf(chain, a);
    out.token1 = symbolOf(chain, b) === chain.nativeSymbol ? chain.wrappedNative.symbol : symbolOf(chain, b);
    let fee = feeOf(raw.fee ?? raw.feeTier);
    if (fee === undefined) fee = await deepestTier(chain, String(out.token0), String(out.token1));
    out.fee = fee;
  } else throw new CliError("BAD_INPUT", `Name the pool by its address, or by pair and fee, for example ${EXAMPLE}.`);
  const budget = budgetOf(chain, raw.budget ?? (raw.amount !== undefined ? { symbol: raw.symbol ?? raw.token ?? chain.nativeSymbol, amount: raw.amount } : undefined));
  if (budget === undefined) throw new CliError("BAD_INPUT", `Say what to fund the position with, for example "budget": {"symbol": "${chain.nativeSymbol}", "amount": "0.004"}.`);
  out.budget = budget;
  const lower = raw.tickLower ?? raw.lowerTick;
  const upper = raw.tickUpper ?? raw.upperTick;
  if (lower !== undefined && upper !== undefined) {
    out.tickLower = Math.round(Number(lower));
    out.tickUpper = Math.round(Number(upper));
    // Ticks that miss the pool's spacing widen outward to the nearest ones that fit.
    if (typeof out.fee === "number" && Number.isFinite(out.tickLower) && Number.isFinite(out.tickUpper)) {
      const spacing = tickSpacingFor(chain, out.fee);
      out.tickLower = Math.floor((out.tickLower as number) / spacing) * spacing;
      out.tickUpper = Math.ceil((out.tickUpper as number) / spacing) * spacing;
    }
  } else {
    const pct = raw.rangePct ?? raw.range ?? raw.rangePercent;
    if (pct !== undefined) out.rangePct = Number(String(pct).replace("%", ""));
  }
  if (raw.slippageBps !== undefined) out.slippageBps = Number(raw.slippageBps);
  return out;
}

/** The fee tier whose pool holds the most liquidity for a pair. */
async function deepestTier(chain: Chain, s0: string, s1: string): Promise<number> {
  const find = (s: string) => [chain.wrappedNative, ...chain.assets].find((x) => x.symbol === s);
  const x = find(s0);
  const y = find(s1);
  if (!x || !y) throw new CliError("BAD_INPUT", `${!x ? s0 : s1} is not a token this plugin knows on ${chain.name}. Known: ${chain.assets.map((t) => t.symbol).join(", ")}.`);
  const [t0, t1] = sortAssets(x, y);
  let best: { fee: number; liquidity: bigint } | null = null;
  for (const fee of chain.dex.feeTiers) {
    const state = await poolState(chain, poolAddress(chain, t0.address, t1.address, fee)).catch(() => null);
    if (state && state.liquidity > 0n && (!best || state.liquidity > best.liquidity)) best = { fee, liquidity: state.liquidity };
  }
  if (!best) throw new CliError("NO_POOL", `There is no ${s0}/${s1} pool with liquidity on ${chain.dex.name}.`);
  return best.fee;
}

const fileOf = (id: string) => `cache/plan-${id}.json`;

function save(store: Store, chain: Chain, key: string, actions: Action[], summary: unknown): Saved {
  const saved: Saved = { id: key, chainId: chain.chainId, createdAt: Date.now(), actions, summary };
  store.writeJson(fileOf(key), saved);
  return saved;
}

function load(store: Store, chain: Chain, id: string): Saved | null {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const saved = store.readJson<Saved>(fileOf(id));
  if (!saved || !Array.isArray(saved.actions) || saved.chainId !== chain.chainId || Date.now() - saved.createdAt > PLAN_TTL_MS) return null;
  return saved;
}

const keyOf = (chain: Chain, wallet: Address, what: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify([chain.chainId, wallet.toLowerCase(), what])).digest("hex").slice(0, 12);

/** Plan a new position and remember it. Asking again within ten minutes returns the same plan. */
export async function planOpen(store: Store, chain: Chain, wallet: Address, raw: any) {
  const input = await normalizeOpen(chain, raw);
  const key = keyOf(chain, wallet, ["open", input]);
  const kept = load(store, chain, key);
  if (kept) return { planId: key, actions: kept.actions, summary: kept.summary };
  const plan: any = await lpPlan(chain, wallet, input);
  const { actions, ...summary } = plan;
  save(store, chain, key, actions, summary);
  return { planId: key, actions: actions as Action[], summary };
}

export async function planClose(store: Store, chain: Chain, wallet: Address, raw: any) {
  const tokenId = String(raw?.tokenId ?? raw?.id ?? raw?.position ?? raw ?? "").replace(/^#/, "").trim();
  const key = keyOf(chain, wallet, ["close", tokenId, raw?.slippageBps ?? null]);
  const kept = load(store, chain, key);
  if (kept) return { planId: key, actions: kept.actions, summary: kept.summary };
  const plan: any = await exitPlan(chain, wallet, { tokenId, slippageBps: raw?.slippageBps });
  const { actions, ...summary } = plan;
  save(store, chain, key, actions, summary);
  return { planId: key, actions: actions as Action[], summary };
}

/** The actions a batch request stands for: given outright, by plan id, or as a position to open or close. */
export async function resolveActions(store: Store, chain: Chain, wallet: Address, input: any): Promise<{ actions: Action[]; planId: string | null }> {
  if (Array.isArray(input?.actions) && input.actions.length > 0) return { actions: input.actions, planId: null };
  if (input?.planId) {
    const saved = load(store, chain, String(input.planId).trim());
    if (!saved) throw new CliError("PLAN_EXPIRED", "That plan is more than ten minutes old or does not exist. Ask for it again.");
    return { actions: saved.actions, planId: saved.id };
  }
  if (input?.open) {
    const p = await planOpen(store, chain, wallet, input.open);
    return { actions: p.actions, planId: p.planId };
  }
  if (input?.close) {
    const p = await planClose(store, chain, wallet, input.close);
    return { actions: p.actions, planId: p.planId };
  }
  throw new CliError("BAD_INPUT", `Say what to do: "open": ${EXAMPLE}, or "close": {"tokenId": "123"}, or a "planId" from sovereign_quote.`);
}

/** Drop a plan once its batch has run, so the same request plans afresh next time. */
export function forgetPlan(store: Store, id: string | null): void {
  if (id && /^[0-9a-f]{12}$/.test(id)) store.writeJson(fileOf(id), null);
}

// The "V3 LP" permission preset: what the session key may call and spend on one network.
import { parseUnits, type Address } from "viem";
import type { SessionPermissions } from "@altananetwork/sdk";
import { SEL } from "./abi.ts";
import { requireAsset, type Chain } from "./config.ts";
import { CliError } from "./errors.ts";
import type { ScopeRecord } from "./store.ts";

export type GrantInput = { nativeCap: string; tokens: { symbol: string; cap: string }[] };
export type CompiledPolicy = { permissions: SessionPermissions; scope: ScopeRecord; scopeText: string[] };

/** Upper bound for any single cap. */
const MAX_LIMIT = 10n ** 24n;
const MAX_TOKENS = 60;

export const swapSelector = (chain: Chain) => (chain.dex.kind === "pancake" ? SEL.pancakeSwap : SEL.uniswapSwap);
export const pair = (to: string, selector: string) => `${to.toLowerCase()}:${selector.toLowerCase()}`;

function positiveAmount(text: string, decimals: number, what: string): bigint {
  let raw: bigint;
  try {
    raw = parseUnits(String(text).trim(), decimals);
  } catch {
    throw new CliError("BAD_AMOUNT", `${what}: "${text}" is not a number.`);
  }
  if (raw <= 0n) throw new CliError("BAD_AMOUNT", `${what} must be greater than zero.`);
  if (raw > MAX_LIMIT) throw new CliError("BAD_AMOUNT", `${what} is too large for the wallet's spend guard.`);
  return raw;
}

export function presetFor(chain: Chain) {
  return {
    native: { symbol: chain.nativeSymbol, cap: chain.preset.nativeCap, feeHeadroom: chain.preset.feeHeadroom },
    tokens: chain.assets.map((a) => ({ symbol: a.symbol, decimals: a.decimals, cap: chain.preset.caps[a.symbol] ?? "0", checked: a.symbol in chain.preset.caps })),
  };
}

export function compilePolicy(chain: Chain, input: GrantInput, expiry: number): CompiledPolicy {
  if (!input || !Array.isArray(input.tokens)) throw new CliError("BAD_INPUT", "Permissions need a native cap and a token list.");
  if (input.tokens.length === 0) throw new CliError("BAD_INPUT", `Tick at least one token on ${chain.name}.`);
  if (input.tokens.length > MAX_TOKENS) throw new CliError("BAD_INPUT", `At most ${MAX_TOKENS} tokens per session.`);
  const nativeLimit = positiveAmount(input.nativeCap, 18, `${chain.nativeSymbol} cap`);

  const seen = new Set<string>();
  const tokens = input.tokens.map((t) => {
    const asset = requireAsset(chain, t.symbol);
    if (seen.has(asset.address)) throw new CliError("BAD_INPUT", `${asset.symbol} is listed twice.`);
    seen.add(asset.address);
    return { asset, limit: positiveAmount(t.cap, asset.decimals, `${asset.symbol} cap`), cap: String(t.cap).trim() };
  });

  const dex = chain.dex;
  const wrapped = chain.wrappedNative;
  // Every permitted call is listed explicitly, by contract and function.
  const calls: { to: Address; signature: string }[] = [
    { to: dex.router, signature: swapSelector(chain) },
    { to: dex.positionManager, signature: SEL.mint },
    { to: dex.positionManager, signature: SEL.increaseLiquidity },
    { to: dex.positionManager, signature: SEL.decreaseLiquidity },
    { to: dex.positionManager, signature: SEL.collect },
    { to: dex.positionManager, signature: SEL.burn },
    { to: wrapped.address, signature: SEL.deposit },
    { to: wrapped.address, signature: SEL.withdraw },
    { to: wrapped.address, signature: SEL.approve },
  ];
  for (const t of tokens) if (t.asset.address !== wrapped.address) calls.push({ to: t.asset.address, signature: SEL.approve });

  const spend: { limit: bigint; period: "day"; token?: Address }[] = [{ limit: nativeLimit, period: "day" }];
  for (const t of tokens) spend.push({ token: t.asset.address, limit: t.limit, period: "day" });

  const others = tokens.filter((t) => t.asset.address !== wrapped.address).map((t) => t.asset.symbol);
  const until = new Date(expiry * 1000).toISOString().replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC");
  const scopeText = [
    `Call ${dex.name} SwapRouter: exactInputSingle.`,
    `Call ${dex.name} NonfungiblePositionManager: mint, increaseLiquidity, decreaseLiquidity, collect, burn.`,
    `Call ${wrapped.symbol}: deposit, withdraw, approve.`,
    ...(others.length ? [`Call approve on ${others.join(", ")}.`] : []),
    `Spend up to ${String(input.nativeCap).trim()} ${chain.nativeSymbol} per day, relay fees included.`,
    `Spend up to ${tokens.map((t) => `${t.cap} ${t.asset.symbol}`).join(", ")} per day.`,
    "Nothing else: no token transfers, no other contracts.",
    `Until ${until}.`,
  ];

  return {
    permissions: { calls, spend },
    scope: {
      pairs: calls.map((c) => pair(c.to, c.signature)),
      spend: [
        { symbol: chain.nativeSymbol, address: null, cap: String(input.nativeCap).trim(), decimals: 18 },
        ...tokens.map((t) => ({ symbol: t.asset.symbol, address: t.asset.address as string, cap: t.cap, decimals: t.asset.decimals })),
      ],
      period: "day",
    },
    scopeText,
  };
}

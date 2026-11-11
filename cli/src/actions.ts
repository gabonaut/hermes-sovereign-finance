// Typed actions: what the agent may ask for, how they become calls, and how a batch is described.
//
// The agent never encodes calldata. It names an action; this module encodes it with the wallet as
// every recipient and with exact approvals in the same batch. `describe` then decodes the encoded
// calls again and builds the approval sentence from those bytes, not from the agent's wording.
import crypto from "node:crypto";
import { decodeFunctionData, encodeFunctionData, formatUnits, getAddress, isAddress, isHex, parseUnits, type Address, type Hex } from "viem";
import { erc20Abi, pancakeRouterAbi, positionManagerAbi, SEL, uniswapRouterAbi, wrappedAbi } from "./abi.ts";
import { requireAsset, type Asset, type Chain } from "./config.ts";
import { CliError } from "./errors.ts";
import { pair, swapSelector } from "./policy.ts";
import type { ScopeRecord } from "./store.ts";
import { fmt, MAX_TICK, MIN_TICK, poolAddress, priceFromTick, sortAssets, tickSpacingFor } from "./v3.ts";

export type Action =
  | { type: "wrap"; amount: string }
  | { type: "unwrap"; amount: string }
  | { type: "swap"; tokenIn: string; tokenOut: string; fee: number; amountIn: string; minAmountOut: string }
  | { type: "mint"; token0: string; token1: string; fee: number; tickLower: number; tickUpper: number; amount0Desired: string; amount1Desired: string; amount0Min?: string; amount1Min?: string }
  | { type: "increase"; tokenId: string; token0: string; token1: string; amount0Desired: string; amount1Desired: string; amount0Min?: string; amount1Min?: string }
  | { type: "decrease"; tokenId: string; token0: string; token1: string; liquidity: string; amount0Min?: string; amount1Min?: string }
  | { type: "collect"; tokenId: string }
  | { type: "burn"; tokenId: string }
  | { type: "transfer"; token: string; to: string; amount: string }
  | { type: "raw"; to: string; data: string; value?: string };

export type Call = { to: Address; data: Hex; value: bigint };
export type KnownPosition = { token0: Address; token1: Address; fee: number; tickLower: number; tickUpper: number; liquidity: string };
export type PositionCache = Record<string, KnownPosition>;

const MAX_ACTIONS = 12;
const MAX_UINT128 = (1n << 128n) - 1n;

function units(text: unknown, asset: { decimals: number; symbol: string }, what: string, allowZero = false): bigint {
  let raw: bigint;
  try {
    raw = parseUnits(String(text ?? "").trim(), asset.decimals);
  } catch {
    throw new CliError("BAD_ACTION", `${what}: "${text}" is not an amount of ${asset.symbol}.`);
  }
  if (raw < 0n || (!allowZero && raw === 0n)) throw new CliError("BAD_ACTION", `${what} must be greater than zero.`);
  return raw;
}
function tokenId(text: unknown): bigint {
  if (!/^\d{1,30}$/.test(String(text ?? ""))) throw new CliError("BAD_ACTION", `"${text}" is not a position id.`);
  return BigInt(String(text));
}

/** Encode a batch. Deterministic for a given input except for the deadline. */
export function compile(chain: Chain, wallet: Address, actions: Action[], deadline: number): Call[] {
  if (!Array.isArray(actions) || actions.length === 0) throw new CliError("BAD_ACTION", "The batch is empty.");
  if (actions.length > MAX_ACTIONS) throw new CliError("BAD_ACTION", `At most ${MAX_ACTIONS} actions per batch.`);
  // Transfers and raw calls are outside the V3 LP scope, so they never share a batch with scoped actions.
  const unscoped = (a: Action) => a?.type === "raw" || a?.type === "transfer";
  if (actions.some(unscoped) && !actions.every(unscoped)) throw new CliError("BAD_ACTION", "A transfer or raw call cannot share a batch with other actions.");

  const dex = chain.dex;
  const native = { decimals: 18, symbol: chain.nativeSymbol };
  const calls: Call[] = [];
  const approve = (asset: Asset, spender: Address, amount: bigint) =>
    calls.push({ to: asset.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), value: 0n });

  for (const a of actions) {
    switch (a?.type) {
      case "wrap": {
        const amount = units(a.amount, native, "wrap amount");
        calls.push({ to: chain.wrappedNative.address, data: encodeFunctionData({ abi: wrappedAbi, functionName: "deposit" }), value: amount });
        break;
      }
      case "unwrap": {
        const amount = units(a.amount, chain.wrappedNative, "unwrap amount");
        calls.push({ to: chain.wrappedNative.address, data: encodeFunctionData({ abi: wrappedAbi, functionName: "withdraw", args: [amount] }), value: 0n });
        break;
      }
      case "swap": {
        const tin = requireAsset(chain, a.tokenIn);
        const tout = requireAsset(chain, a.tokenOut);
        if (tin.address === tout.address) throw new CliError("BAD_ACTION", "A swap needs two different tokens.");
        tickSpacingFor(chain, Number(a.fee));
        const amountIn = units(a.amountIn, tin, "swap amountIn");
        const minOut = units(a.minAmountOut, tout, "swap minAmountOut");
        approve(tin, dex.router, amountIn);
        const data =
          dex.kind === "pancake"
            ? encodeFunctionData({ abi: pancakeRouterAbi, functionName: "exactInputSingle", args: [{ tokenIn: tin.address, tokenOut: tout.address, fee: Number(a.fee), recipient: wallet, deadline: BigInt(deadline), amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] })
            : encodeFunctionData({ abi: uniswapRouterAbi, functionName: "exactInputSingle", args: [{ tokenIn: tin.address, tokenOut: tout.address, fee: Number(a.fee), recipient: wallet, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
        calls.push({ to: dex.router, data, value: 0n });
        break;
      }
      case "mint": {
        const x = requireAsset(chain, a.token0);
        const y = requireAsset(chain, a.token1);
        const [t0, t1] = sortAssets(x, y);
        if (t0.address !== x.address) throw new CliError("BAD_ACTION", `token0 must be the lower address: use token0 ${t0.symbol}, token1 ${t1.symbol}.`);
        const spacing = tickSpacingFor(chain, Number(a.fee));
        const lo = Number(a.tickLower);
        const hi = Number(a.tickUpper);
        if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo >= hi || lo < MIN_TICK || hi > MAX_TICK) throw new CliError("BAD_ACTION", "tickLower must be below tickUpper and both within range.");
        if (lo % spacing !== 0 || hi % spacing !== 0) throw new CliError("BAD_ACTION", `Ticks must be multiples of ${spacing} for the ${Number(a.fee) / 10000}% tier.`);
        const d0 = units(a.amount0Desired, t0, "amount0Desired", true);
        const d1 = units(a.amount1Desired, t1, "amount1Desired", true);
        if (d0 === 0n && d1 === 0n) throw new CliError("BAD_ACTION", "A mint needs at least one token amount.");
        const m0 = units(a.amount0Min ?? "0", t0, "amount0Min", true);
        const m1 = units(a.amount1Min ?? "0", t1, "amount1Min", true);
        if (d0 > 0n) approve(t0, dex.positionManager, d0);
        if (d1 > 0n) approve(t1, dex.positionManager, d1);
        calls.push({
          to: dex.positionManager,
          data: encodeFunctionData({ abi: positionManagerAbi, functionName: "mint", args: [{ token0: t0.address, token1: t1.address, fee: Number(a.fee), tickLower: lo, tickUpper: hi, amount0Desired: d0, amount1Desired: d1, amount0Min: m0, amount1Min: m1, recipient: wallet, deadline: BigInt(deadline) }] }),
          value: 0n,
        });
        break;
      }
      case "increase": {
        const [t0, t1] = sortAssets(requireAsset(chain, a.token0), requireAsset(chain, a.token1));
        const d0 = units(a.amount0Desired, t0, "amount0Desired", true);
        const d1 = units(a.amount1Desired, t1, "amount1Desired", true);
        if (d0 === 0n && d1 === 0n) throw new CliError("BAD_ACTION", "An increase needs at least one token amount.");
        if (d0 > 0n) approve(t0, dex.positionManager, d0);
        if (d1 > 0n) approve(t1, dex.positionManager, d1);
        calls.push({
          to: dex.positionManager,
          data: encodeFunctionData({ abi: positionManagerAbi, functionName: "increaseLiquidity", args: [{ tokenId: tokenId(a.tokenId), amount0Desired: d0, amount1Desired: d1, amount0Min: units(a.amount0Min ?? "0", t0, "amount0Min", true), amount1Min: units(a.amount1Min ?? "0", t1, "amount1Min", true), deadline: BigInt(deadline) }] }),
          value: 0n,
        });
        break;
      }
      case "decrease": {
        const [t0, t1] = sortAssets(requireAsset(chain, a.token0), requireAsset(chain, a.token1));
        if (!/^\d{1,40}$/.test(String(a.liquidity ?? ""))) throw new CliError("BAD_ACTION", "decrease.liquidity must be the raw liquidity number from the position.");
        const liquidity = BigInt(a.liquidity);
        if (liquidity <= 0n || liquidity > MAX_UINT128) throw new CliError("BAD_ACTION", "decrease.liquidity is out of range.");
        calls.push({
          to: dex.positionManager,
          data: encodeFunctionData({ abi: positionManagerAbi, functionName: "decreaseLiquidity", args: [{ tokenId: tokenId(a.tokenId), liquidity, amount0Min: units(a.amount0Min ?? "0", t0, "amount0Min", true), amount1Min: units(a.amount1Min ?? "0", t1, "amount1Min", true), deadline: BigInt(deadline) }] }),
          value: 0n,
        });
        break;
      }
      case "collect":
        calls.push({ to: dex.positionManager, data: encodeFunctionData({ abi: positionManagerAbi, functionName: "collect", args: [{ tokenId: tokenId(a.tokenId), recipient: wallet, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }] }), value: 0n });
        break;
      case "burn":
        calls.push({ to: dex.positionManager, data: encodeFunctionData({ abi: positionManagerAbi, functionName: "burn", args: [tokenId(a.tokenId)] }), value: 0n });
        break;
      case "transfer": {
        if (!isAddress(String(a.to))) throw new CliError("BAD_ACTION", "transfer.to is not an address.");
        const to = getAddress(String(a.to));
        const isNative = String(a.token ?? "").toLowerCase() === chain.nativeSymbol.toLowerCase() || String(a.token ?? "").toLowerCase() === "native";
        if (isNative) {
          calls.push({ to, data: "0x", value: units(a.amount, native, "transfer amount") });
        } else {
          const asset = requireAsset(chain, a.token);
          calls.push({ to: asset.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, units(a.amount, asset, "transfer amount")] }), value: 0n });
        }
        break;
      }
      case "raw": {
        if (!isAddress(String(a.to))) throw new CliError("BAD_ACTION", "raw.to is not an address.");
        const data = (a.data ?? "0x") as Hex;
        if (!isHex(data) || data.length % 2 !== 0) throw new CliError("BAD_ACTION", "raw.data is not hex.");
        let value = 0n;
        try {
          value = BigInt(a.value ?? "0");
        } catch {
          throw new CliError("BAD_ACTION", "raw.value must be an integer number of wei.");
        }
        if (value < 0n) throw new CliError("BAD_ACTION", "raw.value cannot be negative.");
        calls.push({ to: getAddress(String(a.to)), data, value });
        break;
      }
      default:
        throw new CliError("BAD_ACTION", `Unknown action type "${(a as any)?.type}". Use wrap, unwrap, swap, mint, increase, decrease, collect, burn, transfer or raw.`);
    }
  }
  return calls;
}

// ---- describe ---------------------------------------------------------------

const STABLES = new Set(["USDT", "USDC", "BUSD", "DAI"]);
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const amountText = (raw: bigint, asset: { decimals: number; symbol: string }) => `${fmt(Number(formatUnits(raw, asset.decimals)))} ${asset.symbol}`;
const feeText = (fee: number) => `${fee / 10000}%`;
const assetAt = (chain: Chain, address: string) => chain.assets.find((x) => x.address.toLowerCase() === address.toLowerCase());

/** Price text for a tick range, quoted in the stable token when the pair has one. */
function rangeText(t0: Asset, t1: Asset, lo: number, hi: number): string {
  const pLo = priceFromTick(lo, t0.decimals, t1.decimals);
  const pHi = priceFromTick(hi, t0.decimals, t1.decimals);
  if (STABLES.has(t0.symbol) && !STABLES.has(t1.symbol)) return `${fmt(1 / pHi)} to ${fmt(1 / pLo)} ${t0.symbol} per ${t1.symbol}`;
  return `${fmt(pLo)} to ${fmt(pHi)} ${t1.symbol} per ${t0.symbol}`;
}

export type Description = {
  sentence: string;
  ruleKey: string;
  kind: "lp" | "swap" | "raw" | "other";
  violations: string[];
  parts: string[];
};

/**
 * Decode an encoded batch and say what it does.
 * `scope` is the active session's scope, or null when there is none. Works without a network call.
 */
export function describe(chain: Chain, wallet: Address, calls: Call[], opts: { scope: ScopeRecord | null; keyId8: string; positions: PositionCache; sessionStatus?: string }): Description {
  const dex = chain.dex;
  const violations: string[] = [];
  const parts: string[] = [];
  const approvals: string[] = [];
  const pools = new Map<string, [Asset, Asset]>();
  const swaps: { tin: Asset; tout: Asset }[] = [];
  let npmActions = 0;
  let rawCount = 0;
  let unknownPosition = false;
  const inScope = (to: string, selector: string) => Boolean(opts.scope?.pairs.includes(pair(to, selector)));
  const checkRecipient = (recipient: string, what: string) => {
    if (recipient.toLowerCase() !== wallet.toLowerCase()) violations.push(`${what} would send its proceeds to ${recipient}, not to the wallet.`);
  };
  const poolOfPosition = (id: bigint): { t0: Asset; t1: Asset; fee: number; known: KnownPosition } | null => {
    const known = opts.positions[id.toString()];
    if (!known) return null;
    const t0 = assetAt(chain, known.token0);
    const t1 = assetAt(chain, known.token1);
    if (!t0 || !t1) return null;
    pools.set(poolAddress(chain, t0.address, t1.address, known.fee).toLowerCase(), [t0, t1]);
    return { t0, t1, fee: known.fee, known };
  };

  for (const call of calls) {
    const selector = call.data.slice(0, 10).toLowerCase();
    const to = call.to.toLowerCase();
    const asset = assetAt(chain, call.to);
    try {
      if (to === chain.wrappedNative.address.toLowerCase() && selector === SEL.deposit && call.data.length === 10) {
        parts.push(`wrap ${amountText(call.value, { decimals: 18, symbol: chain.nativeSymbol })}`);
        continue;
      }
      if (to === chain.wrappedNative.address.toLowerCase() && selector === SEL.withdraw) {
        const { args } = decodeFunctionData({ abi: wrappedAbi, data: call.data });
        parts.push(`unwrap ${amountText(args![0] as bigint, chain.wrappedNative)}`);
        continue;
      }
      if (asset && selector === SEL.approve) {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
        const [spender, amount] = args as [Address, bigint];
        const who = spender.toLowerCase() === dex.router.toLowerCase() ? "the router" : spender.toLowerCase() === dex.positionManager.toLowerCase() ? "the position manager" : null;
        if (!who) violations.push(`An approval of ${asset.symbol} names ${spender}, which is neither the ${dex.name} router nor its position manager.`);
        approvals.push(`${amountText(amount, asset)} to ${who ?? spender}`);
        continue;
      }
      if (to === dex.router.toLowerCase() && selector === swapSelector(chain)) {
        const { args } = decodeFunctionData({ abi: dex.kind === "pancake" ? pancakeRouterAbi : uniswapRouterAbi, data: call.data });
        const p = args![0] as any;
        const tin = assetAt(chain, p.tokenIn);
        const tout = assetAt(chain, p.tokenOut);
        if (!tin || !tout) {
          violations.push("A swap uses a token outside this plugin's asset list.");
          continue;
        }
        checkRecipient(p.recipient, "A swap");
        swaps.push({ tin, tout });
        parts.push(`swap ${amountText(p.amountIn, tin)} for at least ${amountText(p.amountOutMinimum, tout)} on ${dex.name} (${feeText(Number(p.fee))} pool)`);
        continue;
      }
      if (to === dex.positionManager.toLowerCase() && [SEL.mint, SEL.increaseLiquidity, SEL.decreaseLiquidity, SEL.collect, SEL.burn].includes(selector as Hex)) {
        const { functionName, args } = decodeFunctionData({ abi: positionManagerAbi, data: call.data });
        npmActions++;
        if (functionName === "mint") {
          const p = args![0] as any;
          const t0 = assetAt(chain, p.token0);
          const t1 = assetAt(chain, p.token1);
          if (!t0 || !t1) {
            violations.push("A mint uses a token outside this plugin's asset list.");
            continue;
          }
          checkRecipient(p.recipient, "A new position");
          pools.set(poolAddress(chain, t0.address, t1.address, Number(p.fee)).toLowerCase(), [t0, t1]);
          parts.push(`open a ${t0.symbol}/${t1.symbol} ${feeText(Number(p.fee))} position from ${rangeText(t0, t1, Number(p.tickLower), Number(p.tickUpper))} with up to ${amountText(p.amount0Desired, t0)} and ${amountText(p.amount1Desired, t1)}`);
        } else if (functionName === "burn") {
          const id = args![0] as bigint;
          if (!poolOfPosition(id)) unknownPosition = true;
          parts.push(`burn the emptied position #${id}`);
        } else {
          const p = args![0] as any;
          const pos = poolOfPosition(p.tokenId);
          if (!pos) unknownPosition = true;
          const label = pos ? `position #${p.tokenId} (${pos.t0.symbol}/${pos.t1.symbol} ${feeText(pos.fee)})` : `position #${p.tokenId}`;
          if (functionName === "collect") {
            checkRecipient(p.recipient, "A collect");
            parts.push(`collect the tokens and fees of ${label} into the wallet`);
          } else if (functionName === "decreaseLiquidity") {
            const all = pos && BigInt(pos.known.liquidity) === (p.liquidity as bigint);
            parts.push(`remove ${all ? "all" : "part of the"} liquidity from ${label}`);
          } else {
            parts.push(pos ? `add up to ${amountText(p.amount0Desired, pos.t0)} and ${amountText(p.amount1Desired, pos.t1)} to ${label}` : `add liquidity to ${label}`);
          }
        }
        continue;
      }
    } catch {
      /* fall through to the raw description */
    }

    // Anything else is a raw call.
    rawCount++;
    if (inScope(call.to, selector)) {
      violations.push(`A raw call targets ${call.to} ${selector}, which the session covers. Use a typed action for it so recipients and approvals are checked.`);
    }
    let what = call.data === "0x" ? `send ${amountText(call.value, { decimals: 18, symbol: chain.nativeSymbol })} to ${call.to}` : `call ${call.to} with selector ${selector}`;
    if (asset && selector === SEL.transfer) {
      try {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
        what = `transfer ${amountText(args![1] as bigint, asset)} to ${args![0]}`;
      } catch {
        /* keep the generic text */
      }
    } else if (asset) {
      what = `call ${asset.symbol} (${call.to}) with selector ${selector}`;
    }
    if (call.value > 0n && call.data !== "0x") what += `, sending ${amountText(call.value, { decimals: 18, symbol: chain.nativeSymbol })}`;
    parts.push(what);
  }

  if (rawCount > 0 && rawCount !== calls.length) violations.push("A transfer or raw call cannot share a batch with other actions.");

  // Classify the batch. Only a batch that provably stays inside one pool gets a reusable key.
  let kind: Description["kind"] = "other";
  let ruleKey = `sovereign:${chain.chainId}:once:${crypto.randomBytes(6).toString("hex")}`;
  if (rawCount > 0) {
    kind = "raw";
  } else if (npmActions > 0 && pools.size === 1 && !unknownPosition) {
    const [pool, poolAssets] = [...pools.entries()][0];
    // Every swap in the batch must end in one of the pool's tokens and start from one of them or the wrapped native coin.
    const inPool = (a: Asset) => poolAssets.some((x) => x.address === a.address);
    const swapsOk = swaps.every((s) => inPool(s.tout) && (inPool(s.tin) || s.tin.address === chain.wrappedNative.address));
    if (swapsOk) {
      kind = "lp";
      ruleKey = `sovereign:${chain.chainId}:${opts.keyId8}:lp:${pool}`;
    }
  } else if (npmActions === 0 && swaps.length === 1) {
    kind = "swap";
    ruleKey = `sovereign:${chain.chainId}:${opts.keyId8}:swap:${swaps[0].tin.symbol}:${swaps[0].tout.symbol}`;
  }

  // One statement per line: the approval prompt keeps line breaks, and a wall of text is hard to check.
  const step = (text: string) => `  ${parts.length > 1 ? "- " : ""}${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  let sentence = `On ${chain.name}, from wallet ${short(wallet)}:\n${parts.map(step).join("\n")}`;
  if (approvals.length) sentence += `\nExact approvals in this batch: ${approvals.join(", ")}. The wallet clears them when the batch ends.`;
  if (kind === "raw") sentence += "\nThe session does not cover this call, so the wallet's onchain policy is expected to refuse it.";
  else sentence += "\nEverything this batch produces stays in the wallet.";
  if (opts.sessionStatus === "revoked") sentence += "\nThis session was revoked, so the wallet is expected to refuse the batch.";
  if (kind === "lp") sentence += `\nAlways lets the agent run future batches for this pool on ${chain.name} without asking, within the onchain caps, until this session is revoked or replaced.`;
  if (kind === "swap") sentence += `\nAlways lets the agent repeat this swap direction on ${chain.name} without asking, within the onchain caps, until this session is revoked or replaced.`;

  return { sentence, ruleKey, kind, violations, parts };
}

// One error shape for the whole CLI, plus decoding of what the relay and the wallet contract return.
import { decodeErrorResult, toFunctionSelector, type Hex } from "viem";
import { ACCOUNT_ERRORS } from "./abi.ts";

export class CliError extends Error {
  code: string;
  extra: Record<string, unknown>;
  constructor(code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

const ERROR_SIGNATURES: Record<string, string> = {
  "UnauthorizedCall(bytes32,address,bytes)": "UnauthorizedCall",
  "ExceededSpendLimit(address)": "ExceededSpendLimit",
  "NoSpendPermissions()": "NoSpendPermissions",
  "Unauthorized()": "Unauthorized",
  "KeyDoesNotExist()": "KeyDoesNotExist",
  "KeyHashIsZero()": "KeyHashIsZero",
  "InsufficientBalance()": "InsufficientBalance",
};
const SELECTOR_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(ERROR_SIGNATURES).map(([sig, name]) => [toFunctionSelector(`function ${sig}`), name]),
);

const EXPLAIN: Record<string, string> = {
  UnauthorizedCall: "The wallet refused this call: the session key is not allowed to call that function on that contract.",
  ExceededSpendLimit: "The wallet refused this batch: it would exceed the session's daily spend cap for a token.",
  NoSpendPermissions: "The wallet refused this batch: it moves a token the session has no spend cap for.",
  Unauthorized: "The wallet refused this key.",
  KeyDoesNotExist: "The wallet does not know this session key. It was revoked or never authorized.",
  InsufficientBalance: "The wallet's balance is too low for this batch.",
};

function collectText(e: any, depth = 0, out: string[] = []): string[] {
  if (!e || depth > 6) return out;
  for (const k of ["shortMessage", "message", "details"]) if (typeof e[k] === "string") out.push(e[k]);
  if (typeof e.data === "string") out.push(e.data);
  else if (e.data && typeof e.data === "object") {
    try {
      out.push(JSON.stringify(e.data));
    } catch {
      /* ignore */
    }
  }
  if (Array.isArray(e.metaMessages)) out.push(...e.metaMessages.filter((m: unknown) => typeof m === "string"));
  if (e.cause) collectText(e.cause, depth + 1, out);
  return out;
}

export type DecodedFailure = { code: string; message: string; revert: string | null; relayCode: number | null; raw: string };

/** Turn whatever the SDK, the relay or viem threw into a code, a plain sentence and the raw text. */
/** The plugin's own error, if one sits anywhere in the cause chain (libraries wrap what they are handed). */
function ownError(e: any, depth = 0): CliError | null {
  if (!e || depth > 6) return null;
  if (e instanceof CliError) return e;
  return ownError(e.cause, depth + 1);
}

const REASONS: Record<string, string> = {
  STF: "the wallet does not hold enough of a token this batch spends. Check the balances, and wrap or swap first if the plan had those steps",
  "Too little received": "the swap would return less than the minimum set for it. Ask for a fresh plan",
  "Price slippage check": "the pool price moved past the plan's limits. Ask for a fresh plan",
  "Transaction too old": "the plan's deadline has passed. Ask for a fresh plan",
};

/** The text of a Solidity Error(string) revert found in an error message, or null. */
function revertText(raw: string): string | null {
  const m = /08c379a0([0-9a-fA-F]{128,})/.exec(raw);
  if (!m) return null;
  try {
    const length = Number(BigInt("0x" + m[1].slice(64, 128)));
    if (length <= 0 || length > 200) return null;
    return Buffer.from(m[1].slice(128, 128 + length * 2), "hex").toString("utf8").replace(/[^\x20-\x7e]/g, "").trim() || null;
  } catch {
    return null;
  }
}

/** What to say when the relay takes a batch and then drops it. `note` is the network's own caveat, when it has one. */
export function relayDropped(note?: string | null): string {
  const base = "The relay dropped this batch without sending a transaction, so nothing was charged. The usual causes are a native cap or balance too low for the relay fee, or a batch that needs more gas than the relay allowed.";
  return note ? `${base} ${note}` : base;
}

export function decodeFailure(e: unknown): DecodedFailure {
  const own = ownError(e);
  if (own) return { code: own.code, message: own.message, revert: null, relayCode: null, raw: own.message };
  const parts = [...new Set(collectText(e))];
  const raw = parts.join(" | ").slice(0, 4000);
  // A contract's own revert text, when the batch would fail in a DEX or token contract.
  const reason = revertText(raw);
  if (reason) {
    const why = REASONS[reason] ?? `a contract in the batch reverted with "${reason}"`;
    return { code: "BATCH_WOULD_REVERT", message: `Nothing was sent: ${why}.`, revert: reason, relayCode: null, raw };
  }
  let revert: string | null = null;
  for (const name of Object.values(ERROR_SIGNATURES)) {
    if (new RegExp(`\\b${name}\\b`).test(raw)) {
      revert = name;
      break;
    }
  }
  if (!revert) {
    for (const m of raw.matchAll(/0x[0-9a-fA-F]{8,}/g)) {
      const blob = m[0] as Hex;
      const name = SELECTOR_TO_NAME[blob.slice(0, 10).toLowerCase()];
      if (!name) continue;
      revert = name;
      try {
        const d = decodeErrorResult({ abi: ACCOUNT_ERRORS, data: blob });
        revert = d.errorName;
      } catch {
        /* the selector alone is enough */
      }
      break;
    }
  }
  if (!revert) {
    for (const [sel, name] of Object.entries(SELECTOR_TO_NAME)) {
      if (raw.toLowerCase().includes(sel.slice(2))) {
        revert = name;
        break;
      }
    }
  }
  const relay = raw.match(/relay code (\d+)/i) ?? raw.match(/statusCode["=: ]+(\d{3})/);
  const relayCode = relay ? Number(relay[1]) : null;
  let code = "FAILED";
  let message = parts[0] ?? String(e);
  if (/key hash 0x[0-9a-f]+ is unknown/i.test(raw)) {
    code = "WALLET_KEY_UNKNOWN";
    message = "The wallet does not accept this session key. It was revoked, or the session was never activated on this network. The user can activate new permissions in the Sovereign Finance pane in Hermes Desktop, with their passkey.";
  } else if (revert) {
    code = `WALLET_${revert.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
    message = EXPLAIN[revert] ?? `The wallet refused this batch (${revert}).`;
  } else if (relayCode === 300) {
    code = "RELAY_REJECTED";
    message = relayDropped();
  } else if (/quote.{0,40}expired|expired.{0,40}quote|intent.{0,20}expired|Invalid parameters were provided to the RPC method/i.test(raw)) {
    code = "QUOTE_EXPIRED";
    message = "The relay did not accept the signed request, and nothing was sent. This happens when the approval takes longer than the relay's fee quote lasts, which is 30 seconds on mainnet. Start again and approve the passkey prompt straight away.";
  } else if (/insufficient|not enough/i.test(raw)) {
    code = "INSUFFICIENT_FUNDS";
  }
  return { code, message, revert, relayCode, raw };
}

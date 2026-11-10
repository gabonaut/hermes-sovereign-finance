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

export function decodeFailure(e: unknown): DecodedFailure {
  const own = ownError(e);
  if (own) return { code: own.code, message: own.message, revert: null, relayCode: null, raw: own.message };
  const parts = [...new Set(collectText(e))];
  const raw = parts.join(" | ").slice(0, 4000);
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
    message = "The wallet does not accept this session key. It was revoked, or the session was never activated on this network.";
  } else if (revert) {
    code = `WALLET_${revert.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
    message = EXPLAIN[revert] ?? `The wallet refused this batch (${revert}).`;
  } else if (relayCode === 300) {
    code = "RELAY_REJECTED";
    message = "The relay rejected this batch before sending it. The usual cause is a native spend cap or balance too low to cover the relay fee.";
  } else if (/quote.{0,40}expired|expired.{0,40}quote|intent.{0,20}expired/i.test(raw)) {
    code = "QUOTE_EXPIRED";
    message = "The approval took longer than the relay's fee quote lasts (30 seconds on mainnet). Nothing was sent. Start again and approve the passkey prompt promptly.";
  } else if (/insufficient|not enough/i.test(raw)) {
    code = "INSUFFICIENT_FUNDS";
  }
  return { code, message, revert, relayCode, raw };
}

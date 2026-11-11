// The plugin data directory. Directories are 0700, files 0600, key files are created exclusively.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Mode } from "./config.ts";

export class Store {
  readonly dir: string;
  constructor(dir: string) {
    if (!dir) throw new Error("--data-dir is required");
    this.dir = path.resolve(dir);
    for (const d of ["", "keys", "sessions", "jobs", "drafts", "cache", "history"]) this.ensureDir(path.join(this.dir, d));
  }

  private ensureDir(d: string) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    try {
      if ((fs.statSync(d).mode & 0o777) !== 0o700) fs.chmodSync(d, 0o700);
    } catch {
      /* best effort */
    }
  }

  path(...parts: string[]) {
    return path.join(this.dir, ...parts);
  }

  readJson<T = any>(rel: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(this.path(rel), "utf8"));
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  }

  /** Atomic write: temp file in the same directory, then rename. */
  writeJson(rel: string, value: unknown) {
    const target = this.path(rel);
    const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, target);
  }

  remove(rel: string) {
    try {
      fs.unlinkSync(this.path(rel));
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
  }

  /** Create a secret file. Fails if it already exists, so a key is never overwritten. */
  writeSecretOnce(rel: string, value: string) {
    fs.writeFileSync(this.path(rel), value, { mode: 0o600, flag: "wx" });
  }

  /** Read a secret file, refusing one that other users could read. */
  readSecret(rel: string): string | null {
    const p = this.path(rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
    if ((st.mode & 0o077) !== 0) {
      throw new Error(`${p} is readable by other users (mode ${(st.mode & 0o777).toString(8)}). Run chmod 600 on it and retry.`);
    }
    return fs.readFileSync(p, "utf8").trim();
  }

  exists(rel: string) {
    return fs.existsSync(this.path(rel));
  }

  // ---- typed accessors -------------------------------------------------

  mode(): Mode {
    const s = this.readJson<{ mode?: Mode }>("state.json");
    return s?.mode === "mainnet" ? "mainnet" : "testnet";
  }
  setMode(mode: Mode) {
    const s = this.readJson<any>("state.json") ?? {};
    this.writeJson("state.json", { ...s, mode });
  }

  wallet(mode: Mode): WalletRecord | null {
    return this.readJson<WalletRecord>(`wallet-${mode}.json`);
  }
  saveWallet(mode: Mode, w: WalletRecord) {
    this.writeJson(`wallet-${mode}.json`, w);
  }

  session(chainId: number): SessionRecord | null {
    return this.readJson<SessionRecord>(`sessions/${chainId}.json`);
  }
  saveSession(chainId: number, s: SessionRecord) {
    this.writeJson(`sessions/${chainId}.json`, s);
  }
  sessionKeyRel(chainId: number, keyId8: string) {
    return `keys/session-${chainId}-${keyId8}.key`;
  }

  draft(mode: Mode): any | null {
    return this.readJson(`drafts/${mode}.json`);
  }
  saveDraft(mode: Mode, d: any) {
    this.writeJson(`drafts/${mode}.json`, d);
  }
}

export type WalletRecord = {
  address: `0x${string}`;
  /** Public passkey handle: credential id, public key and relying party id. No secret. */
  credential: { kind: "webauthn"; id: string; publicKey: `0x${string}`; rpId?: string };
  chainIds: number[];
  createdAt: string;
};

export type SessionRecord = {
  chainId: number;
  status: "pending" | "active" | "revoked";
  keyId: `0x${string}`;
  publicKey: `0x${string}`;
  keyFile: string;
  expiry: number;
  /** serializeSession output. Set once the grant confirms. */
  serialized: any | null;
  scope: ScopeRecord;
  scopeText: string[];
  draftId: string;
  grantTx: string | null;
  grantedAt: string | null;
  revokeTx: string | null;
  revokedAt: string | null;
  charged: string | null;
  /** Grants already confirmed for a pending session, on a network that activates in stages. */
  stagesDone?: number;
  /** Transaction hash of every confirmed grant, in order. */
  grantTxs?: string[];
};

export type ScopeRecord = {
  /** Lowercase "address:selector" pairs the session may call. */
  pairs: string[];
  /** Asset symbols with a spend entry, plus "native". */
  spend: { symbol: string; address: string | null; cap: string; decimals: number }[];
  period: "day";
};

// One wallet is in use per mode. The others are set aside: their records move to
// wallets/<mode>/<address>/ and come back when the wallet is picked again. Nothing is deleted,
// and session key files never move.
import fs from "node:fs";
import path from "node:path";
import { chainsFor, type Mode } from "./config.ts";
import { CliError } from "./errors.ts";
import type { Store, WalletRecord } from "./store.ts";

export type AsideWallet = { address: `0x${string}`; setAsideAt: string | null };

const folder = (mode: Mode, address: string) => `wallets/${mode}/${address.toLowerCase()}`;

function move(store: Store, from: string, to: string) {
  if (!store.exists(from)) return;
  fs.mkdirSync(path.dirname(store.path(to)), { recursive: true, mode: 0o700 });
  fs.renameSync(store.path(from), store.path(to));
}

export function listAside(store: Store, mode: Mode): AsideWallet[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(store.path("wallets", mode));
  } catch {
    return [];
  }
  const out: AsideWallet[] = [];
  for (const name of names) {
    const rec = store.readJson<WalletRecord & { setAsideAt?: string }>(`wallets/${mode}/${name}/wallet.json`);
    if (rec?.address) out.push({ address: rec.address, setAsideAt: rec.setAsideAt ?? null });
  }
  return out.sort((a, b) => (b.setAsideAt ?? "").localeCompare(a.setAsideAt ?? ""));
}

/** Put the wallet in use away, with its session records and its permission draft. */
export function setAside(store: Store, mode: Mode): { address: `0x${string}` } {
  const wallet = store.wallet(mode);
  if (!wallet) throw new CliError("NO_WALLET", `There is no ${mode} wallet in use.`);
  const dir = folder(mode, wallet.address);
  // A leftover folder for the same address is kept under another name, never overwritten.
  if (store.exists(dir)) fs.renameSync(store.path(dir), store.path(`${dir}.${Date.now()}`));
  fs.mkdirSync(store.path(dir, "sessions"), { recursive: true, mode: 0o700 });
  for (const chain of chainsFor(mode)) move(store, `sessions/${chain.chainId}.json`, `${dir}/sessions/${chain.chainId}.json`);
  move(store, `drafts/${mode}.json`, `${dir}/draft.json`);
  store.writeJson(`${dir}/wallet.json`, { ...wallet, setAsideAt: new Date().toISOString() });
  store.remove(`wallet-${mode}.json`);
  return { address: wallet.address };
}

/** Bring a wallet that was set aside back into use. Returns false when there is none for the address. */
export function restore(store: Store, mode: Mode, address: string): boolean {
  const dir = folder(mode, address);
  const rec = store.readJson<WalletRecord & { setAsideAt?: string }>(`${dir}/wallet.json`);
  if (!rec) return false;
  if (store.wallet(mode)) throw new CliError("WALLET_EXISTS", `A ${mode} wallet is already in use.`);
  for (const chain of chainsFor(mode)) move(store, `${dir}/sessions/${chain.chainId}.json`, `sessions/${chain.chainId}.json`);
  move(store, `${dir}/draft.json`, `drafts/${mode}.json`);
  const { setAsideAt: _dropped, ...wallet } = rec;
  store.saveWallet(mode, wallet);
  fs.rmSync(store.path(dir), { recursive: true, force: true });
  return true;
}

/** Switch to a wallet that was set aside, putting the one in use away first. */
export function useWallet(store: Store, mode: Mode, address: unknown): { address: string } {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new CliError("BAD_INPUT", "Pick a wallet.");
  if (!store.exists(`${folder(mode, address)}/wallet.json`)) throw new CliError("NO_WALLET", "That wallet is not among the ones set aside here. Use Recover from passkey instead.");
  if (store.wallet(mode)) setAside(store, mode);
  restore(store, mode, address);
  return { address: store.wallet(mode)!.address };
}

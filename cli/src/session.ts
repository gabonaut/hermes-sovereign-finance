// Commands that use only the session key or only read: status and execute.
import { type Address, type Hex } from "viem";
import { deserializeSession, signerFromPrivateKey } from "@altananetwork/sdk";
import { positionManagerAbi } from "./abi.ts";
import { compile, describe, type Action } from "./actions.ts";
import { adoptPending } from "./adopt.ts";
import { addressUrl, altanaClient, chainFor, chainsFor, keystoreAccountUrl, keystoreKeyUrl, rpc, txUrl, type Chain, type Mode, type NetworkKey } from "./config.ts";
import { balances, isValidKey } from "./chainread.ts";
import { CliError, decodeFailure, relayDropped } from "./errors.ts";
import { listPositions, positionCache } from "./positions.ts";
import type { SessionRecord, Store } from "./store.ts";

export type Ctx = { store: Store; mode: Mode; log: (line: string) => void };

function sessionView(chain: Chain, record: SessionRecord | null, valid: boolean | null) {
  if (!record || record.status === "pending") return null;
  const now = Math.floor(Date.now() / 1000);
  const status = record.status === "revoked" || valid === false ? "revoked" : record.expiry <= now ? "expired" : "active";
  return {
    status,
    keyId: record.keyId,
    expiry: record.expiry,
    scopeText: record.scopeText,
    caps: record.scope.spend.map((s) => ({ symbol: s.symbol, capPerDay: s.cap })),
    keystoreKeyUrl: keystoreKeyUrl(chain, record.keyId),
    grantTxUrl: record.grantTx ? txUrl(chain, record.grantTx) : null,
    revokeTxUrl: record.revokeTx ? txUrl(chain, record.revokeTx) : null,
  };
}

export async function networkStatus(ctx: Ctx, chain: Chain, opts: { positions: boolean }) {
  const wallet = ctx.store.wallet(ctx.mode);
  const base = {
    key: chain.key,
    chainId: chain.chainId,
    name: chain.name,
    shortName: chain.shortName,
    nativeSymbol: chain.nativeSymbol,
    dex: chain.dex.name,
    explorerUrl: chain.explorerUrl,
    addressUrl: wallet ? addressUrl(chain, wallet.address) : null,
    keystoreAccountUrl: wallet ? keystoreAccountUrl(chain, wallet.address) : null,
  };
  if (!wallet) return { ...base, asOf: null, error: null, balances: null, session: null, positions: [] };
  // A grant that confirmed after the plugin stopped waiting shows up here as an active session.
  const record = await adoptPending(ctx.store, ctx.mode, chain, wallet.address);
  try {
    const [bal, valid, positions] = await Promise.all([
      balances(chain, wallet.address),
      record && record.status === "active" ? isValidKey(chain, wallet.address, record.keyId) : Promise.resolve(null),
      opts.positions ? listPositions(ctx.store, chain, wallet.address) : Promise.resolve([]),
    ]);
    return {
      ...base,
      asOf: new Date().toISOString(),
      error: null,
      balances: { native: bal.native, tokens: bal.tokens.map((t) => ({ symbol: t.symbol, amount: t.amount })) },
      session: sessionView(chain, record, valid),
      positions,
    };
  } catch (e) {
    const f = decodeFailure(e);
    ctx.log(`status ${chain.name} failed: ${f.raw}`);
    return { ...base, asOf: null, error: `Could not read ${chain.name}: ${f.message}`.slice(0, 300), balances: null, session: sessionView(chain, record, null), positions: [] };
  }
}

export async function status(ctx: Ctx, input: { network?: NetworkKey; positions?: boolean }) {
  const chains = input?.network ? [chainFor(ctx.mode, input.network)] : chainsFor(ctx.mode);
  const wallet = ctx.store.wallet(ctx.mode);
  const networks = await Promise.all(chains.map((c) => networkStatus(ctx, c, { positions: input?.positions !== false })));
  return { mode: ctx.mode, wallet: wallet ? { address: wallet.address } : null, networks };
}

function loadSession(ctx: Ctx, chain: Chain) {
  const wallet = ctx.store.wallet(ctx.mode);
  if (!wallet) throw new CliError("NO_WALLET", "There is no wallet yet. Create one in the Sovereign Finance pane.");
  const record = ctx.store.session(chain.chainId);
  if (!record || record.status === "pending" || !record.serialized) {
    throw new CliError("NO_SESSION", `The agent has no session on ${chain.name}. Set permissions and activate them in the Sovereign Finance pane.`);
  }
  return { wallet, record };
}

/** Compile and describe a batch without touching the network. The approval hook calls this. */
export function describeBatch(ctx: Ctx, input: { network: NetworkKey; actions: Action[] }) {
  const chain = chainFor(ctx.mode, input.network);
  const { wallet, record } = loadSession(ctx, chain);
  const calls = compile(chain, wallet.address, input.actions, Math.floor(Date.now() / 1000) + 1200);
  const d = describe(chain, wallet.address, calls, { scope: record.scope, keyId8: record.keyId.slice(2, 10), positions: positionCache(ctx.store, chain.chainId), sessionStatus: record.status });
  return { ...d, network: input.network, chainId: chain.chainId, calls: calls.length };
}

export async function execute(ctx: Ctx, input: { network: NetworkKey; actions: Action[] }) {
  const chain = chainFor(ctx.mode, input.network);
  const { wallet, record } = loadSession(ctx, chain);
  const secret = ctx.store.readSecret(record.keyFile);
  if (!secret) throw new CliError("KEY_MISSING", `The session key file for ${chain.name} is missing from the plugin data directory.`);
  const calls = compile(chain, wallet.address, input.actions, Math.floor(Date.now() / 1000) + 1200);
  const d = describe(chain, wallet.address, calls, { scope: record.scope, keyId8: record.keyId.slice(2, 10), positions: positionCache(ctx.store, chain.chainId), sessionStatus: record.status });
  if (d.violations.length) throw new CliError("VIOLATION", d.violations.join(" "), { violations: d.violations });

  // Positions touched by the batch must belong to the wallet.
  const ids = new Set<string>();
  for (const a of input.actions) if ("tokenId" in a && a.tokenId) ids.add(String(a.tokenId));
  for (const id of ids) {
    const owner = (await rpc(chain).readContract({ address: chain.dex.positionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => null)) as Address | null;
    if (!owner || owner.toLowerCase() !== wallet.address.toLowerCase()) throw new CliError("VIOLATION", `Position #${id} does not belong to the wallet.`);
  }

  const session = deserializeSession(record.serialized, signerFromPrivateKey(secret as Hex));
  const client = altanaClient(chainsFor(ctx.mode));
  try {
    const res = await client.execute({ session, calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value })) as any, chainId: chain.chainId });
    if (res.status === "FAILED") {
      return { ok: false, network: input.network, did: d.parts, error: { code: res.statusCode === 300 ? "RELAY_REJECTED" : "FAILED", message: res.statusCode === 300 ? relayDropped(chain.relayNote) : `The batch did not confirm (relay code ${res.statusCode ?? "unknown"}).`, relayCode: res.statusCode ?? null }, txUrl: res.transactionHash ? txUrl(chain, res.transactionHash) : null };
    }
    // Refresh the position cache so the next approval sentence knows any new position.
    await listPositions(ctx.store, chain, wallet.address).catch(() => {});
    return { ok: true, network: input.network, status: res.status.toLowerCase(), did: d.parts, txHash: res.transactionHash ?? null, txUrl: res.transactionHash ? txUrl(chain, res.transactionHash) : null };
  } catch (e) {
    const f = decodeFailure(e);
    ctx.log(`execute ${chain.name} failed: ${f.raw}`);
    return { ok: false, network: input.network, did: d.parts, error: { code: f.code, message: f.code === "RELAY_REJECTED" ? relayDropped(chain.relayNote) : f.message, revert: f.revert, relayCode: f.relayCode, raw: f.raw.slice(0, 1200) } };
  }
}

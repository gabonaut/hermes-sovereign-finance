// Admin commands. Every one of them is signed by the wallet's passkey, never by a key on disk.
import crypto from "node:crypto";
import { encodeFunctionData, formatUnits, getAddress, keccak256, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { serializeSession, signerFromPasskey, signerFromPrivateKey } from "@altananetwork/sdk";
import { erc20Abi } from "./abi.ts";
import { altanaClient, chainFor, chainsFor, findAsset, isNetworkKey, keystoreKeyUrl, rpc, txUrl, type Chain, type Mode, type NetworkKey } from "./config.ts";
import { balances, keystoreKeys, nativeBalance, registrationFee, relayServes } from "./chainread.ts";
import { CliError, decodeFailure } from "./errors.ts";
import type { JobReporter } from "./job.ts";
import { compilePolicy, type GrantInput } from "./policy.ts";
import type { SessionRecord, Store, WalletRecord } from "./store.ts";
import { RP_ID, webAuthnFns, type WebAuthnTransport } from "./webauthn.ts";

export type AdminCtx = {
  store: Store;
  mode: Mode;
  job: JobReporter;
  log: (line: string) => void;
  /** Opens the channel to the user's authenticator. The shipped one is a page on localhost. */
  openTransport: (job: JobReporter) => Promise<WebAuthnTransport>;
};

const DRAFT_MAX_AGE_MS = 24 * 3600 * 1000;

function requireWallet(ctx: AdminCtx): WalletRecord {
  const w = ctx.store.wallet(ctx.mode);
  if (!w) throw new CliError("NO_WALLET", `No ${ctx.mode} wallet yet. Create one first.`);
  return w;
}

/** Run `fn` with the SDK's WebAuthn functions wired to a transport, and always close the transport. */
async function withPasskey<T>(ctx: AdminCtx, fn: (fns: ReturnType<typeof webAuthnFns>, say: (prompt: string) => void) => Promise<T>, intro?: string): Promise<T> {
  const transport = await ctx.openTransport(ctx.job);
  let prompt = "";
  let ok = false;
  try {
    // Signing actions wait for the user first, so the relay's short-lived quote is not spent on opening a tab.
    if (intro && transport.ready) await transport.ready(intro);
    const out = await fn(webAuthnFns(transport, () => prompt), (p) => (prompt = p));
    ok = true;
    return out;
  } finally {
    await transport.close(ok ? "Done. You can close this tab and return to Hermes." : "This request ended. You can close this tab and return to Hermes.").catch(() => {});
  }
}

async function preflightRelays(chains: Chain[]) {
  for (const chain of chains) {
    const ok = await relayServes(chain).catch(() => false);
    if (!ok) throw new CliError("RELAY_UNAVAILABLE", `The Altana relay does not answer for ${chain.name} right now. Nothing was created. Try again in a minute.`);
  }
}

export async function createWallet(ctx: AdminCtx) {
  if (ctx.store.wallet(ctx.mode)) throw new CliError("WALLET_EXISTS", `A ${ctx.mode} wallet already exists.`);
  const chains = chainsFor(ctx.mode);
  ctx.job.step("Checking the relay");
  await preflightRelays(chains);
  const client = altanaClient(chains);
  const where = chains.map((c) => c.name).join(" and ");
  const { address, signer } = await withPasskey(ctx, async (fns, say) => {
    say(`Create the passkey that controls your wallet on ${where}.`);
    ctx.job.step("Creating the passkey");
    return client.createPasskeyWallet({ name: ctx.mode === "mainnet" ? "Sovereign Finance" : "Sovereign Finance (testnet)", rpId: RP_ID, webAuthn: fns });
  });
  const cred = signer.credential;
  if (cred.kind !== "webauthn") throw new CliError("UNEXPECTED", "The SDK returned a credential that is not a passkey.");
  ctx.store.saveWallet(ctx.mode, {
    address: getAddress(address),
    credential: { kind: "webauthn", id: cred.id, publicKey: cred.publicKey, rpId: cred.rpId ?? RP_ID },
    chainIds: chains.map((c) => c.chainId),
    createdAt: new Date().toISOString(),
  });
  return { address: getAddress(address) };
}

export async function recoverWallet(ctx: AdminCtx) {
  if (ctx.store.wallet(ctx.mode)) throw new CliError("WALLET_EXISTS", `A ${ctx.mode} wallet already exists.`);
  const chains = chainsFor(ctx.mode);
  const client = altanaClient(chains);
  const { address, signer } = await withPasskey(ctx, async (fns, say) => {
    say(`Pick the passkey of your Sovereign Finance wallet. The address is read from the passkey and its key from Keystore on ${chains[0].name}.`);
    ctx.job.step("Reading the passkey");
    return client.recoverFromPasskey({ rpId: RP_ID, webAuthn: fns, chainId: chains[0].chainId });
  });
  const cred = signer.credential;
  if (cred.kind !== "webauthn") throw new CliError("UNEXPECTED", "The SDK returned a credential that is not a passkey.");
  ctx.store.saveWallet(ctx.mode, {
    address: getAddress(address),
    credential: { kind: "webauthn", id: cred.id, publicKey: cred.publicKey, rpId: cred.rpId ?? RP_ID },
    chainIds: chains.map((c) => c.chainId),
    createdAt: new Date().toISOString(),
  });
  return { address: getAddress(address) };
}

/** Gas the grant intent is expected to use. Calibrated against testnet grants; shown as an estimate. */
function estimateGrantGas(callEntries: number, spendEntries: number, firstAction: boolean): bigint {
  return BigInt(450_000 + callEntries * 28_000 + spendEntries * 55_000 + (firstAction ? 350_000 : 0));
}

/** A native amount for display: six decimals, rounded up so a quoted cost is never an understatement. */
function ceil6(raw: bigint): string {
  const unit = 10n ** 12n;
  return formatUnits(((raw + unit - 1n) / unit) * unit, 18);
}

async function costOf(chain: Chain, wallet: Address, callEntries: number, spendEntries: number) {
  const client = rpc(chain);
  const [fee, keys, gasPrice, balance] = await Promise.all([registrationFee(chain), keystoreKeys(chain, wallet), client.getGasPrice(), nativeBalance(chain, wallet)]);
  const firstAction = keys.length === 0;
  const keystoreFee = fee * (firstAction ? 2n : 1n);
  const relayFee = (estimateGrantGas(callEntries, spendEntries, firstAction) * gasPrice * 13n) / 10n;
  const total = keystoreFee + relayFee;
  return {
    cost: {
      keystoreFee: ceil6(keystoreFee),
      relayFeeEstimate: ceil6(relayFee),
      total: ceil6(total),
      nativeSymbol: chain.nativeSymbol,
      firstAction,
    },
    balance: formatUnits(balance, 18),
    sufficient: balance >= total,
    keystoreFeeRaw: keystoreFee,
    balanceRaw: balance,
  };
}

/** Compile permissions and price the activation. Signs nothing. */
export async function grantDraft(ctx: Pick<AdminCtx, "store" | "mode">, input: { durationDays: number; networks: Partial<Record<NetworkKey, GrantInput>> }) {
  const wallet = ctx.store.wallet(ctx.mode);
  if (!wallet) throw new CliError("NO_WALLET", `No ${ctx.mode} wallet yet. Create one first.`);
  const days = Number(input?.durationDays);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new CliError("BAD_INPUT", "Duration must be between 1 and 365 days.");
  const keys = Object.keys(input.networks ?? {}).filter(isNetworkKey);
  if (keys.length === 0) throw new CliError("BAD_INPUT", "Pick at least one network.");
  const expiry = Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const draft: any = { id: crypto.randomBytes(8).toString("hex"), createdAt: new Date().toISOString(), durationDays: days, expiry, networks: {}, inputs: {} };
  for (const key of keys) {
    const chain = chainFor(ctx.mode, key);
    const policy = compilePolicy(chain, input.networks[key]!, expiry);
    const { keystoreFeeRaw: _fee, balanceRaw: _balance, ...priced } = await costOf(chain, wallet.address, policy.permissions.calls!.length, policy.permissions.spend!.length);
    draft.networks[key] = { scopeText: policy.scopeText, ...priced };
    draft.inputs[key] = input.networks[key];
  }
  ctx.store.saveDraft(ctx.mode, draft);
  const { inputs: _inputs, ...publicDraft } = draft;
  return { draft: publicDraft };
}

function adminSigner(wallet: WalletRecord, fns: ReturnType<typeof webAuthnFns>) {
  return signerFromPasskey(wallet.credential, { webAuthn: fns });
}

type Leg = { network: NetworkKey; status: "confirmed" | "failed"; txUrl: string | null; keystoreKeyUrl: string | null; charged: string | null; nativeSymbol: string; error: string | null };

export async function activate(ctx: AdminCtx, input: { draftId: string; networks: NetworkKey[] }) {
  const wallet = requireWallet(ctx);
  const draft = ctx.store.draft(ctx.mode);
  if (!draft || draft.id !== input?.draftId) throw new CliError("DRAFT_NOT_FOUND", "These permissions were replaced by a newer review. Review them again.");
  if (Date.now() - Date.parse(draft.createdAt) > DRAFT_MAX_AGE_MS) throw new CliError("DRAFT_EXPIRED", "This review is more than a day old. Review the permissions again.");
  const keys = (input.networks ?? []).filter(isNetworkKey).filter((k) => draft.inputs[k]);
  if (keys.length === 0) throw new CliError("BAD_INPUT", "Pick at least one network from the review.");
  const client = altanaClient(chainsFor(ctx.mode));

  const legs: Leg[] = await withPasskey(ctx, async (fns, say) => {
    const signer = adminSigner(wallet, fns);
    const out: Leg[] = [];
    for (const key of keys) {
      const chain = chainFor(ctx.mode, key);
      const leg: Leg = { network: key, status: "failed", txUrl: null, keystoreKeyUrl: null, charged: null, nativeSymbol: chain.nativeSymbol, error: null };
      out.push(leg);
      try {
        const policy = compilePolicy(chain, draft.inputs[key], draft.expiry);
        let record = ctx.store.session(chain.chainId);
        // The Keystore fee is paid from the wallet, so the balance is checked before anything is signed.
        if (!(record?.status === "active" && record.draftId === draft.id)) {
          const priced = await costOf(chain, wallet.address, policy.permissions.calls!.length, policy.permissions.spend!.length);
          if (priced.balanceRaw < priced.keystoreFeeRaw) {
            throw new CliError("INSUFFICIENT_FUNDS", `The wallet holds ${priced.balance} ${chain.nativeSymbol} on ${chain.name}. Activation needs about ${priced.cost.total}. Send more and activate again.`);
          }
        }

        if (record?.status === "active" && record.draftId === draft.id) {
          leg.status = "confirmed";
          leg.txUrl = record.grantTx ? txUrl(chain, record.grantTx) : null;
          leg.keystoreKeyUrl = keystoreKeyUrl(chain, record.keyId);
          leg.charged = record.charged;
          continue;
        }
        if (record?.status === "active") {
          ctx.job.step(`Revoking the current session on ${chain.name}`);
          say(`Revoke the agent's current session on ${chain.name} before the new one replaces it.`);
          const res = await client.revokeSession({ wallet: { address: wallet.address }, signer, session: record.publicKey, chainId: chain.chainId });
          if (res.status === "FAILED") throw new CliError("REVOKE_FAILED", `The current session on ${chain.name} could not be revoked, so it was left in place.`);
          record = { ...record, status: "revoked", revokeTx: res.transactionHash ?? null, revokedAt: new Date().toISOString() };
          ctx.store.saveSession(chain.chainId, record);
        }

        // The session key is saved before the grant is sent.
        let secret: Hex;
        if (record?.status === "pending" && record.draftId === draft.id) {
          const stored = ctx.store.readSecret(record.keyFile);
          if (!stored) throw new CliError("KEY_MISSING", `The pending session key for ${chain.name} is missing from the data directory.`);
          secret = stored as Hex;
        } else {
          secret = generatePrivateKey();
          const pub = signerFromPrivateKey(secret).publicKey;
          const keyId = keccak256(pub);
          const keyFile = ctx.store.sessionKeyRel(chain.chainId, keyId.slice(2, 10));
          ctx.store.writeSecretOnce(keyFile, secret);
          record = {
            chainId: chain.chainId, status: "pending", keyId, publicKey: pub, keyFile, expiry: draft.expiry, serialized: null,
            scope: policy.scope, scopeText: policy.scopeText, draftId: draft.id, grantTx: null, grantedAt: null, revokeTx: null, revokedAt: null, charged: null,
          };
          ctx.store.saveSession(chain.chainId, record);
        }
        const sessionSigner = signerFromPrivateKey(secret);
        leg.keystoreKeyUrl = keystoreKeyUrl(chain, record!.keyId);

        const before = await nativeBalance(chain, wallet.address);
        ctx.job.step(`Activating on ${chain.name}`);
        say(`Activate the agent's session on ${chain.name}. ${policy.scopeText.slice(4, 6).join(" ")} ${policy.scopeText.at(-1)}`);
        const session = await client.grantSession({
          wallet: { address: wallet.address }, signer, permissions: policy.permissions, expiry: draft.expiry, sessionSigner, register: true, chainId: chain.chainId,
        });
        const after = await nativeBalance(chain, wallet.address);
        const charged = before > after ? formatUnits(before - after, 18) : "0";
        const active: SessionRecord = {
          ...record!, status: "active", serialized: serializeSession(session), grantTx: session.transactionHash ?? null, grantedAt: new Date().toISOString(), charged,
        };
        ctx.store.saveSession(chain.chainId, active);
        leg.status = "confirmed";
        leg.txUrl = session.transactionHash ? txUrl(chain, session.transactionHash) : null;
        leg.charged = charged;
      } catch (e) {
        const f = decodeFailure(e);
        ctx.log(`activate ${chain.name} failed: ${f.raw}`);
        leg.error = f.message;
      }
    }
    return out;
  }, `Hermes is about to activate the agent's session on ${keys.map((k) => chainFor(ctx.mode, k).name).join(" and ")}. You will approve with your passkey once per network. Continue when you are ready.`);
  return { legs };
}

export async function revoke(ctx: AdminCtx, input: { network: NetworkKey }) {
  const wallet = requireWallet(ctx);
  if (!isNetworkKey(input?.network)) throw new CliError("BAD_INPUT", "Pick a network.");
  const chain = chainFor(ctx.mode, input.network);
  const record = ctx.store.session(chain.chainId);
  if (!record || record.status === "revoked") throw new CliError("NO_SESSION", `There is no session to revoke on ${chain.name}.`);
  const client = altanaClient(chainsFor(ctx.mode));
  const res = await withPasskey(ctx, async (fns, say) => {
    say(`Revoke the agent's session on ${chain.name}. The agent's key stops working there.`);
    ctx.job.step(`Revoking on ${chain.name}`);
    return client.revokeSession({ wallet: { address: wallet.address }, signer: adminSigner(wallet, fns), session: record.publicKey, chainId: chain.chainId });
  }, `Hermes is about to revoke the agent's session on ${chain.name}. You will approve with your passkey once. Continue when you are ready.`);
  if (res.status === "FAILED") throw new CliError("REVOKE_FAILED", `The revoke on ${chain.name} did not confirm (relay code ${res.statusCode ?? "unknown"}). The session is still active.`);
  ctx.store.saveSession(chain.chainId, { ...record, status: "revoked", revokeTx: res.transactionHash ?? null, revokedAt: new Date().toISOString() });
  return { network: input.network, txUrl: res.transactionHash ? txUrl(chain, res.transactionHash) : null };
}

export async function withdraw(ctx: AdminCtx, input: { network: NetworkKey; asset: string; amount: string; to: string }) {
  const wallet = requireWallet(ctx);
  if (!isNetworkKey(input?.network)) throw new CliError("BAD_INPUT", "Pick a network.");
  const chain = chainFor(ctx.mode, input.network);
  let to: Address;
  try {
    to = getAddress(String(input.to).trim());
  } catch {
    throw new CliError("BAD_INPUT", "The destination is not a valid address.");
  }
  const isNative = input.asset === "native" || input.asset?.toLowerCase() === chain.nativeSymbol.toLowerCase();
  const asset = isNative ? null : findAsset(chain, input.asset);
  if (!isNative && !asset) throw new CliError("BAD_INPUT", `${input.asset} is not an asset this plugin knows on ${chain.name}.`);
  const symbol = isNative ? chain.nativeSymbol : asset!.symbol;
  const decimals = isNative ? 18 : asset!.decimals;
  const held = await balances(chain, wallet.address);
  const have = isNative ? held.nativeRaw : held.tokens.find((t) => t.symbol === symbol)!.raw;
  let amount: bigint;
  if (String(input.amount).trim().toLowerCase() === "max") {
    // Leave room for the relay fee, which the wallet pays in the native coin.
    const reserve = isNative ? (await rpc(chain).getGasPrice()) * 900_000n : 0n;
    amount = have > reserve ? have - reserve : 0n;
  } else {
    try {
      amount = parseUnits(String(input.amount).trim(), decimals);
    } catch {
      throw new CliError("BAD_AMOUNT", `"${input.amount}" is not a number.`);
    }
  }
  if (amount <= 0n) throw new CliError("BAD_AMOUNT", "Nothing to send.");
  if (amount > have) throw new CliError("INSUFFICIENT_FUNDS", `The wallet holds ${formatUnits(have, decimals)} ${symbol} on ${chain.name}.`);
  const calls = isNative ? [{ to, value: amount }] : [{ to: asset!.address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) }];
  const client = altanaClient(chainsFor(ctx.mode));
  const res = await withPasskey(ctx, async (fns, say) => {
    say(`Send ${formatUnits(amount, decimals)} ${symbol} from your wallet on ${chain.name} to ${to}.`);
    ctx.job.step(`Sending ${symbol} on ${chain.name}`);
    return client.execute({ wallet: { address: wallet.address }, signer: adminSigner(wallet, fns), calls: calls as any, chainId: chain.chainId });
  }, `Hermes is about to send ${formatUnits(amount, decimals)} ${symbol} from your wallet on ${chain.name} to ${to}. You will approve with your passkey once. Continue when you are ready.`);
  if (res.status === "FAILED") throw new CliError("WITHDRAW_FAILED", `The transfer on ${chain.name} did not confirm (relay code ${res.statusCode ?? "unknown"}).`);
  return { network: input.network, txUrl: res.transactionHash ? txUrl(chain, res.transactionHash) : null };
}

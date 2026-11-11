// Admin commands. Every one of them is signed by the wallet's passkey, never by a key on disk.
import crypto from "node:crypto";
import { encodeFunctionData, formatUnits, getAddress, keccak256, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { serializeSession, signerFromPasskey, signerFromPrivateKey, type SessionPermissions } from "@altananetwork/sdk";
import { erc20Abi } from "./abi.ts";
import { altanaClient, chainFor, chainsFor, findAsset, isNetworkKey, keystoreKeyUrl, rpc, txUrl, type Chain, type Mode, type NetworkKey } from "./config.ts";
import { activationSlots, planStages } from "./budget.ts";
import { balances, grantedPairs, isValidKey, keystoreKeys, nativeBalance, registrationFee, relayGasBuffer, relayServes } from "./chainread.ts";
import { CliError, decodeFailure, relayDropped } from "./errors.ts";
import type { JobReporter } from "./job.ts";
import { compilePolicy, pair, type GrantInput } from "./policy.ts";
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
/** How long activation keeps watching the chain for a transaction the relay has submitted. */
const PENDING_WAIT_MS = 12 * 60 * 1000;

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
    // The mainnet relay's fee quote lasts 30 seconds, counted from when the passkey prompt appears.
    const hurry = ctx.mode === "mainnet" ? " Approve within 30 seconds." : "";
    const out = await fn(webAuthnFns(transport, () => prompt), (p) => (prompt = p + hurry));
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

/**
 * Gas a grant uses, fitted to grants measured on BNB testnet (1.92M gas for a first grant with
 * 11 call entries and 4 spend entries). The relay prices its fee on this plus its own buffers.
 */
function estimateGrantGas(callEntries: number, spendEntries: number, firstAction: boolean): bigint {
  return BigInt(500_000 + callEntries * 45_000 + spendEntries * 90_000 + (firstAction ? 550_000 : 0));
}

/** A native amount for display: six decimals, rounded up so a quoted cost is never an understatement. */
function ceil6(raw: bigint): string {
  const unit = 10n ** 12n;
  return formatUnits(((raw + unit - 1n) / unit) * unit, 18);
}

/** Extra gas one new storage slot costs on a network with a storage budget. */
const BUDGET_SLOT_GAS = 85_000n;

/** A native amount for display, rounded down to six decimals. */
function floor6(raw: bigint): string {
  const unit = 10n ** 12n;
  return formatUnits((raw / unit) * unit, 18);
}

/**
 * What a transfer out of the wallet needs to leave behind in the native coin: the relay fee, with
 * room for the relay pricing gas above the network's own quote, and the Keystore fee when this is
 * the wallet's first transaction on the network.
 */
async function withdrawReserve(chain: Chain, wallet: Address): Promise<bigint> {
  const [fee, keys, gasPrice, buffer] = await Promise.all([registrationFee(chain), keystoreKeys(chain, wallet), rpc(chain).getGasPrice(), relayGasBuffer(chain)]);
  const first = keys.length === 0;
  const gas = 600_000n + (first ? 550_000n : 0n) + buffer + (chain.storageBudget ? (first ? 16n : 2n) * BUDGET_SLOT_GAS : 0n);
  const price = gasPrice * 2n > 100_000_000n ? gasPrice * 2n : 100_000_000n;
  return gas * price + (first ? fee : 0n);
}

async function costOf(chain: Chain, wallet: Address, permissions: SessionPermissions) {
  const client = rpc(chain);
  const [fee, keys, gasPrice, balance, buffer] = await Promise.all([registrationFee(chain), keystoreKeys(chain, wallet), client.getGasPrice(), nativeBalance(chain, wallet), relayGasBuffer(chain)]);
  const firstAction = keys.length === 0;
  const keystoreFee = fee * (firstAction ? 2n : 1n);
  // Every stage is a transaction of its own: the relay's buffer and a base cost apply to each.
  const stages = planStages(permissions, chain.storageBudget).length;
  const gas =
    estimateGrantGas(permissions.calls?.length ?? 0, permissions.spend?.length ?? 0, firstAction) +
    BigInt(stages - 1) * 500_000n +
    BigInt(stages) * buffer +
    (chain.storageBudget ? BigInt(activationSlots(permissions)) * BUDGET_SLOT_GAS : 0n);
  const relayFee = (gas * gasPrice * 125n) / 100n;
  const total = keystoreFee + relayFee;
  return {
    cost: {
      keystoreFee: ceil6(keystoreFee),
      relayFeeEstimate: ceil6(relayFee),
      total: ceil6(total),
      nativeSymbol: chain.nativeSymbol,
      firstAction,
    },
    /** Passkey approvals this activation takes on this network. A new wallet under a storage budget is set up in a step of its own. */
    approvals: stages + (chain.storageBudget && firstAction ? 1 : 0),
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
    const { keystoreFeeRaw: _fee, balanceRaw: _balance, ...priced } = await costOf(chain, wallet.address, policy.permissions);
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

/** Where the setup step's empty call goes. It carries no value and no data. */
const SETUP_TARGET = "0x000000000000000000000000000000000000dEaD";

/** How many passkey approvals an activation takes, as a sentence for the approval page. */
function approvalsText(mode: Mode, draft: any, keys: NetworkKey[]): string {
  const counts = keys.map((k) => {
    const chain = chainFor(mode, k);
    const n = Number(draft.networks?.[k]?.approvals) || planStages(compilePolicy(chain, draft.inputs[k], draft.expiry).permissions, chain.storageBudget).length;
    return { name: chain.name, n };
  });
  if (counts.every((c) => c.n === 1)) return "You will approve with your passkey once per network.";
  const total = counts.reduce((sum, c) => sum + c.n, 0);
  return `You will approve with your passkey ${total} times: ${counts.map((c) => `${c.n} for ${c.name}`).join(", ")}.`;
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
          const priced = await costOf(chain, wallet.address, policy.permissions);
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
        // A session that was only partly granted under an older review holds some permissions onchain, so it is revoked too.
        const halfGranted = record?.status === "pending" && (record.stagesDone ?? 0) > 0 && record.draftId !== draft.id;
        if (record?.status === "active" || halfGranted) {
          ctx.job.step(`Revoking the current session on ${chain.name}`);
          say(`Revoke the agent's current session on ${chain.name} before the new one replaces it.`);
          const res = await client.revokeSession({ wallet: { address: wallet.address }, signer, session: record.publicKey, chainId: chain.chainId });
          if (res.status === "FAILED") throw new CliError("REVOKE_FAILED", `The current session on ${chain.name} could not be revoked, so it was left in place.`);
          record = { ...record!, status: "revoked", revokeTx: res.transactionHash ?? null, revokedAt: new Date().toISOString() };
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

        // One grant on most networks. Where a storage budget applies, the same key is granted in stages.
        const stages = planStages(policy.permissions, chain.storageBudget);
        const before = await nativeBalance(chain, wallet.address);
        // A wallet's first transaction on a network also sets it up there and registers the passkey's
        // key in the Keystore. Under a storage budget that fills a transaction by itself, so it goes first.
        if (chain.storageBudget && (await keystoreKeys(chain, wallet.address)).length === 0) {
          ctx.job.step(`Setting up the wallet on ${chain.name}`);
          say(`Set up your wallet on ${chain.name}. This one-time step registers your passkey's key in the Keystore. It moves no funds.`);
          let setup;
          try {
            setup = await client.execute({ wallet: { address: wallet.address }, signer, calls: [{ to: SETUP_TARGET, value: 0n, data: "0x" }] as any, chainId: chain.chainId });
          } catch (e) {
            const f = decodeFailure(e);
            ctx.log(`setup ${chain.name} failed: ${f.raw}`);
            throw new CliError("SETUP_FAILED", `The wallet could not be set up on ${chain.name}. ${f.code === "RELAY_REJECTED" ? relayDropped(chain.relayNote) : f.message} Activate again to retry.`);
          }
          if (setup.status === "FAILED") throw new CliError("SETUP_FAILED", `The wallet could not be set up on ${chain.name}. ${relayDropped(chain.relayNote)} Activate again to retry.`);
        }
        const hashes: string[] = [...(record!.grantTxs ?? [])];
        for (let i = record!.stagesDone ?? 0; i < stages.length; i++) {
          const stage = stages[i];
          const many = stages.length > 1;
          ctx.job.step(many ? `Activating on ${chain.name}, step ${i + 1} of ${stages.length}` : `Activating on ${chain.name}`);
          say(`Activate the agent's session on ${chain.name}. ${policy.scopeText.slice(4, 6).join(" ")} ${policy.scopeText.at(-1)}${many ? ` Approval ${i + 1} of ${stages.length} on this network.` : ""}`);
          try {
            // A stage counts as landed when the chain shows it: the Keystore entry for the stage that
            // registers the key, the stage's call permissions otherwise.
            const sessionAddress = privateKeyToAddress(secret);
            const keyId = record!.keyId;
            const landed = async () => {
              if (stage.register) return isValidKey(chain, wallet.address, keyId).catch(() => false);
              const have = await grantedPairs(chain, wallet.address, sessionAddress).catch(() => null);
              return have !== null && stage.calls.every((c) => have.has(pair(c.to, c.signature)));
            };
            // A grant sent earlier may have confirmed after this plugin stopped waiting. Then nothing is signed again.
            if (await landed()) {
              ctx.log(`activate ${chain.name}: step ${i + 1} is already onchain`);
              record = { ...record!, stagesDone: i + 1, grantTxs: hashes };
              ctx.store.saveSession(chain.chainId, record);
              continue;
            }
            const grant = () => client.grantSession({
              wallet: { address: wallet.address }, signer, permissions: { calls: stage.calls, spend: stage.spend }, expiry: draft.expiry, sessionSigner, register: stage.register, chainId: chain.chainId,
            });
            let granted;
            try {
              granted = await grant();
            } catch (e) {
              if (/status=PENDING/.test(String((e as Error)?.message ?? e))) {
                // Submitted, not yet confirmed. A busy network can take longer than the SDK waits, so keep watching the chain.
                ctx.job.step(`Waiting for ${chain.name} to confirm. The transaction is submitted, and this can take several minutes`);
                const until = Date.now() + PENDING_WAIT_MS;
                let seen = false;
                while (!seen && Date.now() < until) {
                  await new Promise((r) => setTimeout(r, 8000));
                  seen = await landed();
                }
                if (!seen) {
                  throw new CliError("STILL_PENDING", `The transaction was submitted, but ${chain.name} has not confirmed it yet. Nothing was charged so far. Activate again in a few minutes: the plugin checks the chain first and does not ask you to sign twice for a transaction that went through.`);
                }
                granted = { transactionHash: undefined } as any;
              } else {
                // A quote that ran out before the approval arrived gets one more prompt, with a fresh quote.
                if (decodeFailure(e).code !== "QUOTE_EXPIRED") throw e;
                ctx.log(`activate ${chain.name}: the quote ran out, asking again`);
                say(`The fee quote ran out before your approval arrived, so nothing was sent. Approve again for ${chain.name}.`);
                granted = await grant();
              }
            }
            if (granted.transactionHash) hashes.push(granted.transactionHash);
          } catch (e) {
            if (!many || (e instanceof CliError && e.code === "STILL_PENDING")) throw e;
            const f = decodeFailure(e);
            ctx.log(`activate ${chain.name} step ${i + 1} failed: ${f.raw}`);
            const why = f.code === "RELAY_REJECTED" ? relayDropped(chain.relayNote) : f.message;
            throw new CliError("STAGE_FAILED", `Step ${i + 1} of ${stages.length} on ${chain.name} did not go through. ${why} Activate again to continue from this step.`);
          }
          record = { ...record!, stagesDone: i + 1, grantTxs: hashes };
          ctx.store.saveSession(chain.chainId, record);
        }
        const after = await nativeBalance(chain, wallet.address);
        const charged = before > after ? formatUnits(before - after, 18) : "0";
        // The stored session carries the whole scope, whatever the stages were.
        const session = { walletAddress: wallet.address, signer: sessionSigner, publicKey: sessionSigner.publicKey, permissions: policy.permissions, expiry: draft.expiry };
        const active: SessionRecord = {
          ...record!, status: "active", serialized: serializeSession(session as any), grantTx: hashes.at(-1) ?? null, grantTxs: hashes, grantedAt: new Date().toISOString(), charged,
        };
        ctx.store.saveSession(chain.chainId, active);
        leg.status = "confirmed";
        leg.txUrl = active.grantTx ? txUrl(chain, active.grantTx) : null;
        leg.keystoreKeyUrl = keystoreKeyUrl(chain, active.keyId);
        leg.charged = charged;
      } catch (e) {
        const f = decodeFailure(e);
        ctx.log(`activate ${chain.name} failed: ${f.raw}`);
        leg.error = f.code === "RELAY_REJECTED" ? relayDropped(chain.relayNote) : f.message;
      }
    }
    return out;
  }, `Hermes is about to activate the agent's session on ${keys.map((k) => chainFor(ctx.mode, k).name).join(" and ")}. ${approvalsText(ctx.mode, draft, keys)} Continue when you are ready.`);
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
  // The wallet pays the relay fee in the native coin, and a wallet's first transaction on a
  // network also pays one Keystore fee. That much has to stay behind.
  const reserve = await withdrawReserve(chain, wallet.address);
  const most = isNative ? (held.nativeRaw > reserve ? held.nativeRaw - reserve : 0n) : have;
  let amount: bigint;
  if (String(input.amount).trim().toLowerCase() === "max") {
    amount = most;
  } else {
    try {
      amount = parseUnits(String(input.amount).trim(), decimals);
    } catch {
      throw new CliError("BAD_AMOUNT", `"${input.amount}" is not a number.`);
    }
  }
  if (amount <= 0n) throw new CliError("BAD_AMOUNT", most === 0n && isNative ? `The wallet holds ${formatUnits(have, decimals)} ${symbol} on ${chain.name}, which is not more than the fee of about ${ceil6(reserve)}.` : "Nothing to send.");
  if (amount > have) throw new CliError("INSUFFICIENT_FUNDS", `The wallet holds ${formatUnits(have, decimals)} ${symbol} on ${chain.name}.`);
  if (isNative && amount > most) {
    throw new CliError("INSUFFICIENT_FUNDS", `About ${ceil6(reserve)} ${symbol} has to stay in the wallet for the fee. The most you can send is ${floor6(most)} ${symbol}. Use Max to send that.`);
  }
  if (!isNative && held.nativeRaw < reserve) {
    throw new CliError("INSUFFICIENT_FUNDS", `The wallet holds ${formatUnits(held.nativeRaw, 18)} ${chain.nativeSymbol} on ${chain.name}. Sending needs about ${ceil6(reserve)} for the fee.`);
  }
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

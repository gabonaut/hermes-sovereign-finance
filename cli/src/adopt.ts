// A grant can confirm after the plugin stopped waiting for it. The session then exists onchain
// while the local record still says pending. This finishes such a record from what the chain
// shows, with no signature: the key was already granted by the user's passkey.
import { privateKeyToAddress } from "viem/accounts";
import type { Address, Hex } from "viem";
import { serializeSession } from "@altananetwork/sdk";
import { planStages } from "./budget.ts";
import { grantedPairs, isValidKey } from "./chainread.ts";
import type { Chain, Mode } from "./config.ts";
import { compilePolicy, pair } from "./policy.ts";
import type { SessionRecord, Store } from "./store.ts";

/** Returns the record, made active when every stage of its grant is onchain. Never throws. */
export async function adoptPending(store: Store, mode: Mode, chain: Chain, wallet: Address): Promise<SessionRecord | null> {
  const record = store.session(chain.chainId);
  if (!record || record.status !== "pending") return record;
  try {
    const draft = store.draft(mode);
    const input = draft && draft.id === record.draftId ? draft.inputs?.[chain.key] : null;
    const secret = store.readSecret(record.keyFile);
    if (!input || !secret) return record;
    const policy = compilePolicy(chain, input, record.expiry);
    const sessionAddress = privateKeyToAddress(secret as Hex);
    for (const stage of planStages(policy.permissions, chain.storageBudget)) {
      if (stage.register) {
        if (!(await isValidKey(chain, wallet, record.keyId))) return record;
      } else {
        const have = await grantedPairs(chain, wallet, sessionAddress);
        if (!have || !stage.calls.every((c) => have.has(pair(c.to, c.signature)))) return record;
      }
    }
    const session = { walletAddress: wallet, publicKey: record.publicKey, permissions: policy.permissions, expiry: record.expiry };
    const active: SessionRecord = { ...record, status: "active", serialized: serializeSession(session as any), grantedAt: new Date().toISOString() };
    store.saveSession(chain.chainId, active);
    return active;
  } catch {
    return record;
  }
}

// Networks with a storage budget.
//
// On some networks one relayed transaction can only write a limited amount of new storage to the
// wallet. Such a network has a `storageBudget` in networks.json, counted in new storage slots, and
// an activation there is granted in stages. A network without a budget activates in one grant.
import type { SessionPermissions } from "@altananetwork/sdk";

type CallPermission = NonNullable<SessionPermissions["calls"]>[number];
type SpendPermission = NonNullable<SessionPermissions["spend"]>[number];

// New storage slots per step, rounded up from measured transactions.
const PER_TRANSACTION = 1;
const AUTHORIZE_KEY = 5;
const KEYSTORE_ENTRY = 10;
const SPEND_LIMIT = 2;
/** Slots for the n-th member (counted from 1) of one of the wallet's sets, which change layout at four members. */
const setMember = (n: number) => (n <= 3 ? 1 : n === 4 ? 6 : 2);

export type Stage = { calls: CallPermission[]; spend: SpendPermission[]; register: boolean };

type Item = { kind: "call"; value: CallPermission; cost: number } | { kind: "spend"; value: SpendPermission; cost: number } | { kind: "register"; cost: number };

/**
 * Split a session's permissions into the grants that activate it. Without a budget that is one
 * grant. With one, every stage stays under the budget and the Keystore entry rides with the last
 * stage. A grant needs a call permission, so a stage that would have none repeats the first one,
 * which writes nothing new. Granting the stages in order gives the session key exactly `permissions`.
 */
export function planStages(permissions: SessionPermissions, budget: number | null): Stage[] {
  const calls = permissions.calls ?? [];
  const spend = permissions.spend ?? [];
  if (!budget || calls.length === 0) return [{ calls: [...calls], spend: [...spend], register: true }];

  // The relay adds one call permission of its own with the first stage, so the plugin's start at the second member.
  const items: Item[] = [
    ...calls.map((value, i): Item => ({ kind: "call", value, cost: setMember(i + 2) })),
    ...spend.map((value, i): Item => ({ kind: "spend", value, cost: SPEND_LIMIT + setMember(i + 1) })),
    { kind: "register", cost: KEYSTORE_ENTRY },
  ];
  const stages: Item[][] = [[]];
  let used = PER_TRANSACTION + AUTHORIZE_KEY + setMember(1);
  for (const item of items) {
    if (stages[stages.length - 1].length > 0 && used + item.cost > budget) {
      stages.push([]);
      used = PER_TRANSACTION;
    }
    stages[stages.length - 1].push(item);
    used += item.cost;
  }
  return stages.map((stage) => {
    const own = stage.flatMap((x) => (x.kind === "call" ? [x.value] : []));
    return {
      calls: own.length > 0 ? own : [calls[0]],
      spend: stage.flatMap((x) => (x.kind === "spend" ? [x.value] : [])),
      register: stage.some((x) => x.kind === "register"),
    };
  });
}

/** Total new slots an activation writes, for the cost estimate. */
export function activationSlots(permissions: SessionPermissions): number {
  const calls = (permissions.calls ?? []).reduce((sum, _c, i) => sum + setMember(i + 2), 0);
  const spends = (permissions.spend ?? []).reduce((sum, _s, i) => sum + SPEND_LIMIT + setMember(i + 1), 0);
  return AUTHORIZE_KEY + setMember(1) + calls + spends + KEYSTORE_ENTRY;
}

import assert from "node:assert/strict";
import test from "node:test";
import { activationSlots, planStages } from "../src/budget.ts";
import { chainById } from "../src/config.ts";
import { compilePolicy, presetFor } from "../src/policy.ts";

function presetPermissions(chainId: number) {
  const chain = chainById(chainId);
  const preset = presetFor(chain);
  const tokens = preset.tokens.filter((t) => t.checked).map((t) => ({ symbol: t.symbol, cap: t.cap }));
  return { chain, permissions: compilePolicy(chain, { nativeCap: preset.native.cap, tokens }, 1_900_000_000).permissions };
}
const shape = (stages: ReturnType<typeof planStages>) => stages.map((s) => `${s.calls.length}c+${s.spend.length}s${s.register ? "+keystore" : ""}`);

test("a network without a storage budget activates in one grant", () => {
  for (const id of [97, 56, 1]) {
    const { chain, permissions } = presetPermissions(id);
    assert.equal(chain.storageBudget, null);
    const stages = planStages(permissions, chain.storageBudget);
    assert.equal(stages.length, 1);
    assert.deepEqual(stages[0].calls, permissions.calls);
    assert.deepEqual(stages[0].spend, permissions.spend);
    assert.equal(stages[0].register, true);
  }
});

test("the Sepolia preset activates in three stages", () => {
  const { chain, permissions } = presetPermissions(11155111);
  assert.equal(chain.storageBudget, 18);
  assert.equal(permissions.calls!.length, 10);
  assert.equal(permissions.spend!.length, 3);
  const stages = planStages(permissions, chain.storageBudget);
  assert.deepEqual(shape(stages), ["4c+0s", "6c+1s", "1c+2s+keystore"]);
  // The last stage has no call permission of its own, so it repeats one the first stage granted.
  assert.deepEqual(stages[2].calls, [permissions.calls![0]]);
  assert.equal(activationSlots(permissions), 47);
});

test("stages grant every permission, in order, and each holds a call", () => {
  const { permissions } = presetPermissions(56);
  const unique = <T>(list: T[]) => list.filter((x, i) => list.indexOf(x) === i);
  for (let budget = 14; budget <= 60; budget++) {
    const stages = planStages(permissions, budget);
    assert.deepEqual(unique(stages.flatMap((s) => s.calls)), permissions.calls, `calls at budget ${budget}`);
    assert.deepEqual(stages.flatMap((s) => s.spend), permissions.spend, `spend at budget ${budget}`);
    assert.ok(stages.every((s) => s.calls.length > 0), `a stage without a call at budget ${budget}`);
    assert.deepEqual(stages.map((s) => s.register), stages.map((_s, i) => i === stages.length - 1), `Keystore entry at budget ${budget}`);
  }
  assert.equal(planStages(permissions, 1000).length, 1);
});

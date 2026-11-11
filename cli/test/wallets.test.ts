import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.ts";
import { chainsFor } from "../src/config.ts";
import { listAside, restore, setAside, useWallet } from "../src/wallets.ts";

const A = "0x00000000000000000000000000000000000000A1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;

function fresh() {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "sf-wallets-")));
  const chainId = chainsFor("testnet")[0].chainId;
  const put = (address: `0x${string}`) => {
    store.saveWallet("testnet", { address, credential: { kind: "webauthn", id: address, publicKey: "0x01" }, chainIds: [chainId], createdAt: "2026-01-01T00:00:00Z" });
    store.saveSession(chainId, { chainId, status: "active", keyFile: `keys/${address}.key` } as any);
    store.saveDraft("testnet", { id: address });
  };
  return { store, chainId, put };
}

test("setting a wallet aside keeps its records and frees the slot", () => {
  const { store, chainId, put } = fresh();
  put(A);
  store.saveWallet("mainnet", { address: B, credential: { kind: "webauthn", id: "m", publicKey: "0x02" }, chainIds: [56], createdAt: "" });
  assert.deepEqual(setAside(store, "testnet"), { address: A });
  assert.equal(store.wallet("testnet"), null);
  assert.equal(store.session(chainId), null);
  assert.equal(store.draft("testnet"), null);
  assert.equal(store.wallet("mainnet")?.address, B);
  assert.deepEqual(listAside(store, "testnet").map((w) => w.address), [A]);
  assert.deepEqual(listAside(store, "mainnet"), []);
  assert.throws(() => setAside(store, "testnet"), /no testnet wallet/);
});

test("a wallet set aside comes back with its sessions and draft", () => {
  const { store, chainId, put } = fresh();
  put(A);
  setAside(store, "testnet");
  assert.equal(restore(store, "testnet", B), false);
  assert.equal(restore(store, "testnet", A.toLowerCase()), true);
  assert.equal(store.wallet("testnet")?.address, A);
  assert.equal((store.wallet("testnet") as any).setAsideAt, undefined);
  assert.equal(store.session(chainId)?.keyFile, `keys/${A}.key`);
  assert.equal(store.draft("testnet")?.id, A);
  assert.deepEqual(listAside(store, "testnet"), []);
});

test("switching swaps the wallet in use with one set aside", () => {
  const { store, chainId, put } = fresh();
  put(A);
  setAside(store, "testnet");
  put(B);
  assert.deepEqual(useWallet(store, "testnet", A), { address: A });
  assert.equal(store.session(chainId)?.keyFile, `keys/${A}.key`);
  assert.deepEqual(listAside(store, "testnet").map((w) => w.address), [B]);
  assert.throws(() => useWallet(store, "testnet", "0x00000000000000000000000000000000000000c3"), /not among/);
  assert.throws(() => useWallet(store, "testnet", "../x"), /Pick a wallet/);
  assert.equal(store.wallet("testnet")?.address, A);
});

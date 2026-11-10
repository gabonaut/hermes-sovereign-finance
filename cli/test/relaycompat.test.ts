import assert from "node:assert/strict";
import test from "node:test";
import { dropUnnamedAssetDiffs, installRelayCompat } from "../src/relaycompat.ts";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const LOG_SOURCE = "0xfffffffffffffffffffffffffffffffffffffffe";

function reply() {
  return {
    digest: "0xabc",
    context: { kept: true },
    capabilities: {
      feeTotals: { "0xaa36a7": { currency: "usd", value: "0.9" } },
      assetDiffs: {
        "0xaa36a7": [
          [
            ACCOUNT,
            [
              { address: LOG_SOURCE, type: "erc20", value: "0x5", direction: "outgoing", recipients: [OTHER] },
              { address: null, type: null, symbol: "ETH", decimals: 18, value: "0x5", direction: "outgoing", recipients: [OTHER] },
            ],
          ],
          [OTHER, [{ address: LOG_SOURCE, type: "erc20", value: "0x5", direction: "incoming", recipients: [] }]],
        ],
      },
    },
  };
}

test("asset movements without a symbol are removed and the rest of the reply is kept", () => {
  const r = reply();
  assert.equal(dropUnnamedAssetDiffs(r), true);
  const rows = r.capabilities.assetDiffs["0xaa36a7"];
  assert.deepEqual(rows[0][1], [{ address: null, type: null, symbol: "ETH", decimals: 18, value: "0x5", direction: "outgoing", recipients: [OTHER] }]);
  assert.deepEqual(rows[1], [OTHER, []]);
  assert.equal(r.digest, "0xabc");
  assert.deepEqual(r.context, { kept: true });
  assert.deepEqual(r.capabilities.feeTotals, { "0xaa36a7": { currency: "usd", value: "0.9" } });
});

test("a reply whose asset movements all have symbols is left alone", () => {
  const r = reply();
  dropUnnamedAssetDiffs(r);
  const before = JSON.stringify(r);
  assert.equal(dropUnnamedAssetDiffs(r), false);
  assert.equal(JSON.stringify(r), before);
  assert.equal(dropUnnamedAssetDiffs({ capabilities: {} }), false);
  assert.equal(dropUnnamedAssetDiffs(undefined), false);
});

test("only replies from the listed relays are rewritten", async () => {
  const real = globalThis.fetch;
  const sent: Response[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const body = url.includes("plain") ? "not json" : JSON.stringify({ jsonrpc: "2.0", id: 1, result: reply() });
    const res = new Response(body, { status: 200, headers: { "content-type": "application/json", "content-length": String(body.length) } });
    sent.push(res);
    return res;
  }) as typeof fetch;
  try {
    installRelayCompat(["https://relay.example/"]);
    const fixed = await fetch("https://relay.example/", { method: "POST" });
    assert.notEqual(fixed, sent[0]);
    assert.equal(fixed.headers.get("content-length"), null);
    const json: any = await fixed.json();
    assert.deepEqual(json.result.capabilities.assetDiffs["0xaa36a7"][1], [OTHER, []]);
    assert.equal(json.result.digest, "0xabc");

    const elsewhere = await fetch("https://rpc.example/", { method: "POST" });
    assert.equal(elsewhere, sent[1]);

    const notJson = await fetch("https://relay.example/plain", { method: "POST" });
    assert.equal(notJson, sent[2]);
    assert.equal(await notJson.text(), "not json");
  } finally {
    globalThis.fetch = real;
  }
});

test("a dropped batch is explained, with the network's caveat when it has one", async () => {
  const { decodeFailure, relayDropped } = await import("../src/errors.ts");
  const { chainById } = await import("../src/config.ts");
  const f = decodeFailure(new Error("Session grant did not confirm: status=FAILED (relay code 300)"));
  assert.equal(f.code, "RELAY_REJECTED");
  assert.equal(f.message, relayDropped());
  assert.match(f.message, /nothing was charged/);
  const sepolia = chainById(11155111);
  assert.ok(sepolia.relayNote);
  assert.ok(relayDropped(sepolia.relayNote).endsWith(sepolia.relayNote!));
  assert.equal(chainById(97).relayNote, null);
  assert.equal(chainById(1).relayNote, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { browserTransport } from "../src/bridge.ts";
import { JobReporter } from "../src/job.ts";
import { Store } from "../src/store.ts";
import { softwareTransport } from "../dev/software-authenticator.ts";
import { b64url, webAuthnFns } from "../src/webauthn.ts";

function rawGet(port: number, pathname: string, host: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers: { host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location });
    });
    req.on("error", reject);
    req.end();
  });
}

test("the passkey page serves one request at a time to a browser on localhost only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bridge-"));
  const store = new Store(dir);
  const job = new JobReporter(store, "job1", "create", () => {});
  const transport = await browserTransport(job, () => {});
  const authenticator = softwareTransport(path.join(dir, "authn.json"));
  const fns = webAuthnFns(transport, () => "Create the passkey for the test wallet.");

  // The SDK side asks for a credential; the promise settles when the page posts a result.
  const userId = crypto.randomBytes(20);
  const creating = fns.createFn({
    publicKey: { rp: { id: "localhost", name: "localhost" }, user: { id: userId, name: "t", displayName: "t" }, challenge: crypto.randomBytes(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }] },
  } as any);

  const state = JSON.parse(fs.readFileSync(path.join(dir, "jobs", "job1.json"), "utf8"));
  assert.equal(state.status, "waiting_passkey");
  assert.equal(state.passkeyPrompt, "Create the passkey for the test wallet.");
  const url = new URL(state.passkeyUrl);
  assert.equal(url.hostname, "localhost");
  assert.match(url.pathname, /^\/p\/[0-9a-f]{64}$/);
  const port = Number(url.port);

  // Only the exact path on the name "localhost" is served.
  assert.equal((await rawGet(port, url.pathname, `localhost:${port}`)).status, 200);
  assert.equal((await rawGet(port, "/", `localhost:${port}`)).status, 404);
  assert.equal((await rawGet(port, "/p/" + "0".repeat(64), `localhost:${port}`)).status, 404);
  assert.equal((await rawGet(port, url.pathname, "evil.example")).status, 403);
  const redirected = await rawGet(port, url.pathname, `127.0.0.1:${port}`);
  assert.equal(redirected.status, 302);
  assert.equal(redirected.location, state.passkeyUrl);

  const html = await (await fetch(state.passkeyUrl)).text();
  assert.match(html, /Approve with passkey/);

  // Play the browser: fetch the pending request, answer it with the software authenticator.
  const next = await (await fetch(`${state.passkeyUrl}/next?after=0`)).json();
  assert.equal(next.kind, "create");
  assert.equal(next.prompt, "Create the passkey for the test wallet.");
  assert.equal(next.publicKey.user.id, b64url.encode(userId));
  const answer = await authenticator.request(next);
  const stale = await fetch(`${state.passkeyUrl}/result`, { method: "POST", body: JSON.stringify({ seq: 99, ok: true, result: answer }) });
  assert.equal(stale.status, 409);
  const posted = await fetch(`${state.passkeyUrl}/result`, { method: "POST", body: JSON.stringify({ seq: next.seq, ok: true, result: answer }) });
  assert.equal(posted.status, 200);
  const created: any = await creating;
  assert.equal(created.id, (answer as any).id);
  assert.ok(created.response.getPublicKey().byteLength > 60);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "jobs", "job1.json"), "utf8")).status, "running");

  // A ready step is a plain confirmation: no credential options are sent with it.
  const waiting = transport.ready!("Hermes is about to activate. Continue when you are ready.");
  const ready = await (await fetch(`${state.passkeyUrl}/next?after=${next.seq}`)).json();
  assert.equal(ready.kind, "ready");
  assert.equal(ready.publicKey, undefined);
  await fetch(`${state.passkeyUrl}/result`, { method: "POST", body: JSON.stringify({ seq: ready.seq, ok: true, result: {} }) });
  await waiting;
  next.seq = ready.seq;

  // A cancelled request rejects, and closing tells the page it is done.
  const signing = fns.getFn({ publicKey: { challenge: crypto.randomBytes(32), rpId: "localhost", allowCredentials: [{ id: b64url.decode(created.id), type: "public-key" }] } } as any);
  const refused = assert.rejects(signing, /cancelled/);
  const second = await (await fetch(`${state.passkeyUrl}/next?after=${next.seq}`)).json();
  assert.equal(second.kind, "get");
  await fetch(`${state.passkeyUrl}/result`, { method: "POST", body: JSON.stringify({ seq: second.seq, ok: false, error: "cancelled" }) });
  await refused;
  const closing = transport.close("All done.");
  const done = await (await fetch(`${state.passkeyUrl}/next?after=${second.seq}`)).json();
  assert.deepEqual(done, { done: true, message: "All done." });
  await closing;
  await assert.rejects(fetch(state.passkeyUrl));
});

test("the passkey page's script parses", async () => {
  const { page } = await import("../src/bridge.ts");
  const html = page("n");
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  assert.ok(script.length > 500);
  assert.doesNotThrow(() => new Function(script));
});

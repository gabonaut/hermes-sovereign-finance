// The passkey page. Admin signatures need a WebAuthn ceremony in a browser, so the CLI serves a
// single page on localhost for it. The page is reachable on the loopback interface only, under a
// random path, and only while the command runs.
import crypto from "node:crypto";
import http from "node:http";
import { CliError } from "./errors.ts";
import type { JobReporter } from "./job.ts";
import type { BridgeRequest, WebAuthnTransport } from "./webauthn.ts";

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_HOLD_MS = 25_000;

function page(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sovereign Finance: passkey</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
  main { width: min(34rem, calc(100vw - 3rem)); padding: 2rem 0; }
  h1 { font-size: 1rem; font-weight: 600; margin: 0 0 1.5rem; opacity: .7; }
  #prompt { font-size: 1.25rem; line-height: 1.4; margin: 0 0 1.5rem; overflow-wrap: anywhere; }
  button { font: inherit; font-weight: 600; padding: .7rem 1.2rem; border-radius: .5rem; border: 1px solid transparent; cursor: pointer; }
  #approve { background: CanvasText; color: Canvas; }
  #cancel { background: transparent; color: inherit; border-color: color-mix(in srgb, CanvasText 30%, transparent); margin-left: .5rem; }
  button:disabled { opacity: .45; cursor: default; }
  #status { margin: 1.25rem 0 0; min-height: 1.5rem; opacity: .8; }
  #origin { margin-top: 2rem; font-size: .85rem; opacity: .6; }
</style>
</head>
<body>
<main>
  <h1>Sovereign Finance for Hermes</h1>
  <p id="prompt">Waiting for a request from Hermes.</p>
  <div id="buttons" hidden>
    <button id="approve" type="button">Approve with passkey</button>
    <button id="cancel" type="button">Cancel</button>
  </div>
  <p id="status" role="status"></p>
  <p id="origin">This page is served by the Sovereign Finance plugin on your own computer. Your passkey signs here and never leaves your device.</p>
</main>
<script nonce="${nonce}">
(function () {
  var base = location.pathname.replace(/\\/+$/, "");
  var promptEl = document.getElementById("prompt");
  var statusEl = document.getElementById("status");
  var buttons = document.getElementById("buttons");
  var approveBtn = document.getElementById("approve");
  var cancelBtn = document.getElementById("cancel");
  var seq = 0;
  var current = null;

  function enc(buf) {
    var s = "", a = new Uint8Array(buf);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }
  function dec(text) {
    var s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    var a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a.buffer;
  }
  function say(text) { statusEl.textContent = text; }
  function ended(text) { current = null; buttons.hidden = true; promptEl.textContent = text; say(""); }
  function post(body) {
    return fetch(base + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  function poll() {
    fetch(base + "/next?after=" + seq, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r.done) return ended(r.message || "Done. You can close this tab.");
        if (r.idle) return poll();
        current = r;
        seq = r.seq;
        promptEl.textContent = r.prompt;
        approveBtn.textContent = r.kind === "ready" ? "Continue" : "Approve with passkey";
        buttons.hidden = false;
        approveBtn.disabled = false;
        cancelBtn.disabled = false;
        say("");
      })
      .catch(function () { ended("This request ended. You can close this tab and return to Hermes."); });
  }

  function ceremony(req) {
    var pk = req.publicKey;
    if (req.kind === "create") {
      var options = { rp: pk.rp, user: { id: dec(pk.user.id), name: pk.user.name, displayName: pk.user.displayName }, challenge: dec(pk.challenge), pubKeyCredParams: pk.pubKeyCredParams };
      if (pk.authenticatorSelection) options.authenticatorSelection = pk.authenticatorSelection;
      if (pk.attestation) options.attestation = pk.attestation;
      if (pk.extensions) options.extensions = pk.extensions;
      return navigator.credentials.create({ publicKey: options }).then(function (cred) {
        var spki = cred.response.getPublicKey && cred.response.getPublicKey();
        if (!spki) throw new Error("This authenticator did not return a public key. Try another browser or passkey provider.");
        return { id: cred.id, publicKeySpki: enc(spki) };
      });
    }
    var request = { challenge: dec(pk.challenge), rpId: pk.rpId, allowCredentials: pk.allowCredentials.map(function (c) { return { id: dec(c.id), type: c.type }; }) };
    if (pk.userVerification) request.userVerification = pk.userVerification;
    return navigator.credentials.get({ publicKey: request }).then(function (cred) {
      var r = cred.response;
      return { id: cred.id, authenticatorData: enc(r.authenticatorData), clientDataJSON: enc(r.clientDataJSON), signature: enc(r.signature), userHandle: r.userHandle ? enc(r.userHandle) : null };
    });
  }

  approveBtn.addEventListener("click", function () {
    if (!current) return;
    if (current.kind === "ready") {
      var ready = current;
      approveBtn.disabled = true;
      post({ seq: ready.seq, ok: true, result: {} }).then(function () {
        buttons.hidden = true;
        promptEl.textContent = "Preparing the request.";
        say("The passkey prompt comes next. Approve it promptly: the network quote behind it is short-lived.");
        poll();
      });
      return;
    }
    if (!window.PublicKeyCredential || !navigator.credentials) {
      say("This browser has no passkey support. Open this page's address in Chrome or Safari.");
      return;
    }
    approveBtn.disabled = true;
    say("Waiting for your passkey.");
    var mine = current;
    ceremony(mine)
      .then(function (result) { return post({ seq: mine.seq, ok: true, result: result }); })
      .then(function () { buttons.hidden = true; promptEl.textContent = "Approved."; say("Hermes is working on it. Keep this tab open until it says done."); poll(); })
      .catch(function (e) {
        approveBtn.disabled = false;
        var name = e && e.name;
        say(name === "NotAllowedError" ? "The passkey prompt was dismissed. Approve again when you are ready." : (name === "SecurityError" ? "This browser refused passkeys on localhost. Open this page's address in Chrome." : String((e && e.message) || e)));
      });
  });
  cancelBtn.addEventListener("click", function () {
    if (!current) return;
    var mine = current;
    cancelBtn.disabled = true;
    approveBtn.disabled = true;
    post({ seq: mine.seq, ok: false, error: "cancelled" }).then(function () { ended("Cancelled. You can close this tab and return to Hermes."); });
  });
  poll();
})();
</script>
</body>
</html>`;
}

export async function browserTransport(job: JobReporter, log: (line: string) => void): Promise<WebAuthnTransport> {
  const secret = crypto.randomBytes(32).toString("hex");
  const base = `/p/${secret}`;
  let port = 0;
  let seq = 0;
  type Pending = { seq: number; kind: string; prompt: string; publicKey?: unknown; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
  let pending: Pending | null = null;
  let closed: { message: string } | null = null;
  const waiters = new Set<{ after: number; res: http.ServerResponse; timer: NodeJS.Timeout }>();

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const answerWaiter = (w: { after: number; res: http.ServerResponse; timer: NodeJS.Timeout }): boolean => {
    if (pending && pending.seq > w.after) json(w.res, 200, { seq: pending.seq, kind: pending.kind, prompt: pending.prompt, publicKey: pending.publicKey });
    else if (closed) json(w.res, 200, { done: true, message: closed.message });
    else return false;
    clearTimeout(w.timer);
    waiters.delete(w);
    return true;
  };
  const flush = () => {
    for (const w of [...waiters]) answerWaiter(w);
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const host = String(req.headers.host ?? "");
    const url = new URL(req.url ?? "/", "http://localhost");
    // Passkeys are bound to the name "localhost", so only requests addressed to it are served.
    if (host !== `localhost:${port}`) {
      if ((host === `127.0.0.1:${port}` || host === `[::1]:${port}`) && req.method === "GET" && url.pathname === base) {
        res.writeHead(302, { location: `http://localhost:${port}${base}` });
        res.end();
        return;
      }
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === base) {
      const nonce = crypto.randomBytes(16).toString("base64");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(page(nonce));
      return;
    }
    if (req.method === "GET" && url.pathname === `${base}/next`) {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const w = { after, res, timer: setTimeout(() => {
        waiters.delete(w);
        json(res, 200, { idle: true });
      }, POLL_HOLD_MS) };
      if (!answerWaiter(w)) {
        waiters.add(w);
        res.on("close", () => {
          clearTimeout(w.timer);
          waiters.delete(w);
        });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === `${base}/result`) {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 64 * 1024) req.destroy();
        else chunks.push(c);
      });
      req.on("end", () => {
        let body: any;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return json(res, 400, { ok: false });
        }
        if (!pending || body?.seq !== pending.seq) return json(res, 409, { ok: false });
        const p = pending;
        pending = null;
        clearTimeout(p.timer);
        job.answered();
        if (body.ok) p.resolve(body.result);
        else p.reject(new CliError("PASSKEY_CANCELLED", "The passkey request was cancelled in the browser. Nothing was signed."));
        json(res, 200, { ok: true });
      });
      return;
    }
    res.writeHead(404);
    res.end();
  };

  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as { port: number }).port;
  // Browsers may resolve "localhost" to the IPv6 loopback first. Serve it too when the port is free there.
  const server6 = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server6.once("error", () => resolve());
    server6.listen(port, "::1", () => resolve());
  });
  const address = `http://localhost:${port}${base}`;
  job.setPasskeyUrl(address);
  log(`Passkey page listening on the loopback interface, port ${port}`);

  const ask = (kind: string, prompt: string, publicKey?: unknown) => {
    if (closed) return Promise.reject(new CliError("PASSKEY_CLOSED", "The passkey page is closed."));
    if (pending) return Promise.reject(new CliError("PASSKEY_BUSY", "Another passkey request is still waiting."));
    return new Promise<any>((resolve, reject) => {
      const mine = ++seq;
      const timer = setTimeout(() => {
        if (pending?.seq === mine) pending = null;
        reject(new CliError("PASSKEY_TIMEOUT", "No approval arrived from the browser within five minutes. Nothing was signed."));
      }, REQUEST_TIMEOUT_MS);
      pending = { seq: mine, kind, prompt, publicKey, resolve, reject, timer };
      job.waitingPasskey(prompt);
      flush();
    });
  };
  const transport = {
    request(req: BridgeRequest) {
      return ask(req.kind, req.prompt, req.publicKey);
    },
    async ready(intro: string) {
      await ask("ready", intro);
    },
    async close(message = "Done. You can close this tab.") {
      if (closed) return;
      closed = { message };
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new CliError("PASSKEY_CLOSED", "The passkey request ended before it was approved."));
        pending = null;
      }
      flush();
      // Give an open tab a moment to fetch the closing message.
      await new Promise((r) => setTimeout(r, 1500));
      for (const w of waiters) clearTimeout(w.timer);
      server.close();
      server6.close();
      server.closeAllConnections?.();
      server6.closeAllConnections?.();
    },
  };
  return transport as unknown as WebAuthnTransport;
}

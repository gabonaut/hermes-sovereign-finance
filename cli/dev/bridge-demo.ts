// Opens the passkey page with one sample request so its layout and script can be checked by hand.
// Usage: node dev/bridge-demo.ts [create|get]   (prints the address; ends after two minutes)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserTransport } from "../src/bridge.ts";
import { JobReporter } from "../src/job.ts";
import { Store } from "../src/store.ts";
import { webAuthnFns } from "../src/webauthn.ts";

const kind = process.argv[2] === "get" ? "get" : "create";
const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "sf-bridge-demo-")));
const job = new JobReporter(store, "demo", "create", (line) => console.log(line));
const transport = await browserTransport(job, (line) => console.log(line));
const fns = webAuthnFns(transport, () =>
  kind === "create"
    ? "Create the passkey that controls your wallet on BNB Chain testnet and Sepolia."
    : "Activate the agent's session on BNB Chain testnet. Spend up to 0.2 tBNB per day, relay fees included. Spend up to 0.5 WBNB, 500 USDT per day. Until 2026-11-12 17:45 UTC.",
);
const timer = setTimeout(async () => {
  await transport.close("The demo ended. You can close this tab.");
  process.exit(0);
}, 120_000);
try {
  const result: any =
    kind === "create"
      ? await fns.createFn({ publicKey: { rp: { id: "localhost", name: "localhost" }, user: { id: crypto.randomBytes(20), name: "Sovereign Finance (demo)", displayName: "Sovereign Finance (demo)" }, challenge: crypto.randomBytes(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" } } } as any)
      : await fns.getFn({ publicKey: { challenge: crypto.randomBytes(32), rpId: "localhost", allowCredentials: [], userVerification: "required" } } as any);
  console.log("RESULT", kind, "credential id", result.id, kind === "create" ? `spki bytes ${result.response.getPublicKey().byteLength}` : `signature bytes ${result.response.signature.byteLength}, userHandle bytes ${result.response.userHandle.byteLength}`);
  await transport.close("Done. You can close this tab.");
} catch (e: any) {
  console.log("ENDED", e?.code ?? "", e?.message ?? e);
  await transport.close("This request ended. You can close this tab.");
}
clearTimeout(timer);

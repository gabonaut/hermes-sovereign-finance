import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fixedWidthDer, parseDerSignature, webAuthnFns, b64url } from "../src/webauthn.ts";
import { softwareTransport } from "../dev/software-authenticator.ts";

test("fixedWidthDer keeps r and s and always yields the 72-byte layout", () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const check = (der: Uint8Array) => {
    const { r, s } = parseDerSignature(der);
    const fixed = fixedWidthDer(der);
    assert.equal(fixed.length, 72);
    assert.equal(fixed[4], 0);
    assert.equal(fixed[39], 0);
    assert.equal(BigInt("0x" + Buffer.from(fixed.subarray(5, 37)).toString("hex")), r);
    assert.equal(BigInt("0x" + Buffer.from(fixed.subarray(40)).toString("hex")), s);
  };
  for (let i = 0; i < 200; i++) check(new Uint8Array(crypto.sign("sha256", Buffer.from(`m${i}`), privateKey)));
  // A short r (one byte) and a 31-byte s.
  const s31 = Buffer.alloc(31, 0x11);
  check(new Uint8Array(Buffer.concat([Buffer.from([0x30, 3 + 2 + 31, 0x02, 0x01, 0x07, 0x02, 31]), s31])));
});

test("createFn and getFn round trip through the software authenticator", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sf-authn-")), "authn.json");
  const fns = webAuthnFns(softwareTransport(file), () => "test");
  const userId = crypto.randomBytes(20);
  const created: any = await fns.createFn({
    publicKey: { rp: { id: "localhost", name: "localhost" }, user: { id: userId, name: "t", displayName: "t" }, challenge: crypto.randomBytes(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }] },
  } as any);
  const spki = Buffer.from(created.response.getPublicKey());
  const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  const challenge = crypto.randomBytes(32);
  const got: any = await fns.getFn({ publicKey: { challenge, rpId: "localhost", allowCredentials: [{ id: b64url.decode(created.id), type: "public-key" }] } } as any);
  assert.deepEqual(Buffer.from(got.response.userHandle), userId);
  const clientData = JSON.parse(Buffer.from(got.response.clientDataJSON).toString());
  assert.equal(clientData.challenge, b64url.encode(challenge));
  const signed = Buffer.concat([Buffer.from(got.response.authenticatorData), crypto.createHash("sha256").update(Buffer.from(got.response.clientDataJSON)).digest()]);
  // Verify with the IEEE P1363 form rebuilt from the fixed-width DER.
  const sig = new Uint8Array(got.response.signature);
  const p1363 = Buffer.concat([Buffer.from(sig.subarray(5, 37)), Buffer.from(sig.subarray(40))]);
  assert.ok(crypto.verify("sha256", signed, { key: publicKey, dsaEncoding: "ieee-p1363" }, p1363));
});

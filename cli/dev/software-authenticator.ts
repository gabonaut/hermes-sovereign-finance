// A software WebAuthn authenticator for tests and testnet probes. It stands in for the browser
// page behind the same transport interface, so the SDK path under test is the shipped one.
// Its private keys sit in a plain file: never use it for a wallet that holds real funds.
import crypto from "node:crypto";
import fs from "node:fs";
import { b64url, type WebAuthnTransport, type CreateRequest, type GetRequest } from "../src/webauthn.ts";

type Stored = { pkcs8: string; userHandle: string; rpId: string; createdAt: string };

export function softwareTransport(file: string, log: (line: string) => void = () => {}): WebAuthnTransport {
  const load = (): Record<string, Stored> => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
  const save = (all: Record<string, Stored>) => fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });

  const create = (req: CreateRequest) => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const id = b64url.encode(crypto.randomBytes(16));
    const all = load();
    all[id] = {
      pkcs8: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      userHandle: req.publicKey.user.id,
      rpId: req.publicKey.rp.id,
      createdAt: new Date().toISOString(),
    };
    save(all);
    log(`software authenticator: created credential ${id} (${req.prompt})`);
    return { id, publicKeySpki: b64url.encode(publicKey.export({ type: "spki", format: "der" })) };
  };

  const get = (req: GetRequest) => {
    const all = load();
    const wanted = req.publicKey.allowCredentials.map((c) => c.id).find((id) => all[id]);
    const id = wanted ?? Object.keys(all).sort((a, b) => all[b].createdAt.localeCompare(all[a].createdAt))[0];
    if (!id) throw new Error("software authenticator: no credential stored");
    const cred = all[id];
    const key = crypto.createPrivateKey({ key: Buffer.from(cred.pkcs8, "base64"), format: "der", type: "pkcs8" });
    const rpIdHash = crypto.createHash("sha256").update(req.publicKey.rpId).digest();
    const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.alloc(4)]); // user present + verified
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: req.publicKey.challenge, origin: `http://${req.publicKey.rpId}`, crossOrigin: false }),
    );
    const signed = Buffer.concat([authenticatorData, crypto.createHash("sha256").update(clientDataJSON).digest()]);
    const signature = crypto.sign("sha256", signed, key);
    log(`software authenticator: signed with ${id} (${req.prompt})`);
    return {
      id,
      authenticatorData: b64url.encode(authenticatorData),
      clientDataJSON: b64url.encode(clientDataJSON),
      signature: b64url.encode(signature),
      userHandle: cred.userHandle,
    };
  };

  return {
    async request(req: any) {
      return req.kind === "create" ? create(req) : get(req);
    },
    async close() {},
  } as WebAuthnTransport;
}

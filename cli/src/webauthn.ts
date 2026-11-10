// WebAuthn functions for the Altana SDK when it runs in Node.
//
// The SDK signs admin actions with a passkey. In Node there is no navigator.credentials, so the
// SDK accepts createFn/getFn. These hand each ceremony to a transport and rebuild the browser's
// credential objects from the transport's JSON answer. The shipped transport is a one-shot page
// on localhost opened in the system browser (see bridge.ts).
import type { PasskeyWebAuthnFns } from "@altananetwork/sdk";

export const RP_ID = "localhost";

export type CreateRequest = {
  kind: "create";
  prompt: string;
  publicKey: {
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: { type: string; alg: number }[];
    authenticatorSelection?: Record<string, unknown>;
    attestation?: string;
    extensions?: Record<string, unknown>;
  };
};
export type GetRequest = {
  kind: "get";
  prompt: string;
  publicKey: {
    challenge: string;
    rpId: string;
    allowCredentials: { id: string; type: string }[];
    userVerification?: string;
  };
};
export type BridgeRequest = CreateRequest | GetRequest;
export type CreateResponse = { id: string; publicKeySpki: string };
export type GetResponse = { id: string; authenticatorData: string; clientDataJSON: string; signature: string; userHandle: string | null };

export interface WebAuthnTransport {
  request(req: CreateRequest): Promise<CreateResponse>;
  request(req: GetRequest): Promise<GetResponse>;
  close(message?: string): Promise<void>;
}

export const b64url = {
  encode(bytes: Uint8Array | ArrayBuffer): string {
    return Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString("base64url");
  },
  decode(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text, "base64url"));
  },
};

const toBytes = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error("Expected binary data in the WebAuthn options");
};
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** Read r and s out of an ASN.1 DER ECDSA signature. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  const fail = () => new Error("The authenticator returned a malformed signature");
  if (der[i++] !== 0x30) throw fail();
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f);
  else i += 1;
  const readInt = () => {
    if (der[i++] !== 0x02) throw fail();
    const len = der[i++];
    if (len === undefined || len > 33 || i + len > der.length) throw fail();
    const hex = Buffer.from(der.subarray(i, i + len)).toString("hex");
    i += len;
    return BigInt(`0x${hex || "0"}`);
  };
  const r = readInt();
  const s = readInt();
  return { r, s };
}

/**
 * Re-encode a signature so that r and s are each a zero byte followed by 32 bytes.
 * Every signature handed to the SDK then has the same layout.
 */
export function fixedWidthDer(der: Uint8Array): Uint8Array {
  const { r, s } = parseDerSignature(der);
  const word = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, 0x46, 0x02, 0x21, 0x00]), word(r), Buffer.from([0x02, 0x21, 0x00]), word(s)]));
}

/** Build the SDK's createFn/getFn on top of a transport. `prompt()` returns the sentence shown to the user. */
export function webAuthnFns(transport: WebAuthnTransport, prompt: () => string): Required<PasskeyWebAuthnFns> {
  const createFn = async (options: any) => {
    const pk = options?.publicKey;
    if (!pk) throw new Error("Missing WebAuthn creation options");
    const res = await transport.request({
      kind: "create",
      prompt: prompt(),
      publicKey: {
        rp: { id: pk.rp?.id ?? RP_ID, name: pk.rp?.name ?? RP_ID },
        user: { id: b64url.encode(toBytes(pk.user.id)), name: pk.user.name, displayName: pk.user.displayName },
        challenge: b64url.encode(toBytes(pk.challenge)),
        pubKeyCredParams: pk.pubKeyCredParams,
        authenticatorSelection: pk.authenticatorSelection,
        attestation: pk.attestation,
        extensions: pk.extensions,
      },
    });
    const spki = b64url.decode(res.publicKeySpki);
    return {
      id: res.id,
      type: "public-key",
      rawId: toArrayBuffer(b64url.decode(res.id)),
      response: { getPublicKey: () => toArrayBuffer(spki) },
    };
  };
  const getFn = async (options: any) => {
    const pk = options?.publicKey;
    if (!pk) throw new Error("Missing WebAuthn request options");
    const res = await transport.request({
      kind: "get",
      prompt: prompt(),
      publicKey: {
        challenge: b64url.encode(toBytes(pk.challenge)),
        rpId: pk.rpId ?? RP_ID,
        allowCredentials: (pk.allowCredentials ?? []).map((c: any) => ({ id: b64url.encode(toBytes(c.id)), type: c.type ?? "public-key" })),
        userVerification: pk.userVerification,
      },
    });
    if (!res.userHandle) throw new Error("This passkey returned no user handle, so it cannot be matched to a wallet");
    return {
      id: res.id,
      type: "public-key",
      rawId: toArrayBuffer(b64url.decode(res.id)),
      response: {
        authenticatorData: toArrayBuffer(b64url.decode(res.authenticatorData)),
        clientDataJSON: toArrayBuffer(b64url.decode(res.clientDataJSON)),
        signature: toArrayBuffer(fixedWidthDer(b64url.decode(res.signature))),
        userHandle: toArrayBuffer(b64url.decode(res.userHandle)),
      },
    };
  };
  return { createFn: createFn as any, getFn: getFn as any };
}

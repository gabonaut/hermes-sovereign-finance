// Read-only chain queries shared by the commands.
import { formatUnits, type Address, type Hex } from "viem";
import { rpc, type Chain } from "./config.ts";
import { controllerAbi, erc20Abi, keyStoreAbi } from "./abi.ts";

export const nativeBalance = (chain: Chain, address: Address) => rpc(chain).getBalance({ address });

export async function balances(chain: Chain, address: Address) {
  const client = rpc(chain);
  const [native, ...tokens] = await Promise.all([
    client.getBalance({ address }),
    ...chain.assets.map((a) => client.readContract({ address: a.address, abi: erc20Abi, functionName: "balanceOf", args: [address] })),
  ]);
  return {
    nativeRaw: native,
    native: formatUnits(native, 18),
    tokens: chain.assets.map((a, i) => ({ symbol: a.symbol, raw: tokens[i] as bigint, amount: formatUnits(tokens[i] as bigint, a.decimals) })),
  };
}

export const keystoreKeys = (chain: Chain, wallet: Address) =>
  rpc(chain).readContract({ address: chain.keyStore, abi: keyStoreAbi, functionName: "getKeys", args: [wallet] }) as Promise<Hex[]>;

export const isValidKey = (chain: Chain, wallet: Address, keyId: Hex) =>
  rpc(chain).readContract({ address: chain.keyStore, abi: keyStoreAbi, functionName: "isValidKey", args: [wallet, keyId] }) as Promise<boolean>;

export const registrationFee = (chain: Chain) =>
  rpc(chain).readContract({ address: chain.keyStoreController, abi: controllerAbi, functionName: "getRegistrationFeeInWei" }) as Promise<bigint>;

/** True when the chain's relay answers and lists this chain. */
export async function relayServes(chain: Chain): Promise<boolean> {
  const res = await fetch(chain.relayUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "wallet_getCapabilities", params: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return false;
  const body: any = await res.json();
  return Boolean(body?.result && `0x${chain.chainId.toString(16)}` in body.result);
}

/** Gas the relay adds to every intent when it prices its fee, read from the relay itself. */
export async function relayGasBuffer(chain: Chain): Promise<bigint> {
  const fallback = 2_650_000n;
  try {
    const res = await fetch(chain.relayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "wallet_getCapabilities", params: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await res.json();
    const gas = body?.result?.[`0x${chain.chainId.toString(16)}`]?.fees?.quoteConfig?.gas;
    if (!gas) return fallback;
    // Zero is a real answer: the mainnet relay adds no buffer.
    return BigInt(Math.round(Number(gas.intentBuffer ?? 0))) + BigInt(Math.round(Number(gas.txBuffer ?? 0)));
  } catch {
    return fallback;
  }
}

/**
 * The call permissions the relay reports for one session key on a wallet, as lowercase
 * "address:selector" pairs, or null when the wallet does not hold that key.
 */
export async function grantedPairs(chain: Chain, wallet: Address, sessionAddress: Address): Promise<Set<string> | null> {
  const res = await fetch(chain.relayUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "wallet_getKeys", params: [{ address: wallet, chainIds: [`0x${chain.chainId.toString(16)}`] }] }),
    signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json();
  const keys: any[] = body?.result?.[`0x${chain.chainId.toString(16)}`] ?? [];
  const key = keys.find((k) => String(k.publicKey).toLowerCase().endsWith(sessionAddress.slice(2).toLowerCase()));
  if (!key) return null;
  return new Set((key.permissions ?? []).filter((p: any) => p.type === "call").map((p: any) => `${String(p.to).toLowerCase()}:${String(p.selector).toLowerCase()}`));
}

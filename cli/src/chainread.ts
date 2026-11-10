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

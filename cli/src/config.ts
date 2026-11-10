// Network table and client construction. Every address comes from networks.json at the repo root.
import { createPublicClient, http, getAddress, type Address, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { BNB, ETHEREUM, BNB_TESTNET, createClient, type NetworkConfig } from "@altananetwork/sdk";
import table from "../../networks.json" with { type: "json" };
import { installRelayCompat } from "./relaycompat.ts";

export type Mode = "testnet" | "mainnet";
export type NetworkKey = "bnb" | "ethereum";
export const NETWORK_KEYS: NetworkKey[] = ["bnb", "ethereum"];

export type Asset = { symbol: string; address: Address; decimals: number };
export type Dex = {
  name: string;
  kind: "pancake" | "uniswap";
  feeTiers: number[];
  factory: Address;
  poolDeployer: Address;
  poolInitCodeHash: `0x${string}`;
  router: Address;
  quoter: Address;
  positionManager: Address;
};
export type Chain = {
  chainId: number;
  key: NetworkKey;
  name: string;
  shortName: string;
  nativeSymbol: string;
  rpcUrl: string;
  relayUrl: string;
  explorerUrl: string;
  keystoreExplorerUrl: string;
  dexscreenerChain: string | null;
  keyStore: Address;
  keyStoreController: Address;
  dex: Dex;
  wrappedNative: Asset;
  assets: Asset[];
  preset: { nativeCap: string; feeHeadroom: string; caps: Record<string, string> };
  sdkConfig: string | null;
  /** A caveat about this network's relay, shown with relay failures. */
  relayNote: string | null;
};

const SDK_CONFIGS: Record<string, NetworkConfig> = { BNB, ETHEREUM, BNB_TESTNET };

function parseChain(id: string, raw: any): Chain {
  const assets: Asset[] = raw.assets.map((a: any) => ({ symbol: a.symbol, address: getAddress(a.address), decimals: a.decimals }));
  const wrapped = assets.find((a) => a.symbol === raw.wrappedNative);
  if (!wrapped) throw new Error(`networks.json: chain ${id} has no asset for wrappedNative ${raw.wrappedNative}`);
  return {
    chainId: Number(id),
    key: raw.key,
    name: raw.name,
    shortName: raw.shortName,
    nativeSymbol: raw.nativeSymbol,
    rpcUrl: raw.rpcUrl,
    relayUrl: raw.relayUrl,
    explorerUrl: raw.explorerUrl,
    keystoreExplorerUrl: raw.keystoreExplorerUrl,
    dexscreenerChain: raw.dexscreenerChain,
    keyStore: getAddress(raw.keyStore.address),
    keyStoreController: getAddress(raw.keyStoreController.address),
    dex: {
      name: raw.dex.name,
      kind: raw.dex.kind,
      feeTiers: raw.dex.feeTiers,
      factory: getAddress(raw.dex.factory.address),
      poolDeployer: getAddress(raw.dex.poolDeployer.address),
      poolInitCodeHash: raw.dex.poolInitCodeHash,
      router: getAddress(raw.dex.router.address),
      quoter: getAddress(raw.dex.quoter.address),
      positionManager: getAddress(raw.dex.positionManager.address),
    },
    wrappedNative: wrapped,
    assets,
    preset: raw.preset,
    sdkConfig: raw.sdkConfig,
    relayNote: typeof raw.relayNote === "string" ? raw.relayNote : null,
  };
}

const CHAINS: Record<number, Chain> = Object.fromEntries(
  Object.entries((table as any).chains).map(([id, raw]) => [Number(id), parseChain(id, raw)]),
);

export function isMode(v: unknown): v is Mode {
  return v === "testnet" || v === "mainnet";
}
export function isNetworkKey(v: unknown): v is NetworkKey {
  return v === "bnb" || v === "ethereum";
}

export function chainFor(mode: Mode, key: NetworkKey): Chain {
  const id = (table as any).modes[mode][key];
  return CHAINS[id];
}
export function chainsFor(mode: Mode): Chain[] {
  return NETWORK_KEYS.map((k) => chainFor(mode, k));
}
export function chainById(chainId: number): Chain {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`Unknown chain ${chainId}`);
  return c;
}

/** The SDK network config: the SDK's own export where one exists, the brief's custom config for Sepolia. */
export function sdkNetwork(chain: Chain): NetworkConfig {
  if (chain.sdkConfig) {
    const cfg = SDK_CONFIGS[chain.sdkConfig];
    if (!cfg) throw new Error(`SDK has no network config named ${chain.sdkConfig}`);
    return cfg;
  }
  if (chain.chainId !== sepolia.id) throw new Error(`No SDK network config for chain ${chain.chainId}`);
  return {
    chain: sepolia,
    chainId: chain.chainId,
    keyStore: chain.keyStore,
    keyStoreController: chain.keyStoreController,
    publicRpcUrl: chain.rpcUrl,
    explorer: chain.explorerUrl,
    relayUrl: chain.relayUrl,
  };
}

export function altanaClient(chains: Chain[]) {
  const networks = chains.map(sdkNetwork);
  installRelayCompat(networks.map((n) => n.relayUrl));
  return createClient({ chains: networks });
}

const rpcCache = new Map<number, PublicClient>();
export function rpc(chain: Chain): PublicClient {
  let c = rpcCache.get(chain.chainId);
  if (!c) {
    c = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 20_000, retryCount: 2 }) }) as PublicClient;
    rpcCache.set(chain.chainId, c);
  }
  return c;
}

export function findAsset(chain: Chain, symbolOrAddress: string): Asset | undefined {
  const s = symbolOrAddress.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return chain.assets.find((a) => a.address.toLowerCase() === s.toLowerCase());
  return chain.assets.find((a) => a.symbol.toLowerCase() === s.toLowerCase());
}
export function requireAsset(chain: Chain, symbolOrAddress: string): Asset {
  const a = findAsset(chain, symbolOrAddress);
  if (!a) {
    throw new Error(`${symbolOrAddress} is not in this plugin's asset list for ${chain.name}. Known: ${chain.assets.map((x) => x.symbol).join(", ")}`);
  }
  return a;
}

export const txUrl = (chain: Chain, hash: string) => `${chain.explorerUrl}/tx/${hash}`;
export const addressUrl = (chain: Chain, address: string) => `${chain.explorerUrl}/address/${address}`;
export const keystoreKeyUrl = (chain: Chain, keyId: string) => `${chain.keystoreExplorerUrl}/key/${keyId}`;
export const keystoreAccountUrl = (chain: Chain, address: string) => `${chain.keystoreExplorerUrl}/account/${address}`;

export const skillsConfig = (table as any).skills as { indexUrl: string; pinned: Record<string, string> };

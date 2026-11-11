# Backend contract

The Desktop pane talks to the plugin backend (`dashboard/plugin_api.py`) through `ctx.rest`. All routes live under
`/api/plugins/sovereign-finance`. They answer only the local Hermes Desktop app: any other caller gets HTTP 403.

Every response is HTTP 200 JSON, either `{"ok": true, "data": ...}` or
`{"ok": false, "error": {"code": string, "message": string}}`.

```
GET  /state                                                         -> data: State
POST /mode         {"mode": "testnet" | "mainnet"}                  -> data: {}
POST /create       {}                                               -> data: {"jobId": string}
POST /recover      {}                                               -> data: {"jobId": string}
POST /grant        GrantRequest                                     -> data: {"draft": Draft}
POST /activate     {"draftId": string, "networks": NetworkKey[]}    -> data: {"jobId": string}
POST /revoke       {"network": NetworkKey}                          -> data: {"jobId": string}
POST /withdraw     {"network": NetworkKey, "asset": string, "amount": string, "to": string} -> data: {"jobId": string}
POST /job/dismiss  {}                                               -> data: {}
POST /job/cancel   {}                                               -> data: {}

NetworkKey = "bnb" | "ethereum"

State = {
  mode: "testnet" | "mainnet",
  wallet: null | { address: string },
  networks: NetworkState[],     // always two entries, bnb first
  job: null | Job,              // at most one admin job at a time
  preset: Preset,               // defaults for the permission form in the current mode
  draft: null | Draft           // last compiled permission draft for the current mode
}

NetworkState = {
  key: NetworkKey, chainId: number,
  name: string,                 // "BNB Chain", "Ethereum", "BNB Chain testnet", "Sepolia"
  shortName: string,            // badge text
  nativeSymbol: string,         // "BNB", "ETH", "tBNB", "SepoliaETH"
  dex: string,                  // "PancakeSwap V3" | "Uniswap V3"
  explorerUrl: string,
  addressUrl: string | null,    // explorer page of the wallet address
  keystoreAccountUrl: string | null,
  asOf: string | null,          // ISO time of the last good chain read
  error: string | null,         // last read error for this network
  balances: null | { native: string, tokens: { symbol: string, amount: string }[] },   // human units
  session: null | Session,
  positions: Position[]
}

Session = {
  status: "active" | "expired" | "revoked",
  keyId: string, expiry: number /* unix seconds */,
  scopeText: string[],          // plain-English lines
  keystoreKeyUrl: string, grantTxUrl: string | null, revokeTxUrl: string | null
}

Position = {
  tokenId: string, pair: string /* "WBNB/USDT" */, feePct: string /* "0.05" */, inRange: boolean,
  priceLower: string, priceUpper: string, priceCurrent: string, priceUnit: string /* "USDT per WBNB" */,
  amounts: { symbol: string, amount: string }[],         // two entries
  unclaimedFees: { symbol: string, amount: string }[],   // two entries
  mintedAt: string | null
}

Job = {
  id: string, kind: "create" | "recover" | "activate" | "revoke" | "withdraw",
  status: "running" | "waiting_passkey" | "done" | "error",
  step: string,                 // short progress line
  passkeyUrl: string | null,    // set while waiting_passkey, an http://localhost:<port>/... URL
  passkeyPrompt: string | null, // what the passkey is about to sign
  result: null | JobResult, error: null | { code: string, message: string },
  startedAt: string, finishedAt: string | null
}

JobResult by kind:
  create | recover: { address: string }
  activate: { legs: { network: NetworkKey, status: "confirmed" | "failed", txUrl: string | null,
                      keystoreKeyUrl: string | null, charged: string | null, nativeSymbol: string, error: string | null }[] }
  revoke | withdraw: { network: NetworkKey, txUrl: string | null }

Preset = {
  id: "v3-lp", title: "V3 LP", durationDays: number,
  networks: { [NetworkKey]: {
    native: { symbol: string, cap: string, feeHeadroom: string },   // daily cap; feeHeadroom is the part reserved for relay fees
    tokens: { symbol: string, decimals: number, cap: string, checked: boolean }[]
  } }
}

GrantRequest = {
  durationDays: number,
  networks: { [NetworkKey]?: { nativeCap: string, tokens: { symbol: string, cap: string }[] } }   // only ticked tokens
}

Draft = {
  id: string, createdAt: string, durationDays: number, expiry: number,
  networks: { [NetworkKey]?: {
    scopeText: string[],
    cost: { keystoreFee: string, relayFeeEstimate: string, total: string, nativeSymbol: string, firstAction: boolean },
    balance: string, sufficient: boolean,
    approvals: number   // passkey approvals this network takes: 1, or more where activation is staged
  } }
}
```

## Jobs and passkeys

Create, recover, activate, revoke and withdraw are admin actions. Each needs a signature from the wallet's passkey, so
each runs as a job:

1. The route returns a `jobId` at once.
2. The CLI starts a loopback page and the job moves to `waiting_passkey` with `passkeyUrl` set.
3. The pane opens that URL in the system browser. The page shows what is about to be signed and asks for the passkey.
4. The job moves to `running` while the relay confirms, then to `done` or `error`.

Activating two networks needs two signatures. Both are collected in the same browser tab.

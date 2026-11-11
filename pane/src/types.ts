// The backend contract, as served under /api/plugins/sovereign-finance.

export type NetworkKey = 'bnb' | 'ethereum'
export type Mode = 'testnet' | 'mainnet'

export interface Amount {
  symbol: string
  amount: string
}

/** `active`, `expired` or `revoked`. Any other value is shown as it arrives. */
export type SessionStatus = 'active' | 'expired' | 'revoked' | (string & {})

export interface Session {
  status: SessionStatus
  keyId: string
  /** Unix seconds. */
  expiry: number
  scopeText: string[]
  keystoreKeyUrl: string
  grantTxUrl: string | null
  revokeTxUrl: string | null
}

export interface Position {
  tokenId: string
  pair: string
  feePct: string
  inRange: boolean
  priceLower: string
  priceUpper: string
  priceCurrent: string
  priceUnit: string
  amounts: Amount[]
  unclaimedFees: Amount[]
  mintedAt: string | null
}

export interface Balances {
  native: string
  tokens: Amount[]
}

export interface NetworkState {
  key: NetworkKey
  chainId: number
  name: string
  shortName: string
  nativeSymbol: string
  dex: string
  explorerUrl: string
  addressUrl: string | null
  keystoreAccountUrl: string | null
  asOf: string | null
  error: string | null
  balances: Balances | null
  session: Session | null
  positions: Position[]
}

export type JobKind = 'create' | 'recover' | 'activate' | 'revoke' | 'withdraw' | (string & {})
export type JobStatus = 'running' | 'waiting_passkey' | 'done' | 'error'

export interface ActivateLeg {
  network: NetworkKey
  /** `confirmed` or `failed`. */
  status: string
  txUrl: string | null
  keystoreKeyUrl: string | null
  charged: string | null
  nativeSymbol: string
  error: string | null
}

export interface JobResult {
  /** create, recover */
  address?: string
  /** activate */
  legs?: ActivateLeg[]
  /** revoke, withdraw */
  network?: NetworkKey
  txUrl?: string | null
}

export interface Job {
  id: string
  kind: JobKind
  status: JobStatus
  step: string
  passkeyUrl: string | null
  passkeyPrompt: string | null
  result: JobResult | null
  error: { code: string; message: string } | null
  startedAt: string
  finishedAt: string | null
}

export interface PresetToken {
  symbol: string
  decimals: number | null
  cap: string
  checked: boolean
}

export interface PresetNetwork {
  native: { symbol: string; cap: string; feeHeadroom: string }
  tokens: PresetToken[]
}

export interface Preset {
  id: string
  title: string
  durationDays: number
  networks: Partial<Record<NetworkKey, PresetNetwork>>
}

export interface DraftNetwork {
  scopeText: string[]
  cost: {
    keystoreFee: string
    relayFeeEstimate: string
    total: string
    nativeSymbol: string
    firstAction: boolean
  }
  balance: string
  sufficient: boolean
  /** Passkey approvals this network's activation takes. One, except where it is granted in stages. */
  approvals: number
}

export interface Draft {
  id: string
  createdAt: string
  durationDays: number
  /** Unix seconds. */
  expiry: number
  networks: Partial<Record<NetworkKey, DraftNetwork>>
}

export interface WalletState {
  mode: Mode
  wallet: { address: string } | null
  networks: NetworkState[]
  job: Job | null
  preset: Preset
  draft: Draft | null
  /** Wallets set aside in this mode, newest first. */
  otherWallets: OtherWallet[]
}

export interface OtherWallet {
  address: string
  setAsideAt: string | null
}

export interface GrantRequest {
  durationDays: number
  networks: Partial<Record<NetworkKey, { nativeCap: string; tokens: { symbol: string; cap: string }[] }>>
}

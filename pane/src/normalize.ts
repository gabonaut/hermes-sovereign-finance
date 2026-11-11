// Coerces whatever /state returns into the contract shape, so a missing optional field renders as
// empty instead of throwing during render.

import type {
  ActivateLeg,
  Amount,
  Balances,
  Draft,
  DraftNetwork,
  Job,
  JobResult,
  JobStatus,
  NetworkKey,
  NetworkState,
  Position,
  Preset,
  PresetNetwork,
  PresetToken,
  Session,
  WalletState
} from './types'

type Dict = Record<string, unknown>

const dict = (v: unknown): Dict | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function text(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return fallback
}

function textOrNull(v: unknown): string | null {
  const s = text(v).trim()
  return s === '' ? null : s
}

function int(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

const lines = (v: unknown): string[] => list(v).map(item => text(item).trim()).filter(Boolean)

function amounts(v: unknown): Amount[] {
  const out: Amount[] = []
  for (const item of list(v)) {
    const d = dict(item)
    const symbol = d ? text(d.symbol).trim() : ''
    if (d && symbol) out.push({ symbol, amount: text(d.amount, '0') })
  }
  return out
}

function balances(v: unknown): Balances | null {
  const d = dict(v)
  return d ? { native: text(d.native, '0'), tokens: amounts(d.tokens) } : null
}

function session(v: unknown): Session | null {
  const d = dict(v)
  if (!d) return null
  return {
    status: text(d.status).trim().toLowerCase(),
    keyId: text(d.keyId),
    expiry: int(d.expiry),
    scopeText: lines(d.scopeText),
    keystoreKeyUrl: text(d.keystoreKeyUrl),
    grantTxUrl: textOrNull(d.grantTxUrl),
    revokeTxUrl: textOrNull(d.revokeTxUrl)
  }
}

function position(v: unknown): Position | null {
  const d = dict(v)
  if (!d) return null
  return {
    tokenId: text(d.tokenId),
    pair: text(d.pair),
    feePct: text(d.feePct),
    inRange: d.inRange === true,
    priceLower: text(d.priceLower),
    priceUpper: text(d.priceUpper),
    priceCurrent: text(d.priceCurrent),
    priceUnit: text(d.priceUnit),
    amounts: amounts(d.amounts),
    unclaimedFees: amounts(d.unclaimedFees),
    mintedAt: textOrNull(d.mintedAt)
  }
}

function network(v: unknown): NetworkState | null {
  const d = dict(v)
  const key = d ? text(d.key).trim() : ''
  if (!d || !key) return null
  const name = text(d.name, key)
  return {
    key: key as NetworkKey,
    chainId: int(d.chainId),
    name,
    shortName: text(d.shortName, name),
    nativeSymbol: text(d.nativeSymbol),
    dex: text(d.dex),
    explorerUrl: text(d.explorerUrl),
    addressUrl: textOrNull(d.addressUrl),
    keystoreAccountUrl: textOrNull(d.keystoreAccountUrl),
    asOf: textOrNull(d.asOf),
    error: textOrNull(d.error),
    balances: balances(d.balances),
    session: session(d.session),
    positions: list(d.positions)
      .map(position)
      .filter((p): p is Position => p !== null)
  }
}

const JOB_STATUSES: readonly JobStatus[] = ['running', 'waiting_passkey', 'done', 'error']

function leg(v: unknown): ActivateLeg | null {
  const d = dict(v)
  const key = d ? text(d.network).trim() : ''
  if (!d || !key) return null
  return {
    network: key as NetworkKey,
    status: text(d.status).trim().toLowerCase(),
    txUrl: textOrNull(d.txUrl),
    keystoreKeyUrl: textOrNull(d.keystoreKeyUrl),
    charged: textOrNull(d.charged),
    nativeSymbol: text(d.nativeSymbol),
    error: textOrNull(d.error)
  }
}

function jobResult(v: unknown): JobResult | null {
  const d = dict(v)
  if (!d) return null
  const result: JobResult = {}
  const address = textOrNull(d.address)
  if (address) result.address = address
  if (Array.isArray(d.legs)) result.legs = d.legs.map(leg).filter((l): l is ActivateLeg => l !== null)
  const key = textOrNull(d.network)
  if (key) result.network = key as NetworkKey
  if ('txUrl' in d) result.txUrl = textOrNull(d.txUrl)
  return result
}

function job(v: unknown): Job | null {
  const d = dict(v)
  if (!d) return null
  const err = dict(d.error)
  return {
    id: text(d.id),
    kind: text(d.kind).trim(),
    // An unknown status keeps the admin buttons locked, the same as a running job.
    status: JOB_STATUSES.find(s => s === d.status) ?? 'running',
    step: text(d.step),
    passkeyUrl: textOrNull(d.passkeyUrl),
    passkeyPrompt: textOrNull(d.passkeyPrompt),
    result: jobResult(d.result),
    error: err ? { code: text(err.code, 'error'), message: text(err.message) } : null,
    startedAt: text(d.startedAt),
    finishedAt: textOrNull(d.finishedAt)
  }
}

function presetNetwork(v: unknown): PresetNetwork | null {
  const d = dict(v)
  if (!d) return null
  const native = dict(d.native) ?? {}
  const tokens: PresetToken[] = []
  for (const item of list(d.tokens)) {
    const t = dict(item)
    const symbol = t ? text(t.symbol).trim() : ''
    if (t && symbol) {
      const decimals = int(t.decimals, -1)
      tokens.push({ symbol, decimals: decimals >= 0 ? decimals : null, cap: text(t.cap), checked: t.checked === true })
    }
  }
  return {
    native: { symbol: text(native.symbol), cap: text(native.cap), feeHeadroom: text(native.feeHeadroom) },
    tokens
  }
}

function preset(v: unknown): Preset {
  const d = dict(v) ?? {}
  const networks: Preset['networks'] = {}
  for (const [key, value] of Object.entries(dict(d.networks) ?? {})) {
    const parsed = presetNetwork(value)
    if (parsed) networks[key as NetworkKey] = parsed
  }
  return { id: text(d.id, 'v3-lp'), title: text(d.title, 'V3 LP'), durationDays: int(d.durationDays, 30), networks }
}

function draftNetwork(v: unknown): DraftNetwork | null {
  const d = dict(v)
  if (!d) return null
  const cost = dict(d.cost) ?? {}
  return {
    scopeText: lines(d.scopeText),
    cost: {
      keystoreFee: text(cost.keystoreFee, '0'),
      relayFeeEstimate: text(cost.relayFeeEstimate, '0'),
      total: text(cost.total, '0'),
      nativeSymbol: text(cost.nativeSymbol),
      firstAction: cost.firstAction === true
    },
    balance: text(d.balance, '0'),
    sufficient: d.sufficient !== false,
    approvals: Math.max(1, int(d.approvals, 1))
  }
}

export function normalizeDraft(v: unknown): Draft | null {
  const d = dict(v)
  const id = d ? text(d.id) : ''
  if (!d || !id) return null
  const networks: Draft['networks'] = {}
  for (const [key, value] of Object.entries(dict(d.networks) ?? {})) {
    const parsed = draftNetwork(value)
    if (parsed) networks[key as NetworkKey] = parsed
  }
  return { id, createdAt: text(d.createdAt), durationDays: int(d.durationDays), expiry: int(d.expiry), networks }
}

/** Returns null when the payload is not a state object, or does not say which mode it is in. */
export function normalizeState(v: unknown): WalletState | null {
  const d = dict(v)
  if (!d || (d.mode !== 'mainnet' && d.mode !== 'testnet')) return null
  const wallet = dict(d.wallet)
  const address = wallet ? text(wallet.address).trim() : ''
  return {
    mode: d.mode,
    wallet: address ? { address } : null,
    networks: list(d.networks)
      .map(network)
      .filter((n): n is NetworkState => n !== null),
    job: job(d.job),
    preset: preset(d.preset),
    draft: normalizeDraft(d.draft)
  }
}

// Fixture states for the harness, written against the backend contract. All values are made up.
// Times are relative to `now`, so a frozen clock gives identical screenshots.

import type {
  Draft,
  Job,
  Mode,
  NetworkKey,
  NetworkState,
  Position,
  Preset,
  Session,
  WalletState
} from '../src/types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Deterministic filler hex, so nothing here looks like a real account or credential. */
export function fakeHex(seed: string, length: number): string {
  let h = 2166136261
  let out = ''
  for (let round = 0; out.length < length; round++) {
    for (const ch of `${seed}:${round}`) {
      h ^= ch.codePointAt(0) ?? 0
      h = Math.imul(h, 16777619)
    }
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return '0x' + out.slice(0, length)
}

const iso = (ms: number) => new Date(ms).toISOString()

export const WALLET = fakeHex('wallet', 40)

interface NetworkBase {
  key: NetworkKey
  chainId: number
  name: string
  shortName: string
  nativeSymbol: string
  dex: string
  explorerUrl: string
  keystoreUrl: string
}

const BASES: Record<Mode, NetworkBase[]> = {
  testnet: [
    {
      key: 'bnb',
      chainId: 97,
      name: 'BNB Chain testnet',
      shortName: 'BNB testnet',
      nativeSymbol: 'tBNB',
      dex: 'PancakeSwap V3',
      explorerUrl: 'https://testnet.bscscan.com',
      keystoreUrl: 'https://testnet.altana.network'
    },
    {
      key: 'ethereum',
      chainId: 11155111,
      name: 'Sepolia',
      shortName: 'Sepolia',
      nativeSymbol: 'SepoliaETH',
      dex: 'Uniswap V3',
      explorerUrl: 'https://sepolia.etherscan.io',
      keystoreUrl: 'https://testnet.altana.network'
    }
  ],
  mainnet: [
    {
      key: 'bnb',
      chainId: 56,
      name: 'BNB Chain',
      shortName: 'BNB',
      nativeSymbol: 'BNB',
      dex: 'PancakeSwap V3',
      explorerUrl: 'https://bscscan.com',
      keystoreUrl: 'https://explorer.altana.network'
    },
    {
      key: 'ethereum',
      chainId: 1,
      name: 'Ethereum',
      shortName: 'ETH',
      nativeSymbol: 'ETH',
      dex: 'Uniswap V3',
      explorerUrl: 'https://etherscan.io',
      keystoreUrl: 'https://explorer.altana.network'
    }
  ]
}

export function baseOf(mode: Mode, key: NetworkKey): NetworkBase {
  const base = BASES[mode].find(b => b.key === key)
  if (!base) throw new Error(`no ${key} network in ${mode}`)
  return base
}

type NetworkPatch = Partial<Pick<NetworkState, 'asOf' | 'error' | 'balances' | 'session' | 'positions'>>

function network(mode: Mode, key: NetworkKey, now: number, wallet: boolean, patch: NetworkPatch = {}): NetworkState {
  const base = baseOf(mode, key)
  return {
    key,
    chainId: base.chainId,
    name: base.name,
    shortName: base.shortName,
    nativeSymbol: base.nativeSymbol,
    dex: base.dex,
    explorerUrl: base.explorerUrl,
    addressUrl: wallet ? `${base.explorerUrl}/address/${WALLET}` : null,
    keystoreAccountUrl: wallet ? `${base.keystoreUrl}/account/${WALLET}` : null,
    asOf: wallet ? iso(now - 8000) : null,
    error: null,
    balances: null,
    session: null,
    positions: [],
    ...patch
  }
}

export function presetFor(mode: Mode): Preset {
  const bnb = baseOf(mode, 'bnb').nativeSymbol
  const eth = baseOf(mode, 'ethereum').nativeSymbol
  return {
    id: 'v3-lp',
    title: 'V3 LP',
    durationDays: 30,
    networks: {
      bnb: {
        native: { symbol: bnb, cap: '0.05', feeHeadroom: '0.005' },
        tokens: [
          { symbol: 'USDT', decimals: 18, cap: '500', checked: true },
          { symbol: 'WBNB', decimals: 18, cap: '1', checked: true },
          { symbol: 'CAKE', decimals: 18, cap: '50', checked: false }
        ]
      },
      ethereum: {
        native: { symbol: eth, cap: '0.02', feeHeadroom: '0.003' },
        tokens: [
          { symbol: 'USDC', decimals: 6, cap: '500', checked: true },
          { symbol: 'WETH', decimals: 18, cap: '0.25', checked: true }
        ]
      }
    }
  }
}

export function scopeFor(mode: Mode, key: NetworkKey, days = 30): string[] {
  const base = baseOf(mode, key)
  return key === 'bnb'
    ? [
        `Swap, add and remove liquidity on ${base.dex}`,
        `Up to 0.05 ${base.nativeSymbol} per day, relay fees included`,
        'Up to 500 USDT per day',
        'Up to 1 WBNB per day',
        `Ends after ${days} days`
      ]
    : [
        `Swap, add and remove liquidity on ${base.dex}`,
        `Up to 0.02 ${base.nativeSymbol} per day, relay fees included`,
        'Up to 500 USDC per day',
        'Up to 0.25 WETH per day',
        `Ends after ${days} days`
      ]
}

const FUNDED = {
  bnb: { native: '0.2500', tokens: [{ symbol: 'USDT', amount: '250.00' }, { symbol: 'WBNB', amount: '0' }] },
  ethereum: { native: '0.0800', tokens: [{ symbol: 'USDC', amount: '100.00' }, { symbol: 'WETH', amount: '0' }] }
}

const EMPTY = {
  bnb: { native: '0', tokens: [{ symbol: 'USDT', amount: '0' }, { symbol: 'WBNB', amount: '0' }] },
  ethereum: { native: '0', tokens: [{ symbol: 'USDC', amount: '0' }, { symbol: 'WETH', amount: '0' }] }
}

export function draftFor(mode: Mode, now: number, lowOnEthereum = false): Draft {
  const bnb = baseOf(mode, 'bnb').nativeSymbol
  const eth = baseOf(mode, 'ethereum').nativeSymbol
  return {
    id: 'draft-7f3a91',
    createdAt: iso(now - 4 * MINUTE),
    durationDays: 30,
    expiry: Math.floor((now + 30 * DAY) / 1000),
    networks: {
      bnb: {
        scopeText: scopeFor(mode, 'bnb'),
        cost: { keystoreFee: '0.0012', relayFeeEstimate: '0.0004', total: '0.0016', nativeSymbol: bnb, firstAction: true },
        balance: FUNDED.bnb.native,
        sufficient: true,
        approvals: 1
      },
      ethereum: {
        scopeText: scopeFor(mode, 'ethereum'),
        cost: { keystoreFee: '0.0018', relayFeeEstimate: '0.0006', total: '0.0024', nativeSymbol: eth, firstAction: true },
        balance: lowOnEthereum ? '0.0010' : FUNDED.ethereum.native,
        sufficient: !lowOnEthereum,
        // Sepolia activates in three stages; the other networks in one.
        approvals: mode === 'testnet' ? 3 : 1
      }
    }
  }
}

export function sessionFor(mode: Mode, key: NetworkKey, now: number, status: Session['status'] = 'active'): Session {
  const base = baseOf(mode, key)
  const keyId = fakeHex(`session-${mode}-${key}`, 64)
  return {
    status,
    keyId,
    expiry: Math.floor((status === 'expired' ? now - 2 * DAY : now + 29 * DAY + 20 * HOUR) / 1000),
    scopeText: scopeFor(mode, key),
    keystoreKeyUrl: `${base.keystoreUrl}/key/${keyId}`,
    grantTxUrl: `${base.explorerUrl}/tx/${fakeHex(`grant-${mode}-${key}`, 64)}`,
    revokeTxUrl: status === 'revoked' ? `${base.explorerUrl}/tx/${fakeHex(`revoke-${mode}-${key}`, 64)}` : null
  }
}

export function positionFor(key: NetworkKey, now: number, inRange = true): Position {
  if (key === 'bnb') {
    return {
      tokenId: '48213',
      pair: 'WBNB/USDT',
      feePct: '0.05',
      inRange,
      priceLower: '585.20',
      priceUpper: '642.80',
      priceCurrent: inRange ? '611.47' : '655.10',
      priceUnit: 'USDT per WBNB',
      amounts: inRange
        ? [{ symbol: 'WBNB', amount: '0.2145' }, { symbol: 'USDT', amount: '118.62' }]
        : [{ symbol: 'WBNB', amount: '0' }, { symbol: 'USDT', amount: '249.83' }],
      unclaimedFees: [{ symbol: 'WBNB', amount: '0.00031' }, { symbol: 'USDT', amount: '0.1874' }],
      mintedAt: iso(now - 2 * DAY - 3 * HOUR)
    }
  }
  return {
    tokenId: '190442',
    pair: 'WETH/USDC',
    feePct: '0.05',
    inRange,
    priceLower: '3120.00',
    priceUpper: '3480.00',
    priceCurrent: inRange ? '3304.18' : '3066.40',
    priceUnit: 'USDC per WETH',
    amounts: inRange
      ? [{ symbol: 'WETH', amount: '0.0152' }, { symbol: 'USDC', amount: '48.91' }]
      : [{ symbol: 'WETH', amount: '0.0311' }, { symbol: 'USDC', amount: '0' }],
    unclaimedFees: [{ symbol: 'WETH', amount: '0.000004' }, { symbol: 'USDC', amount: '0.0127' }],
    mintedAt: iso(now - 26 * HOUR)
  }
}

function job(now: number, patch: Partial<Job> & Pick<Job, 'kind' | 'status'>): Job {
  return {
    id: 'job-41c2',
    step: '',
    passkeyUrl: null,
    passkeyPrompt: null,
    result: null,
    error: null,
    startedAt: iso(now - 20000),
    finishedAt: patch.status === 'done' || patch.status === 'error' ? iso(now - 3000) : null,
    ...patch
  }
}

interface StateOptions {
  mode?: Mode
  wallet?: boolean
  bnb?: NetworkPatch
  ethereum?: NetworkPatch
  job?: Job | null
  draft?: Draft | null
  others?: string[]
}

function state(now: number, opts: StateOptions = {}): WalletState {
  const mode = opts.mode ?? 'testnet'
  const wallet = opts.wallet ?? true
  return {
    mode,
    wallet: wallet ? { address: WALLET } : null,
    networks: [network(mode, 'bnb', now, wallet, opts.bnb), network(mode, 'ethereum', now, wallet, opts.ethereum)],
    job: opts.job ?? null,
    preset: presetFor(mode),
    draft: opts.draft ?? null,
    otherWallets: (opts.others ?? []).map(address => ({ address, setAsideAt: iso(now - 3 * MINUTE) }))
  }
}

export interface Fixture {
  id: string
  title: string
  /** One of the eleven states the pane has to handle, as opposed to an extra. */
  core: boolean
  /** Builds the state for the given clock. */
  state?: (now: number) => WalletState
  /** Makes every /state call reject the way ctx.rest does, with `<status>: <body>`. */
  reject?: string
  /** /state never answers. */
  hang?: boolean
  /** The first /state answers, later ones reject with this. */
  rejectAfterFirst?: string
}

const activeBoth = (now: number, mode: Mode = 'testnet') => ({
  bnb: { balances: FUNDED.bnb, session: sessionFor(mode, 'bnb', now) },
  ethereum: { balances: FUNDED.ethereum, session: sessionFor(mode, 'ethereum', now) }
})

export const FIXTURES: Fixture[] = [
  {
    id: 'no-wallet',
    title: 'No wallet',
    core: true,
    state: now => state(now, { wallet: false })
  },
  {
    id: 'no-wallet-earlier',
    title: 'No wallet, one set aside',
    core: false,
    state: now => state(now, { wallet: false, others: [fakeHex('earlier', 40)] })
  },
  {
    id: 'unfunded',
    title: 'Wallet, unfunded',
    core: true,
    state: now => state(now, { bnb: { balances: EMPTY.bnb }, ethereum: { balances: EMPTY.ethereum } })
  },
  {
    id: 'funded',
    title: 'Funded, no session',
    core: true,
    state: now => state(now, { bnb: { balances: FUNDED.bnb }, ethereum: { balances: FUNDED.ethereum } })
  },
  {
    id: 'draft',
    title: 'Draft ready with cost',
    core: true,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb },
        ethereum: { balances: FUNDED.ethereum },
        draft: draftFor('testnet', now)
      })
  },
  {
    id: 'job-waiting',
    title: 'Job waiting for passkey',
    core: true,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb },
        ethereum: { balances: FUNDED.ethereum },
        draft: draftFor('testnet', now),
        job: job(now, {
          kind: 'activate',
          status: 'waiting_passkey',
          step: 'Waiting for the passkey (1 of 2)',
          passkeyUrl: 'http://localhost:8765/approve/job-41c2',
          passkeyPrompt: 'Grant the agent a session key on BNB Chain testnet: V3 LP, 30 days.'
        })
      })
  },
  {
    id: 'job-done',
    title: 'Job done with links',
    core: true,
    state: now =>
      state(now, {
        ...activeBoth(now),
        draft: draftFor('testnet', now),
        job: job(now, {
          kind: 'activate',
          status: 'done',
          step: 'Done',
          result: {
            legs: [
              {
                network: 'bnb',
                status: 'confirmed',
                txUrl: `${baseOf('testnet', 'bnb').explorerUrl}/tx/${fakeHex('grant-testnet-bnb', 64)}`,
                keystoreKeyUrl: sessionFor('testnet', 'bnb', now).keystoreKeyUrl,
                charged: '0.0015',
                nativeSymbol: 'tBNB',
                error: null
              },
              {
                network: 'ethereum',
                status: 'confirmed',
                txUrl: `${baseOf('testnet', 'ethereum').explorerUrl}/tx/${fakeHex('grant-testnet-ethereum', 64)}`,
                keystoreKeyUrl: sessionFor('testnet', 'ethereum', now).keystoreKeyUrl,
                charged: '0.0022',
                nativeSymbol: 'SepoliaETH',
                error: null
              }
            ]
          }
        })
      })
  },
  {
    id: 'active-in-range',
    title: 'Active session, position in range',
    core: true,
    state: now => {
      const live = activeBoth(now)
      return state(now, {
        bnb: { ...live.bnb, positions: [positionFor('bnb', now)] },
        ethereum: live.ethereum,
        draft: draftFor('testnet', now)
      })
    }
  },
  {
    id: 'out-of-range',
    title: 'Position out of range',
    core: true,
    state: now => {
      const live = activeBoth(now)
      return state(now, {
        bnb: { ...live.bnb, positions: [positionFor('bnb', now, false)] },
        ethereum: { ...live.ethereum, positions: [positionFor('ethereum', now, false)] },
        draft: draftFor('testnet', now)
      })
    }
  },
  {
    id: 'revoked',
    title: 'Revoked session',
    core: true,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb, session: sessionFor('testnet', 'bnb', now, 'revoked'), positions: [positionFor('bnb', now)] },
        ethereum: { balances: FUNDED.ethereum, session: sessionFor('testnet', 'ethereum', now) }
      })
  },
  {
    id: 'network-error',
    title: 'Network read error',
    core: true,
    state: now => {
      const live = activeBoth(now)
      return state(now, {
        bnb: { ...live.bnb, positions: [positionFor('bnb', now)] },
        ethereum: {
          ...live.ethereum,
          asOf: iso(now - 7 * MINUTE),
          error: 'Sepolia did not answer: the RPC request timed out after 10 seconds.'
        }
      })
    }
  },
  {
    id: 'mainnet',
    title: 'Mainnet mode',
    core: true,
    state: now =>
      state(now, {
        mode: 'mainnet',
        bnb: {
          balances: { native: '0.4120', tokens: [{ symbol: 'USDT', amount: '1250.00' }, { symbol: 'WBNB', amount: '0' }] },
          session: sessionFor('mainnet', 'bnb', now),
          positions: [positionFor('bnb', now)]
        },
        ethereum: { balances: { native: '0.0350', tokens: [{ symbol: 'USDC', amount: '0' }, { symbol: 'WETH', amount: '0' }] } }
      })
  },

  // Extras: states between and around the eleven above.
  { id: 'loading', title: 'First load', core: false, hang: true },
  {
    id: 'backend-missing',
    title: 'Backend not mounted (404)',
    core: false,
    reject: '404: {"detail":"Not Found"}'
  },
  {
    id: 'forbidden',
    title: 'Not the local Desktop (403)',
    core: false,
    reject: '403: {"detail":"Forbidden"}'
  },
  {
    id: 'refresh-failed',
    title: 'Refresh failing after a good load',
    core: false,
    state: now => state(now, { bnb: { balances: FUNDED.bnb }, ethereum: { balances: FUNDED.ethereum } }),
    rejectAfterFirst: 'Timed out connecting to Hermes backend after 25000ms'
  },
  {
    id: 'job-running',
    title: 'Job running',
    core: false,
    state: now =>
      state(now, {
        wallet: false,
        job: job(now, { kind: 'create', status: 'running', step: 'Deploying the wallet on BNB Chain testnet' })
      })
  },
  {
    id: 'job-created',
    title: 'Job done: wallet created',
    core: false,
    state: now =>
      state(now, {
        bnb: { balances: EMPTY.bnb },
        ethereum: { balances: EMPTY.ethereum },
        job: job(now, { kind: 'create', status: 'done', step: 'Done', result: { address: WALLET } })
      })
  },
  {
    id: 'job-error',
    title: 'Job failed',
    core: false,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb },
        ethereum: { balances: FUNDED.ethereum },
        job: job(now, {
          kind: 'withdraw',
          status: 'error',
          step: 'Failed',
          error: { code: 'passkey_rejected', message: 'The passkey prompt was closed before it was approved.' }
        })
      })
  },
  {
    id: 'job-partial',
    title: 'Job done: one network failed',
    core: false,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb, session: sessionFor('testnet', 'bnb', now) },
        ethereum: { balances: FUNDED.ethereum },
        draft: draftFor('testnet', now),
        job: job(now, {
          kind: 'activate',
          status: 'done',
          step: 'Done',
          result: {
            legs: [
              {
                network: 'bnb',
                status: 'confirmed',
                txUrl: `${baseOf('testnet', 'bnb').explorerUrl}/tx/${fakeHex('grant-testnet-bnb', 64)}`,
                keystoreKeyUrl: sessionFor('testnet', 'bnb', now).keystoreKeyUrl,
                charged: '0.0015',
                nativeSymbol: 'tBNB',
                error: null
              },
              {
                network: 'ethereum',
                status: 'failed',
                txUrl: null,
                keystoreKeyUrl: null,
                charged: null,
                nativeSymbol: 'SepoliaETH',
                error: 'The relay rejected the transaction: fee above the estimate.'
              }
            ]
          }
        })
      })
  },
  {
    id: 'draft-low-balance',
    title: 'Draft, balance too low on one network',
    core: false,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb },
        ethereum: { balances: { native: '0.0010', tokens: [{ symbol: 'USDC', amount: '0' }, { symbol: 'WETH', amount: '0' }] } },
        draft: draftFor('testnet', now, true)
      })
  },
  {
    id: 'expired',
    title: 'Expired session',
    core: false,
    state: now =>
      state(now, {
        bnb: { balances: FUNDED.bnb, session: sessionFor('testnet', 'bnb', now, 'expired'), positions: [positionFor('bnb', now)] },
        ethereum: { balances: FUNDED.ethereum }
      })
  }
]

export const fixtureById = (id: string | null): Fixture => FIXTURES.find(f => f.id === id) ?? (FIXTURES[0] as Fixture)

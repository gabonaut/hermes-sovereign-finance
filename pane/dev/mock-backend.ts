// A pretend backend for the harness: serves a fixture state from `rest`, and plays admin jobs through
// running, waiting for the passkey, and done, so the pane can be clicked through without Hermes.

import type { PluginRestOptions } from '@hermes/plugin-sdk'

import type { Draft, GrantRequest, Job, JobResult, Mode, NetworkKey, WalletState } from '../src/types'
import { baseOf, draftFor, fakeHex, type Fixture, presetFor, sessionFor, WALLET } from './fixtures'

interface Phase {
  status: 'running' | 'waiting_passkey'
  step: string
  prompt?: string
  ms?: number
}

export interface MockBackend {
  rest: <T>(path: string, opts?: PluginRestOptions) => Promise<T>
  /** Approves or rejects the passkey prompt, as the browser tab would. */
  approve: () => void
  reject: () => void
  /** True while a job waits for the passkey. */
  waiting: () => boolean
  /** How many times /state has been asked for. */
  stateCalls: () => number
  subscribe: (fn: () => void) => () => void
  dispose: () => void
}

interface Options {
  fixture: Fixture
  now: () => number
  /** Milliseconds every call takes. */
  latency: number
  log: (line: string) => void
}

const ok = (data: unknown) => ({ ok: true, data })
const fail = (code: string, message: string) => ({ ok: false, error: { code, message } })
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createMockBackend({ fixture, now, latency, log }: Options): MockBackend {
  let state: WalletState | null = fixture.state ? fixture.state(now()) : null
  let stateCalls = 0
  let jobCount = 0
  let passkeyCount = 0
  let phases: Phase[] = []
  let finish: (() => JobResult) | null = null
  let timer: number | null = null
  let disposed = false
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach(fn => fn())

  const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))
  const nameOf = (key: NetworkKey) => state?.networks.find(n => n.key === key)?.name ?? key

  const advance = () => {
    if (disposed || !state?.job) return
    const next = phases.shift()
    if (!next) {
      state.job = { ...state.job, status: 'done', step: 'Done', passkeyUrl: null, passkeyPrompt: null, result: finish?.() ?? null, finishedAt: new Date(now()).toISOString() }
      finish = null
      changed()
      return
    }
    const waiting = next.status === 'waiting_passkey'
    if (waiting) passkeyCount += 1
    state.job = {
      ...state.job,
      status: next.status,
      step: next.step,
      passkeyUrl: waiting ? `http://localhost:8765/approve/${state.job.id}/${passkeyCount}` : null,
      passkeyPrompt: waiting ? (next.prompt ?? null) : null
    }
    changed()
    if (!waiting) timer = window.setTimeout(advance, next.ms ?? 1200)
  }

  const start = (kind: Job['kind'], plan: Phase[], done: () => JobResult): string => {
    if (!state) throw new Error('no state')
    jobCount += 1
    const id = `job-${jobCount.toString(16).padStart(4, '0')}`
    state.job = {
      id,
      kind,
      status: 'running',
      step: 'Starting',
      passkeyUrl: null,
      passkeyPrompt: null,
      result: null,
      error: null,
      startedAt: new Date(now()).toISOString(),
      finishedAt: null
    }
    phases = plan
    finish = done
    timer = window.setTimeout(advance, 500)
    changed()
    return id
  }

  const stop = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    phases = []
    finish = null
  }

  const busy = () => state?.job != null && (state.job.status === 'running' || state.job.status === 'waiting_passkey')

  const compileDraft = (mode: Mode, request: GrantRequest): Draft => {
    const draft = draftFor(mode, now())
    const days = request.durationDays
    draft.id = `draft-${fakeHex(JSON.stringify(request), 6).slice(2)}`
    draft.createdAt = new Date(now()).toISOString()
    draft.durationDays = days
    draft.expiry = Math.floor(now() / 1000) + days * 86400
    for (const key of Object.keys(draft.networks) as NetworkKey[]) {
      const asked = request.networks[key]
      const part = draft.networks[key]
      if (!asked || !part) {
        delete draft.networks[key]
        continue
      }
      const base = baseOf(mode, key)
      part.scopeText = [
        `Swap, add and remove liquidity on ${base.dex}`,
        `Up to ${asked.nativeCap} ${base.nativeSymbol} per day, relay fees included`,
        ...asked.tokens.map(t => `Up to ${t.cap} ${t.symbol} per day`),
        `Ends after ${days} ${days === 1 ? 'day' : 'days'}`
      ]
      const balance = state?.networks.find(n => n.key === key)?.balances?.native ?? '0'
      part.balance = balance
      part.sufficient = Number(balance) >= Number(part.cost.total)
    }
    return draft
  }

  const handle = (path: string, body: Record<string, unknown>): unknown => {
    if (!state) return fail('unavailable', 'This fixture has no state to act on.')
    const s = state

    switch (path) {
      case '/mode': {
        const mode: Mode = body.mode === 'mainnet' ? 'mainnet' : 'testnet'
        stop()
        state = {
          ...s,
          mode,
          job: null,
          draft: null,
          preset: presetFor(mode),
          networks: s.networks.map(n => {
            const base = baseOf(mode, n.key)
            return {
              ...n,
              chainId: base.chainId,
              name: base.name,
              shortName: base.shortName,
              nativeSymbol: base.nativeSymbol,
              dex: base.dex,
              explorerUrl: base.explorerUrl,
              addressUrl: s.wallet ? `${base.explorerUrl}/address/${WALLET}` : null,
              keystoreAccountUrl: s.wallet ? `${base.keystoreUrl}/account/${WALLET}` : null,
              balances: n.balances ? { ...n.balances, native: mode === 'mainnet' ? '0.0420' : n.balances.native } : null,
              session: null,
              positions: []
            }
          })
        }
        return ok({})
      }

      case '/create':
      case '/recover': {
        if (busy()) return fail('job_active', 'Another approval is still open.')
        const kind = path === '/create' ? 'create' : 'recover'
        const jobId = start(
          kind,
          [
            { status: 'running', step: 'Opening the passkey page', ms: 700 },
            {
              status: 'waiting_passkey',
              step: 'Waiting for the passkey',
              prompt: kind === 'create' ? 'Create a wallet with this passkey as its admin key.' : 'Find the wallet this passkey controls.'
            },
            { status: 'running', step: `Setting up the wallet on ${nameOf('bnb')}`, ms: 1400 },
            { status: 'running', step: `Setting up the wallet on ${nameOf('ethereum')}`, ms: 1400 }
          ],
          () => {
            s.wallet = { address: WALLET }
            for (const n of s.networks) {
              const base = baseOf(s.mode, n.key)
              n.addressUrl = `${base.explorerUrl}/address/${WALLET}`
              n.keystoreAccountUrl = `${base.keystoreUrl}/account/${WALLET}`
              n.asOf = new Date(now()).toISOString()
              n.balances = { native: '0', tokens: [] }
            }
            return { address: WALLET }
          }
        )
        return ok({ jobId })
      }

      case '/grant': {
        const draft = compileDraft(s.mode, body as unknown as GrantRequest)
        s.draft = draft
        return ok({ draft })
      }

      case '/activate': {
        if (busy()) return fail('job_active', 'Another approval is still open.')
        const draft = s.draft
        if (!draft || draft.id !== body.draftId) return fail('draft_stale', 'Review the permissions again before activating.')
        const keys = (Array.isArray(body.networks) ? body.networks : []) as NetworkKey[]
        const plan: Phase[] = []
        keys.forEach((key, i) => {
          plan.push({
            status: 'waiting_passkey',
            step: `Waiting for the passkey (${i + 1} of ${keys.length})`,
            prompt: `Grant the agent a session key on ${nameOf(key)}: ${s.preset.title}, ${draft.durationDays} days.`
          })
          plan.push({ status: 'running', step: `Registering the session key on ${nameOf(key)}`, ms: 1600 })
        })
        const jobId = start('activate', plan, () => ({
          legs: keys.map(key => {
            const session = sessionFor(s.mode, key, now())
            session.scopeText = draft.networks[key]?.scopeText ?? session.scopeText
            session.expiry = draft.expiry
            const target = s.networks.find(n => n.key === key)
            if (target) target.session = session
            return {
              network: key,
              status: 'confirmed',
              txUrl: session.grantTxUrl,
              keystoreKeyUrl: session.keystoreKeyUrl,
              charged: draft.networks[key]?.cost.total ?? null,
              nativeSymbol: baseOf(s.mode, key).nativeSymbol,
              error: null
            }
          })
        }))
        return ok({ jobId })
      }

      case '/revoke': {
        if (busy()) return fail('job_active', 'Another approval is still open.')
        const key = body.network as NetworkKey
        const target = s.networks.find(n => n.key === key)
        if (!target?.session) return fail('no_session', 'There is no session on that network.')
        const jobId = start(
          'revoke',
          [
            { status: 'waiting_passkey', step: 'Waiting for the passkey', prompt: `Revoke the agent's session key on ${target.name}.` },
            { status: 'running', step: `Revoking on ${target.name}`, ms: 1500 }
          ],
          () => {
            const revoked = sessionFor(s.mode, key, now(), 'revoked')
            target.session = { ...revoked, scopeText: target.session?.scopeText ?? revoked.scopeText }
            return { network: key, txUrl: revoked.revokeTxUrl }
          }
        )
        return ok({ jobId })
      }

      case '/withdraw': {
        if (busy()) return fail('job_active', 'Another approval is still open.')
        const key = body.network as NetworkKey
        const target = s.networks.find(n => n.key === key)
        if (!target?.balances) return fail('no_balance', 'That network has no balance to send.')
        const asset = String(body.asset)
        const amount = String(body.amount)
        const to = String(body.to)
        const jobId = start(
          'withdraw',
          [
            {
              status: 'waiting_passkey',
              step: 'Waiting for the passkey',
              prompt: `Send ${amount} ${asset} to ${to.slice(0, 8)}...${to.slice(-6)} on ${target.name}.`
            },
            { status: 'running', step: `Sending on ${target.name}`, ms: 1500 }
          ],
          () => {
            const balances = target.balances
            if (balances) {
              if (asset === target.nativeSymbol) balances.native = Math.max(0, Number(balances.native) - Number(amount)).toFixed(4)
              else {
                const token = balances.tokens.find(t => t.symbol === asset)
                if (token) token.amount = Math.max(0, Number(token.amount) - Number(amount)).toFixed(2)
              }
            }
            return { network: key, txUrl: `${baseOf(s.mode, key).explorerUrl}/tx/${fakeHex(`withdraw-${jobCount}`, 64)}` }
          }
        )
        return ok({ jobId })
      }

      case '/job/dismiss':
      case '/job/cancel':
        stop()
        s.job = null
        return ok({})

      default:
        return null
    }
  }

  return {
    rest: async <T>(path: string, opts: PluginRestOptions = {}): Promise<T> => {
      const method = opts.method ?? 'GET'
      if (path !== '/state') log(`${method} ${path} ${opts.body === undefined ? '' : JSON.stringify(opts.body)}`.trim())
      if (latency > 0) await wait(latency)

      if (path === '/state' && method === 'GET') {
        stateCalls += 1
        if (fixture.hang) return new Promise<T>(() => undefined)
        if (fixture.reject) throw new Error(fixture.reject)
        if (fixture.rejectAfterFirst && stateCalls > 1) throw new Error(fixture.rejectAfterFirst)
        return ok(clone(state)) as T
      }

      const answer = method === 'POST' ? handle(path, (opts.body ?? {}) as Record<string, unknown>) : null
      if (answer === null) throw new Error('404: {"detail":"Not Found"}')
      changed()
      return clone(answer) as T
    },
    approve: () => {
      if (state?.job?.status === 'waiting_passkey') advance()
    },
    reject: () => {
      if (state?.job?.status !== 'waiting_passkey') return
      stop()
      state.job = {
        ...state.job,
        status: 'error',
        step: 'Failed',
        passkeyUrl: null,
        passkeyPrompt: null,
        error: { code: 'passkey_rejected', message: 'The passkey prompt was closed before it was approved.' },
        finishedAt: new Date(now()).toISOString()
      }
      changed()
    },
    waiting: () => state?.job?.status === 'waiting_passkey',
    stateCalls: () => stateCalls,
    subscribe: fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    dispose: () => {
      disposed = true
      stop()
      listeners.clear()
    }
  }
}

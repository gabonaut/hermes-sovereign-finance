// One store per plugin load. It owns the /state poll, the passkey auto-open bookkeeping and the bits
// of UI memory that should outlive a pane remount (tab switches keep the pane mounted, a reload does
// not). React reads it through useSyncExternalStore.

import { host, type PluginContext } from '@hermes/plugin-sdk'

import { type Api, ApiError, createApi, SLOW_TIMEOUT_MS, toApiError } from './api'
import { isLoopbackUrl, isWebUrl } from './format'
import { normalizeState } from './normalize'
import type { Job, WalletState } from './types'

export const PLUGIN_ID = 'sovereign-finance'
export const PANE_ID = 'main'

const FAST_POLL_MS = 2000
const SLOW_POLL_MS = 10000
const OPENED_STORAGE_KEY = 'openedPasskeyPages'
const OPENED_KEEP_MS = 3_600_000
const OPENED_KEEP_COUNT = 16

export interface Snapshot {
  /** The last good state. Null until the first /state answers. */
  state: WalletState | null
  /** Why the latest /state failed. Cleared by the next good answer. */
  error: ApiError | null
  /** True until the first answer, good or bad. */
  loading: boolean
  /** Set to the job's passkey key when the browser could not be opened for it. */
  passkeyOpenFailed: string | null
}

export interface Store {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Snapshot
  /** Called by the mounted pane. `probe` says whether its root is really on screen. */
  attach: (probe: () => boolean) => () => void
  /** Fetches /state now. Never rejects: a failure lands in the snapshot. */
  refresh: () => Promise<void>
  /** POSTs, then resolves once a /state newer than the action has arrived. */
  post: (path: string, body: object, timeoutMs?: number) => Promise<unknown>
  /** Opens an http or https URL in the system browser. Resolves false when it could not. */
  open: (url: string | null | undefined) => Promise<boolean>
  /** Opens the passkey page of the current job again. */
  reopenPasskey: () => Promise<boolean>
  /** Plain values that survive a pane remount, keyed by the caller. */
  memory: Map<string, unknown>
}

/** A running or waiting job blocks every other admin action. */
export function jobIsActive(job: Job | null | undefined): boolean {
  return job != null && (job.status === 'running' || job.status === 'waiting_passkey')
}

export function passkeyKey(job: Job): string {
  return `${job.id}\n${job.passkeyUrl ?? ''}`
}

interface OpenedEntry {
  k: string
  t: number
}

export function createStore(ctx: PluginContext): Store {
  const api: Api = createApi(ctx)
  const listeners = new Set<() => void>()
  const probes = new Set<() => boolean>()
  const memory = new Map<string, unknown>()

  let snapshot: Snapshot = { state: null, error: null, loading: true, passkeyOpenFailed: null }
  let lastJson = ''
  let inflight: Promise<void> | null = null
  let epoch = 0
  let lastStart = 0
  let pollMs = 0
  let stopPoll: (() => void) | null = null

  const set = (patch: Partial<Snapshot>) => {
    let changed = false
    for (const key of Object.keys(patch) as (keyof Snapshot)[]) {
      if (snapshot[key] !== patch[key]) changed = true
    }
    if (!changed) return
    snapshot = { ...snapshot, ...patch }
    listeners.forEach(listener => listener())
  }

  // --- Visibility: poll only while the pane is on screen ---

  const documentVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  // The host's visibility signal only prompts a refresh. It never stops one: a host that reports a
  // visible pane as hidden would otherwise leave it empty. The DOM probe decides what is on screen.
  const isActive = () => probes.size > 0 && documentVisible()

  /** The pane stays mounted behind another tab, so also ask the DOM before each request. */
  const onScreen = () => {
    for (const probe of probes) {
      try {
        if (probe()) return true
      } catch {
        return true
      }
    }
    return false
  }

  // --- Passkey page: opened once per job id and URL ---

  const readOpened = (): OpenedEntry[] => {
    const cutoff = Date.now() - OPENED_KEEP_MS
    try {
      const stored = ctx.storage.get<unknown>(OPENED_STORAGE_KEY, [])
      if (!Array.isArray(stored)) return []
      return stored.filter(
        (e): e is OpenedEntry =>
          e !== null && typeof e === 'object' && typeof e.k === 'string' && typeof e.t === 'number' && e.t > cutoff
      )
    } catch {
      return []
    }
  }

  const openedThisLoad = new Set<string>()

  const wasOpened = (key: string) => openedThisLoad.has(key) || readOpened().some(e => e.k === key)

  const rememberOpened = (key: string) => {
    openedThisLoad.add(key)
    try {
      const next = [...readOpened().filter(e => e.k !== key), { k: key, t: Date.now() }]
      ctx.storage.set(OPENED_STORAGE_KEY, next.slice(-OPENED_KEEP_COUNT))
    } catch {
      // Storage is a convenience here: without it the page may open once more after a reload.
    }
  }

  const open: Store['open'] = async url => {
    if (!isWebUrl(url)) return false
    try {
      return (await ctx.os.openExternal(url)) !== false
    } catch {
      return false
    }
  }

  const openPasskeyFor = async (job: Job): Promise<boolean> => {
    const key = passkeyKey(job)
    const ok = await open(job.passkeyUrl)
    const current = snapshot.state?.job
    if (current && passkeyKey(current) === key) set({ passkeyOpenFailed: ok ? null : key })
    return ok
  }

  const maybeOpenPasskey = () => {
    const job = snapshot.state?.job
    if (!job || job.status !== 'waiting_passkey' || !job.passkeyUrl) {
      if (snapshot.passkeyOpenFailed !== null) set({ passkeyOpenFailed: null })
      return
    }
    if (!isActive()) return
    const key = passkeyKey(job)
    // Anything but a loopback page waits for the user to press the button.
    if (wasOpened(key) || !isLoopbackUrl(job.passkeyUrl)) return
    rememberOpened(key)
    void openPasskeyFor(job)
  }

  // --- /state ---

  const syncPolling = () => {
    const want = isActive() ? (jobIsActive(snapshot.state?.job) ? FAST_POLL_MS : SLOW_POLL_MS) : 0
    if (want === pollMs) return
    stopPoll?.()
    stopPoll = null
    pollMs = want
    if (want > 0) {
      stopPoll = ctx.setInterval(() => {
        // Until the first state arrives the pane asks regardless, so it can never stay on its placeholder.
        if (isActive() && (snapshot.state === null || onScreen())) void refresh()
      }, want)
    }
  }

  const refresh = (): Promise<void> => {
    if (inflight) return inflight
    const startedIn = epoch
    lastStart = Date.now()
    const run = (async () => {
      try {
        const data = await api.get('/state', SLOW_TIMEOUT_MS)
        if (startedIn !== epoch) return
        const state = normalizeState(data)
        if (!state) throw new ApiError('bad_response', 'The backend sent a state the pane cannot read.')
        const json = JSON.stringify(state)
        const unchanged = json === lastJson && snapshot.state !== null
        lastJson = json
        set({ state: unchanged ? snapshot.state : state, error: null, loading: false })
      } catch (err) {
        if (startedIn !== epoch) return
        set({ error: toApiError(err), loading: false })
      }
    })()
    inflight = run.finally(() => {
      inflight = null
      // An action finished while this request was in the air: its answer may predate the action.
      if (startedIn !== epoch) {
        void refresh()
        return
      }
      maybeOpenPasskey()
      syncPolling()
    })
    return inflight
  }

  /** Resolves after a /state that started later than now. */
  const fresh = async (): Promise<void> => {
    epoch += 1
    if (inflight) await inflight
    await (inflight ?? refresh())
  }

  const post: Store['post'] = async (path, body, timeoutMs) => {
    let result: unknown
    try {
      result = await api.post(path, body, timeoutMs)
    } catch (err) {
      void fresh()
      throw err
    }
    await fresh()
    return result
  }

  const onActivityChange = () => {
    syncPolling()
    if (!isActive()) return
    if (Date.now() - lastStart > 1000) void refresh()
    else maybeOpenPasskey()
  }

  try {
    const visibility = typeof host.paneVisibility === 'function' ? host.paneVisibility(`${PLUGIN_ID}:${PANE_ID}`) : null
    if (visibility) {
      ctx.onDispose(visibility.listen(() => onActivityChange()))
    }
  } catch {
    // Older desktops: the DOM probe in the poll tick covers a pane hidden behind another tab.
  }

  if (typeof document !== 'undefined') ctx.addEventListener(document, 'visibilitychange', onActivityChange)

  ctx.onDispose(() => {
    stopPoll?.()
    stopPoll = null
    pollMs = 0
    probes.clear()
    listeners.clear()
  })

  return {
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    attach: probe => {
      probes.add(probe)
      onActivityChange()
      return () => {
        probes.delete(probe)
        syncPolling()
      }
    },
    refresh,
    post,
    open,
    reopenPasskey: async () => {
      const job = snapshot.state?.job
      if (!job || !job.passkeyUrl) return false
      rememberOpened(passkeyKey(job))
      return openPasskeyFor(job)
    },
    memory
  }
}

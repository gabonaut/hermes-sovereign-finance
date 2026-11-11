import { Button, ErrorState, type PluginContext, Skeleton } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { isPositive, parseTime } from './format'
import { Header } from './header'
import { JobBanner } from './job-banner'
import { LiveSection } from './live'
import { ActivateStep, activateSummary, PermissionsStep, permissionsSummary } from './permissions'
import { fundSummary, FundStep, Step, type StepStatus, WalletStep, walletSummary } from './steps'
import { jobIsActive, type Store } from './store'
import { PANE_CSS } from './styles'
import type { Draft, Mode, WalletState } from './types'
import { PaneContext, type PaneEnv, useAction, useRemembered, Warning } from './ui'
import { WithdrawDialog } from './withdraw'

const CLOCK_MS = 30000

/** The newer of the draft in /state and the one the last /grant answered with. */
function pickDraft(fromState: Draft | null, fromGrant: Draft | null): Draft | null {
  if (!fromGrant) return fromState
  if (!fromState) return fromGrant
  if (fromState.id === fromGrant.id) return fromState
  const a = parseTime(fromState.createdAt)
  const b = parseTime(fromGrant.createdAt)
  return a !== null && b !== null && b > a ? fromGrant : fromState
}

function LoadingBody() {
  return (
    <div aria-busy="true" aria-label="Loading the wallet" className="sf-loading" role="status">
      {[168, 96, 132, 104].map((width, i) => (
        <div className="sf-loading-row" key={i}>
          <Skeleton style={{ width: 20, height: 20 }} />
          <Skeleton style={{ width, height: 14 }} />
        </div>
      ))}
    </div>
  )
}

function FailedBody({ title, message, onRetry }: { title: string; message: string; onRetry: () => Promise<void> }) {
  const retry = useAction()
  return (
    <div className="sf-failed">
      <ErrorState description={message} title={title}>
        <div className="sf-failed-actions">
          <Button loading={retry.busy} onClick={() => void retry.run(onRetry)} size="sm" type="button" variant="outline">
            Try again
          </Button>
        </div>
      </ErrorState>
    </div>
  )
}

interface StepsProps {
  state: WalletState
  draft: Draft | null
  onDraft: (draft: Draft | null) => void
  onWithdraw: () => void
}

function Steps({ state, draft, onDraft, onWithdraw }: StepsProps) {
  const { wallet, networks, preset, mode } = state
  const address = wallet?.address ?? null
  const anyActive = networks.some(n => n.session?.status === 'active')
  const funded = networks.some(n => n.balances !== null && isPositive(n.balances.native))

  const done = [address !== null, address !== null && funded, address !== null && (draft !== null || anyActive), anyActive]
  const blocked = [
    undefined,
    address === null ? 'Needs a wallet' : undefined,
    address === null ? 'Needs a wallet' : undefined,
    address === null
      ? 'Needs a wallet'
      : draft === null
        ? (anyActive && activateSummary(networks)) || 'Needs reviewed permissions'
        : undefined
  ]
  const current = done.findIndex((isDone, i) => !isDone && !blocked[i])
  const statusOf = (i: number): StepStatus => (done[i] ? 'done' : blocked[i] ? 'locked' : i === current ? 'current' : 'todo')

  // Setup shows every step that has something to do. Once a session is live, steps 3 and 4 fold away.
  const defaults = [true, address !== null, address !== null && !anyActive, draft !== null && !anyActive]
  const [toggled, setToggled] = useRemembered<Record<number, boolean>>(
    `open:${mode}:${address ?? ''}:${anyActive ? 'live' : 'setup'}`,
    () => ({})
  )
  const isOpen = (i: number) => toggled[i] ?? defaults[i] ?? false
  const toggle = (i: number) => () => setToggled(prev => ({ ...prev, [i]: !(prev[i] ?? defaults[i] ?? false) }))

  return (
    <ol className="sf-steps">
      <Step n={1} onToggle={toggle(0)} open={isOpen(0)} status={statusOf(0)} summary={walletSummary(address)} title="Create wallet">
        <WalletStep address={address} />
      </Step>
      <Step
        blocked={blocked[1]}
        n={2}
        onToggle={toggle(1)}
        open={isOpen(1)}
        status={statusOf(1)}
        summary={fundSummary(networks)}
        title="Fund"
      >
        {address !== null ? <FundStep address={address} networks={networks} onWithdraw={onWithdraw} /> : null}
      </Step>
      <Step
        blocked={blocked[2]}
        n={3}
        onToggle={toggle(2)}
        open={isOpen(2)}
        status={statusOf(2)}
        summary={permissionsSummary(preset, draft)}
        title="Set permissions"
      >
        <PermissionsStep
          draft={draft}
          key={`${mode}:${preset.id}`}
          onDraft={next => {
            onDraft(next)
            // A fresh review leads straight on to activation, also when the steps were folded away.
            if (next) setToggled(prev => ({ ...prev, 3: true }))
          }}
          state={state}
        />
      </Step>
      <Step
        blocked={blocked[3]}
        n={4}
        onToggle={toggle(3)}
        open={isOpen(3)}
        status={statusOf(3)}
        summary={activateSummary(networks)}
        title="Activate"
      >
        {draft !== null ? <ActivateStep draft={draft} key={draft.id} onActivated={() => onDraft(null)} state={state} /> : null}
      </Step>
    </ol>
  )
}

export function Pane({ ctx, store }: { ctx: PluginContext; store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { state, error, loading } = snapshot
  const rootRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  const [pendingMode, setPendingMode] = useState<Mode | null>(null)
  const [grantDraft, setGrantDraft] = useState<{ mode: Mode; draft: Draft } | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  // Poll while mounted and really on screen: the pane stays mounted behind another tab.
  useEffect(
    () =>
      store.attach(() => {
        const el = rootRef.current
        if (!el || typeof el.checkVisibility !== 'function') return true
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      }),
    [store]
  )

  useEffect(() => ctx.setInterval(() => setNow(Date.now()), CLOCK_MS), [ctx])

  // Relative times are computed against `now`; bring it up to date whenever fresh data lands.
  useEffect(() => setNow(Date.now()), [state])

  const switchMode = useCallback(
    async (mode: Mode) => {
      setPendingMode(mode)
      try {
        await store.post('/mode', { mode })
      } finally {
        setPendingMode(null)
      }
    },
    [store]
  )

  const job = state?.job ?? null
  const locked = jobIsActive(job) || pendingMode !== null
  const env = useMemo<PaneEnv>(() => ({ store, now, locked }), [store, now, locked])
  const draft = state ? pickDraft(state.draft, grantDraft && grantDraft.mode === state.mode ? grantDraft.draft : null) : null
  const mode = state?.mode ?? null
  const onDraft = useCallback(
    (next: Draft | null) => setGrantDraft(next && mode ? { mode, draft: next } : null),
    [mode]
  )

  let body
  if (error?.forbidden) {
    body = <FailedBody message={error.message} onRetry={store.refresh} title="Local Desktop only" />
  } else if (!state) {
    body = loading || !error ? <LoadingBody /> : <FailedBody message={error.message} onRetry={store.refresh} title="Wallet not loaded" />
  } else {
    body = (
      <div className="sf-content" data-busy={jobIsActive(job) || undefined} data-pending={pendingMode !== null || undefined}>
        {error ? <Warning>Not refreshed. {error.message}</Warning> : null}
        <Steps draft={draft} onDraft={onDraft} onWithdraw={() => setWithdrawing(true)} state={state} />
        <LiveSection networks={state.networks} />
      </div>
    )
  }

  return (
    <PaneContext.Provider value={env}>
      <style>{PANE_CSS}</style>
      <div className="sf-root" data-mode={pendingMode ?? mode ?? undefined} ref={rootRef}>
        <Header disabled={jobIsActive(job)} loading={loading} mode={mode} onSwitch={switchMode} pending={pendingMode} />
        {job && !error?.forbidden ? <JobBanner job={job} networks={state?.networks ?? []} openFailed={snapshot.passkeyOpenFailed} /> : null}
        <div className="sf-scroll">{body}</div>
        {state?.wallet ? (
          <WithdrawDialog
            address={state.wallet.address}
            networks={state.networks}
            onClose={() => setWithdrawing(false)}
            open={withdrawing}
          />
        ) : null}
      </div>
    </PaneContext.Provider>
  )
}

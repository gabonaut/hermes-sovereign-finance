import { Badge, Button, Checkbox, ConfirmDialog, Input, SegmentedControl } from '@hermes/plugin-sdk'
import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { SLOW_TIMEOUT_MS } from './api'
import { compareDecimal, formatDate, fractionDigits, isDecimal, isPositive, parseTime, timeAgo } from './format'
import { normalizeDraft } from './normalize'
import type { Draft, DraftNetwork, GrantRequest, NetworkKey, NetworkState, Preset, WalletState } from './types'
import { InlineError, Num, useAction, usePane, useRemembered, Warning } from './ui'

// --- Step 3: the permission form ---

interface FormValues {
  days: string
  /** Native daily cap per network key. */
  caps: Record<string, string>
  /** Token rows keyed by `<network>/<symbol>`. */
  tokens: Record<string, { checked: boolean; cap: string }>
}

const tokenId = (key: string, symbol: string) => `${key}/${symbol}`

function initialForm(preset: Preset, draft: Draft | null): FormValues {
  const form: FormValues = { days: String(draft?.durationDays || preset.durationDays), caps: {}, tokens: {} }
  for (const [key, net] of Object.entries(preset.networks)) {
    if (!net) continue
    form.caps[key] = net.native.cap
    for (const token of net.tokens) form.tokens[tokenId(key, token.symbol)] = { checked: token.checked, cap: token.cap }
  }
  return form
}

/** ".5" and "5." are fine to type; the backend gets "0.5" and "5". */
function tidyDecimal(value: string): string {
  let v = value.trim()
  if (v.startsWith('.')) v = '0' + v
  if (v.endsWith('.')) v = v.slice(0, -1)
  return v
}

function checkForm(form: FormValues, preset: Preset, keys: NetworkKey[]) {
  const errors: Record<string, string> = {}
  const networks: GrantRequest['networks'] = {}
  const days = form.days.trim()

  if (!/^\d+$/.test(days) || Number(days) < 1) errors.days = 'Enter a whole number of days.'

  for (const key of keys) {
    const net = preset.networks[key]
    if (!net) continue
    const cap = form.caps[key] ?? ''
    if (!isDecimal(cap)) errors[`cap:${key}`] = 'Enter an amount.'
    const tokens: { symbol: string; cap: string }[] = []
    for (const token of net.tokens) {
      const id = tokenId(key, token.symbol)
      const field = form.tokens[id]
      if (!field?.checked) continue
      if (!isPositive(field.cap)) errors[`tok:${id}`] = 'Enter an amount above 0, or untick.'
      else if (token.decimals !== null && fractionDigits(field.cap) > token.decimals) {
        errors[`tok:${id}`] = `${token.symbol} has ${token.decimals} decimals.`
      }
      tokens.push({ symbol: token.symbol, cap: tidyDecimal(field.cap) })
    }
    networks[key] = { nativeCap: tidyDecimal(cap), tokens }
  }

  const valid = Object.keys(errors).length === 0
  const request: GrantRequest | null = valid ? { durationDays: Number(days), networks } : null
  return { errors, request }
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className="sf-field-error" id={id} role="alert">
      {children}
    </span>
  )
}

function ScopeLists({ draft, networks }: { draft: Draft; networks: NetworkState[] }) {
  const { now } = usePane()
  const created = parseTime(draft.createdAt)
  const known = networks.filter(n => draft.networks[n.key])

  return (
    <div className="sf-review">
      <div className="sf-review-head">
        <span className="sf-strong">Reviewed permissions</span>
        {created !== null ? <span className="sf-dim">{timeAgo(created, now)}</span> : null}
      </div>
      {known.map(n => (
        <div className="sf-review-net" key={n.key}>
          <div className="sf-review-name">{n.name}</div>
          <ul className="sf-scope">
            {(draft.networks[n.key]?.scopeText ?? []).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
      <div className="sf-dim">
        {draft.durationDays > 0 ? `${draft.durationDays} ${draft.durationDays === 1 ? 'day' : 'days'}` : null}
        {draft.durationDays > 0 && draft.expiry > 0 ? ', ' : null}
        {draft.expiry > 0 ? `until ${formatDate(draft.expiry * 1000)}` : null}
      </div>
    </div>
  )
}

interface PermissionsStepProps {
  state: WalletState
  draft: Draft | null
  /** Hands the draft from the /grant answer to the pane, in case /state does not carry it yet. */
  onDraft: (draft: Draft | null) => void
}

export function PermissionsStep({ state, draft, onDraft }: PermissionsStepProps) {
  const { store, locked } = usePane()
  const { preset, mode } = state
  const uid = useId()
  const keys = [
    ...state.networks.map(n => n.key).filter(key => preset.networks[key]),
    ...(Object.keys(preset.networks) as NetworkKey[]).filter(key => !state.networks.some(n => n.key === key))
  ]
  const [form, setForm] = useRemembered<FormValues>(`form:${mode}:${preset.id}`, () => initialForm(preset, draft))
  const [attempted, setAttempted] = useState(false)
  const review = useAction()
  const reviewedKey = `reviewed:${mode}`
  const { errors, request } = checkForm(form, preset, keys)
  const shownErrors = attempted ? errors : {}
  const reviewed = store.memory.get(reviewedKey)
  const edited = draft !== null && typeof reviewed === 'string' && request !== null && JSON.stringify(request) !== reviewed
  const nameOf = (key: string) => state.networks.find(n => n.key === key)?.name ?? key

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!request || locked || review.busy) return
    void review.run(async () => {
      const data = await store.post('/grant', request, SLOW_TIMEOUT_MS)
      store.memory.set(reviewedKey, JSON.stringify(request))
      onDraft(normalizeDraft((data as { draft?: unknown } | null)?.draft))
    })
  }

  return (
    <form className="sf-form" noValidate onSubmit={submit}>
      <div className="sf-field">
        <span className="sf-label">Preset</span>
        <SegmentedControl onChange={() => undefined} options={[{ id: preset.id, label: preset.title }]} value={preset.id} />
      </div>

      <div className="sf-cols">
        {keys.map(key => {
          const net = preset.networks[key]
          if (!net) return null
          const capId = `${uid}-cap-${key}`
          const capError = shownErrors[`cap:${key}`]
          return (
            <div aria-labelledby={`${capId}-title`} className="sf-col" key={key} role="group">
              <div className="sf-col-title" id={`${capId}-title`}>
                {nameOf(key)}
              </div>
              <div className="sf-cap">
                <label className="sf-label" htmlFor={capId}>
                  Daily cap
                </label>
                <Input
                  aria-describedby={capError ? `${capId}-error` : `${capId}-hint`}
                  aria-invalid={capError ? true : undefined}
                  className="sf-num-input"
                  containerClassName={capError ? 'sf-invalid' : undefined}
                  id={capId}
                  inputMode="decimal"
                  onChange={e => {
                    const value = e.target.value
                    setForm(prev => ({ ...prev, caps: { ...prev.caps, [key]: value } }))
                  }}
                  size="sm"
                  suffix={net.native.symbol}
                  value={form.caps[key] ?? ''}
                />
                {capError ? (
                  <FieldError id={`${capId}-error`}>{capError}</FieldError>
                ) : net.native.feeHeadroom ? (
                  <span className="sf-hint" id={`${capId}-hint`}>
                    includes about {net.native.feeHeadroom} {net.native.symbol} for relay fees
                  </span>
                ) : null}
              </div>
              {net.tokens.map(token => {
                const id = tokenId(key, token.symbol)
                const field = form.tokens[id] ?? { checked: false, cap: token.cap }
                const boxId = `${uid}-box-${id}`
                const inputId = `${uid}-tok-${id}`
                const error = shownErrors[`tok:${id}`]
                const patch = (next: Partial<typeof field>) =>
                  setForm(prev => ({ ...prev, tokens: { ...prev.tokens, [id]: { ...field, ...next } } }))
                return (
                  <div className="sf-token" key={token.symbol}>
                    <Checkbox checked={field.checked} id={boxId} onCheckedChange={checked => patch({ checked: checked === true })} />
                    <label className="sf-token-name" htmlFor={boxId}>
                      <span className="sf-strong">{token.symbol}</span>
                      {token.decimals !== null ? <span className="sf-dim">{token.decimals} decimals</span> : null}
                    </label>
                    <Input
                      aria-describedby={error ? `${inputId}-error` : undefined}
                      aria-invalid={error ? true : undefined}
                      aria-label={`${token.symbol} daily cap on ${nameOf(key)}`}
                      className="sf-num-input"
                      disabled={!field.checked}
                      id={inputId}
                      inputMode="decimal"
                      onChange={e => patch({ cap: e.target.value })}
                      size="sm"
                      value={field.cap}
                    />
                    {error ? <FieldError id={`${inputId}-error`}>{error}</FieldError> : null}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="sf-field">
        <label className="sf-label" htmlFor={`${uid}-days`}>
          Duration
        </label>
        <Input
          aria-describedby={shownErrors.days ? `${uid}-days-error` : undefined}
          aria-invalid={shownErrors.days ? true : undefined}
          className="sf-num-input"
          containerClassName={shownErrors.days ? 'sf-days sf-invalid' : 'sf-days'}
          id={`${uid}-days`}
          inputMode="numeric"
          onChange={e => {
            const value = e.target.value
            setForm(prev => ({ ...prev, days: value }))
          }}
          size="sm"
          suffix="days"
          value={form.days}
        />
        {shownErrors.days ? <FieldError id={`${uid}-days-error`}>{shownErrors.days}</FieldError> : null}
      </div>

      <div className="sf-submit">
        <span className="sf-hint">
          Nothing is signed in this step.{edited ? ' The form changed since the last review.' : ''}
        </span>
        <Button disabled={locked} loading={review.busy} size="sm" type="submit" variant={draft && !edited ? 'outline' : 'default'}>
          Review permissions
        </Button>
      </div>
      {review.error ? <InlineError>{review.error}</InlineError> : null}

      {draft ? <ScopeLists draft={draft} networks={state.networks} /> : null}
    </form>
  )
}

export function permissionsSummary(preset: Preset, draft: Draft | null): string {
  const days = draft?.durationDays || preset.durationDays
  return `${preset.title}, ${days} ${days === 1 ? 'day' : 'days'}`
}

// --- Step 4: activation ---

interface ActivateRow {
  network: NetworkState
  part: DraftNetwork
  enough: boolean
  ticked: boolean
}

interface ActivateStepProps {
  state: WalletState
  draft: Draft
  onActivated: () => void
}

export function ActivateStep({ state, draft, onActivated }: ActivateStepProps) {
  const { store, locked } = usePane()
  const uid = useId()
  const [ticks, setTicks] = useRemembered<Record<string, boolean>>(`ticks:${draft.id}`, () => ({}))
  const [confirming, setConfirming] = useState(false)

  const rows: ActivateRow[] = []
  for (const network of state.networks) {
    const part = draft.networks[network.key]
    if (!part) continue
    // The live balance is newer than the one the draft was compiled with, so it decides when known.
    const live = network.balances ? compareDecimal(network.balances.native, part.cost.total) : null
    const enough = live !== null ? live >= 0 : part.sufficient
    rows.push({ network, part, enough, ticked: enough && ticks[network.key] !== false })
  }
  const chosen = rows.filter(row => row.ticked)
  // Most networks take one approval. One that activates in stages takes more, and the count is shown per network.
  const approvalsHint = chosen.every(row => row.part.approvals === 1)
    ? 'Each network needs one passkey approval.'
    : `Passkey approvals: ${chosen.map(row => `${row.part.approvals} on ${row.network.name}`).join(', ')}.`

  return (
    <>
      <ul className="sf-costs">
        {rows.map(({ network, part, enough, ticked }) => {
          const boxId = `${uid}-${network.key}`
          const symbol = part.cost.nativeSymbol || network.nativeSymbol
          return (
            <li className="sf-cost" data-off={!ticked || undefined} key={network.key}>
              <div className="sf-cost-head">
                <Checkbox
                  checked={ticked}
                  disabled={!enough || locked}
                  id={boxId}
                  onCheckedChange={checked => setTicks(prev => ({ ...prev, [network.key]: checked === true }))}
                />
                <label className="sf-strong" htmlFor={boxId}>
                  {network.name}
                </label>
              </div>
              <dl className="sf-kv">
                <div>
                  <dt>Keystore fee</dt>
                  <dd>
                    <Num symbol={symbol} value={part.cost.keystoreFee} />
                  </dd>
                </div>
                <div>
                  <dt>
                    Relay fee
                    <Badge size="xs" variant="muted">
                      estimate
                    </Badge>
                  </dt>
                  <dd>
                    <Num symbol={symbol} value={part.cost.relayFeeEstimate} />
                  </dd>
                </div>
                <div className="sf-kv-total">
                  <dt>Total</dt>
                  <dd>
                    <Num strong symbol={symbol} value={part.cost.total} />
                  </dd>
                </div>
              </dl>
              {!enough ? (
                <Warning>
                  Balance too low: send at least {part.cost.total} {symbol}
                </Warning>
              ) : null}
            </li>
          )
        })}
      </ul>

      <div className="sf-submit">
        <span className="sf-hint">{approvalsHint}</span>
        <Button disabled={locked || chosen.length === 0} onClick={() => setConfirming(true)} size="sm" type="button">
          Activate
        </Button>
      </div>

      <ConfirmDialog
        confirmLabel="Activate"
        description={approvalsHint}
        dismissOnConfirm
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await store.post('/activate', { draftId: draft.id, networks: chosen.map(row => row.network.key) })
          onActivated()
        }}
        open={confirming}
        title={chosen.length === 1 ? 'Activate on 1 network?' : `Activate on ${chosen.length} networks?`}
      >
        <ul className="sf-dialog sf-confirm-list">
          {chosen.map(({ network, part }) => (
            <li key={network.key}>
              <span>{network.name}</span>
              <Num strong symbol={part.cost.nativeSymbol || network.nativeSymbol} value={part.cost.total} />
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  )
}

export function activateSummary(networks: NetworkState[]): string | null {
  const active = networks.filter(n => n.session?.status === 'active').length
  return active > 0 ? `${active} of ${networks.length} active` : null
}

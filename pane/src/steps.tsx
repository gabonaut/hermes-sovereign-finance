import { Badge, Button, CopyButton, Skeleton } from '@hermes/plugin-sdk'
import { type ReactNode, useId, useState } from 'react'

import { displayAmount, isPositive, parseTime, shortHex, timeAgo } from './format'
import { IconCheck, IconChevron } from './icons'
import { QrCode } from './qr'
import type { NetworkState, OtherWallet } from './types'
import { ExtLink, Hex, InlineError, Num, useAction, usePane, Warning } from './ui'

export type StepStatus = 'done' | 'current' | 'todo' | 'locked'

interface StepProps {
  n: number
  title: string
  status: StepStatus
  /** Shown on the right while the step is collapsed. */
  summary?: ReactNode
  /** When set, the step cannot be opened and this says what it is waiting for. */
  blocked?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function Step({ n, title, status, summary, blocked, open, onToggle, children }: StepProps) {
  const bodyId = useId()
  const shown = open && !blocked

  const label = (
    <>
      <span className="sf-step-title">
        <span className="sf-sr">Step {n}: </span>
        {title}
        {status === 'done' ? <span className="sf-sr"> (done)</span> : null}
      </span>
      {blocked ? <span className="sf-step-summary">{blocked}</span> : null}
      {!blocked && !shown && summary ? <span className="sf-step-summary">{summary}</span> : null}
    </>
  )

  return (
    <li className="sf-step" data-status={status}>
      <span aria-hidden="true" className="sf-step-marker">
        {status === 'done' ? <IconCheck height={12} width={12} /> : n}
      </span>
      {blocked ? (
        <div className="sf-step-head">{label}</div>
      ) : (
        <button aria-controls={bodyId} aria-expanded={shown} className="sf-step-head" onClick={onToggle} type="button">
          {label}
          <IconChevron className="sf-step-caret" height={12} width={12} />
        </button>
      )}
      <span aria-hidden="true" className="sf-step-rail" />
      <div className="sf-step-body" id={bodyId}>
        {shown ? children : null}
      </div>
    </li>
  )
}

// --- Step 1 ---

/** The address in groups of four, so two copies can be compared by eye. Selecting it copies plain hex. */
function GroupedAddress({ value }: { value: string }) {
  const groups = [value.slice(0, 6)]
  for (let i = 6; i < value.length; i += 4) groups.push(value.slice(i, i + 4))
  return (
    <span className="sf-address">
      {groups.map((group, i) => (
        <span key={i}>{group}</span>
      ))}
    </span>
  )
}

interface WalletStepProps {
  address: string | null
  networks: NetworkState[]
  others: OtherWallet[]
  /** Called after the wallet in use changed, so anything reviewed for the old one is dropped. */
  onSwitched: () => void
}

/** Wallets set aside earlier. Picking one needs no passkey: the record holds public data only. */
function EarlierWallets({ others, disabled, onUse }: { others: OtherWallet[]; disabled: boolean; onUse: (address: string) => void }) {
  if (others.length === 0) return null
  return (
    <div className="sf-earlier">
      <h3 className="sf-earlier-title">Earlier wallets</h3>
      <ul className="sf-earlier-list">
        {others.map(w => (
          <li key={w.address}>
            <span className="sf-mono" title={w.address}>
              {shortHex(w.address, 8, 6)}
            </span>
            <Button disabled={disabled} onClick={() => onUse(w.address)} size="xs" type="button" variant="outline">
              Use
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What the user leaves behind at this address, in their own terms. */
function leftBehind(networks: NetworkState[]): string[] {
  const lines: string[] = []
  const held = networks.flatMap(n => {
    const b = n.balances
    if (!b) return []
    const parts = [isPositive(b.native) ? `${displayAmount(b.native)} ${n.nativeSymbol}` : '', ...b.tokens.filter(t => isPositive(t.amount)).map(t => `${displayAmount(t.amount)} ${t.symbol}`)].filter(Boolean)
    return parts.length ? [`${parts.join(', ')} on ${n.name}`] : []
  })
  if (held.length) lines.push(`It holds ${held.join(' and ')}. Funds stay at this address. Withdraw them first, or come back to this wallet for them.`)
  const open = networks.filter(n => n.positions.length > 0).map(n => n.name)
  if (open.length) lines.push(`It has an open position on ${open.join(' and ')}. The position stays in this wallet.`)
  const live = networks.filter(n => n.session?.status === 'active').map(n => n.name)
  if (live.length) lines.push(`The agent can still act for this wallet on ${live.join(' and ')} until you revoke that session or it expires. Revoke first to end it now.`)
  return lines
}

export function WalletStep({ address, networks, others, onSwitched }: WalletStepProps) {
  const { store, locked } = usePane()
  const create = useAction()
  const recover = useAction()
  const change = useAction()
  const [switching, setSwitching] = useState(false)

  const use = (target: string) =>
    void change.run(async () => {
      await store.post('/wallet/use', { address: target })
      setSwitching(false)
      onSwitched()
    })

  if (address) {
    const warnings = switching ? leftBehind(networks) : []
    return (
      <>
        <div className="sf-wallet">
          <div className="sf-wallet-main">
            <GroupedAddress value={address} />
            <CopyButton buttonSize="xs" buttonVariant="outline" label="Copy address" text={address}>
              Copy address
            </CopyButton>
          </div>
          <QrCode className="sf-qr" label="QR code of the wallet address" value={address} />
        </div>
        {switching ? (
          <div className="sf-switch">
            <h3 className="sf-switch-title">Use another wallet</h3>
            {warnings.map(line => (
              <Warning key={line}>{line}</Warning>
            ))}
            <p className="sf-copy">
              This wallet is set aside, not deleted. To return to it, pick it under Earlier wallets or use Recover from passkey.
            </p>
            <EarlierWallets disabled={locked || change.busy} onUse={use} others={others} />
            <div className="sf-actions">
              <Button
                disabled={locked}
                loading={change.busy}
                onClick={() =>
                  void change.run(async () => {
                    await store.post('/wallet/set-aside', {})
                    setSwitching(false)
                    onSwitched()
                  })
                }
                size="sm"
                type="button"
              >
                Set aside and start a new one
              </Button>
              <Button
                disabled={change.busy}
                onClick={() => {
                  change.clear()
                  setSwitching(false)
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
            {change.error ? <InlineError>{change.error}</InlineError> : null}
          </div>
        ) : (
          <button className="sf-link sf-switch-open" disabled={locked} onClick={() => setSwitching(true)} type="button">
            Use another wallet
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <p className="sf-copy">The admin key is a passkey that stays on your device.</p>
      <div className="sf-actions">
        <Button
          disabled={locked || recover.busy || change.busy}
          loading={create.busy}
          onClick={() => {
            recover.clear()
            void create.run(() => store.post('/create', {}))
          }}
          size="sm"
          type="button"
        >
          Create Smart Agentic Wallet
        </Button>
        <Button
          disabled={locked || create.busy || change.busy}
          loading={recover.busy}
          onClick={() => {
            create.clear()
            void recover.run(() => store.post('/recover', {}))
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Recover from passkey
        </Button>
      </div>
      {create.error ? <InlineError>{create.error}</InlineError> : null}
      {recover.error ? <InlineError>{recover.error}</InlineError> : null}
      <EarlierWallets disabled={locked || create.busy || recover.busy || change.busy} onUse={use} others={others} />
      {change.error ? <InlineError>{change.error}</InlineError> : null}
    </>
  )
}

export const walletSummary = (address: string | null) => (address ? <span className="sf-mono">{shortHex(address)}</span> : null)

// --- Step 2 ---

function NetworkRow({ network }: { network: NetworkState }) {
  const { now } = usePane()
  const asOf = parseTime(network.asOf)
  const held = (network.balances?.tokens ?? []).filter(t => isPositive(t.amount))

  return (
    <li className="sf-net">
      <div className="sf-net-id">
        <span className="sf-net-name">{network.name}</span>
        <span className="sf-links">
          <ExtLink href={network.addressUrl}>Explorer</ExtLink>
          <ExtLink href={network.keystoreAccountUrl}>Keystore</ExtLink>
        </span>
      </div>
      <div className="sf-net-figures">
        <span className="sf-net-balance">
          {network.balances ? (
            <Num strong symbol={network.nativeSymbol} value={network.balances.native} />
          ) : network.error ? (
            <span className="sf-dim">unavailable</span>
          ) : (
            <Skeleton style={{ width: 96, height: 14 }} />
          )}
        </span>
        {held.map(token => (
          <span className="sf-net-token" key={token.symbol}>
            <Num symbol={token.symbol} value={token.amount} />
          </span>
        ))}
        <span className="sf-net-asof">{asOf !== null ? timeAgo(asOf, now) : null}</span>
      </div>
      {network.error ? (
        <div className="sf-net-error">
          <Warning>{network.error}</Warning>
        </div>
      ) : null}
    </li>
  )
}

interface FundStepProps {
  address: string
  networks: NetworkState[]
  onWithdraw: () => void
}

export function FundStep({ address, networks, onWithdraw }: FundStepProps) {
  const { locked } = usePane()
  const anything = networks.some(
    n => n.balances !== null && (isPositive(n.balances.native) || n.balances.tokens.some(t => isPositive(t.amount)))
  )

  return (
    <>
      <div className="sf-fund-address">
        <span className="sf-badges">
          {networks.map(n => (
            <Badge key={n.key} variant="muted">
              {n.shortName}
            </Badge>
          ))}
        </span>
        <Hex copyLabel="Copy address" fit value={address} />
      </div>
      <p className="sf-copy">Same address on both networks. Send ETH only on Ethereum. Send BNB only on BNB Chain.</p>
      <ul className="sf-nets">
        {networks.map(n => (
          <NetworkRow key={n.key} network={n} />
        ))}
      </ul>
      <div className="sf-actions">
        <Button disabled={locked || !anything} onClick={onWithdraw} size="sm" type="button" variant="outline">
          Withdraw
        </Button>
      </div>
    </>
  )
}

export function fundSummary(networks: NetworkState[]): ReactNode {
  const parts = networks.filter(n => n.balances !== null)
  if (parts.length === 0) return null
  return (
    <span className="sf-summary-nums">
      {parts.map(n => (
        <Num key={n.key} symbol={n.nativeSymbol} value={n.balances?.native ?? '0'} />
      ))}
    </span>
  )
}

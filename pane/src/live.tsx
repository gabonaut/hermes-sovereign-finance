import { Badge, Button, ConfirmDialog, StatusDot, type StatusTone } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { formatDate, formatDateTime, parseTime, rangePosition, relativeTime, timeAgo } from './format'
import type { Amount, NetworkState, Position, Session } from './types'
import { ExtLink, Hex, Num, usePane, Warning } from './ui'
import { Plays } from './plays-view'
import { NetworkMark } from './icons'

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'good' },
  expired: { label: 'Expired', tone: 'warn' },
  revoked: { label: 'Revoked', tone: 'muted' }
}

function statusOf(session: Session) {
  return STATUS[session.status] ?? { label: session.status || 'Unknown', tone: 'muted' as StatusTone }
}

// --- Position ---

/** The range as a track with the current price on it. In range sits inside, out of range sits outside. */
function RangeBar({ position, at }: { position: Position; at: number | null }) {
  if (at === null) return null
  // The band covers the middle 72% of the track, so a price outside it still has somewhere to sit.
  const inside = at >= 0 && at <= 1
  const left = inside ? 14 + at * 72 : at < 0 ? 5 : 95
  const where = inside ? 'inside' : at < 0 ? 'below' : 'above'

  return (
    <div
      aria-label={`Current price ${position.priceCurrent} is ${where} the range ${position.priceLower} to ${position.priceUpper} ${position.priceUnit}`}
      className="sf-range"
      data-in={inside || undefined}
      role="img"
    >
      <span className="sf-range-band" />
      <span className="sf-range-mark" style={{ left: `${left}%` }} />
    </div>
  )
}

/** Rows of amounts with shared columns, so the same token lines up from one row to the next. */
function Ledger({ rows }: { rows: { label: string; items: Amount[] }[] }) {
  const columns = Math.max(1, ...rows.map(row => row.items.length))
  return (
    <dl className="sf-ledger" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${columns},minmax(0,auto))` }}>
      {rows.map(row => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          {Array.from({ length: columns }, (_, i) => {
            const item = row.items[i]
            return <dd key={i}>{item ? <Num symbol={item.symbol} value={item.amount} /> : null}</dd>
          })}
        </div>
      ))}
    </dl>
  )
}

function PositionBlock({ position, dex }: { position: Position; dex: string }) {
  const minted = parseTime(position.mintedAt)
  const at = rangePosition(position.priceLower, position.priceUpper, position.priceCurrent)
  // Keep the three prices in ascending order, so an out of range price sits outside the bounds.
  const order = at !== null && at < 0 ? (['current', 'lower', 'upper'] as const) : at !== null && at > 1 ? (['lower', 'upper', 'current'] as const) : (['lower', 'current', 'upper'] as const)

  return (
    <li className="sf-pos">
      <div className="sf-pos-head">
        <span className="sf-pos-pair">{position.pair}</span>
        {position.feePct ? <span className="sf-pos-fee">{position.feePct}%</span> : null}
        <Badge variant={position.inRange ? 'success' : 'warn'}>{position.inRange ? 'In range' : 'Out of range'}</Badge>
      </div>
      <RangeBar at={at} position={position} />
      <div className="sf-pos-prices">
        {order.map(cell =>
          cell === 'current' ? (
            <span className="sf-pos-current" key={cell}>
              <span className="sf-num" data-strong="true">
                {position.priceCurrent}
              </span>
              <span className="sf-dim">{position.priceUnit}</span>
            </span>
          ) : (
            <span className="sf-num" key={cell}>
              {cell === 'lower' ? position.priceLower : position.priceUpper}
            </span>
          )
        )}
      </div>
      <Ledger
        rows={[
          { label: 'Amounts', items: position.amounts },
          { label: 'Unclaimed fees', items: position.unclaimedFees }
        ]}
      />
      <div className="sf-pos-foot sf-dim">
        {dex ? <span>{dex}</span> : null}
        {position.tokenId ? <span className="sf-mono">#{position.tokenId}</span> : null}
        {minted !== null ? <span>since {formatDate(minted)}</span> : null}
      </div>
    </li>
  )
}

// --- Session card ---

function SessionCard({ network, session }: { network: NetworkState; session: Session }) {
  const { store, now, locked } = usePane()
  const [confirming, setConfirming] = useState(false)
  const status = statusOf(session)
  const expiry = session.expiry > 0 ? session.expiry * 1000 : null
  const asOf = parseTime(network.asOf)
  const canRevoke = session.status !== 'revoked' && session.status !== 'expired'
  const holding = network.positions.length > 0

  return (
    <li className="sf-card" data-net={network.key} data-status={session.status}>
      <div className="sf-card-head">
        <span className="sf-card-net">
          <NetworkMark network={network.key} />
          {network.name}
        </span>
        <span className="sf-card-status">
          <StatusDot tone={status.tone} />
          {status.label}
        </span>
        {canRevoke ? (
          <Button disabled={locked} onClick={() => setConfirming(true)} size="xs" type="button" variant="outline">
            Revoke
          </Button>
        ) : null}
      </div>

      {network.error ? (
        <Warning>
          Chain read failed. Showing the last good read{asOf !== null ? ` (${timeAgo(asOf, now)})` : ''}.
        </Warning>
      ) : null}

      {session.status === 'revoked' || session.status === 'expired' ? (
        <p className="sf-dim">The agent cannot act on {network.name} until new permissions are activated.</p>
      ) : null}

      {expiry !== null && session.status !== 'revoked' ? (
        <div className="sf-card-expiry">
          <span>
            {expiry <= now ? 'Expired' : 'Expires'} {formatDateTime(expiry)}
          </span>
          <span className="sf-dim">{relativeTime(expiry, now)}</span>
        </div>
      ) : null}

      {holding === false && session.status === 'active' ? <Plays network={network} stage="start" /> : null}

      {network.positions.length > 0 ? <h4 className="sf-section">Positions</h4> : null}
      {network.positions.length > 0 ? (
        <ul className="sf-positions">
          {network.positions.map(position => (
            <PositionBlock dex={network.dex} key={position.tokenId || position.pair} position={position} />
          ))}
        </ul>
      ) : null}
      {holding && session.status === 'active' ? <Plays network={network} stage="holding" /> : null}

      {session.scopeText.length > 0 ? (
        <details className="sf-more" open={session.status !== 'active' || undefined}>
          <summary>What the agent may do</summary>
          <ul className="sf-scope">
            {session.scopeText.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="sf-card-foot">
        {session.keyId ? (
          <span className="sf-card-key">
            <span className="sf-dim">Session key</span>
            <Hex copyLabel="Copy session key id" value={session.keyId} />
          </span>
        ) : null}
        <span className="sf-links">
          <ExtLink href={session.keystoreKeyUrl}>Verify in Keystore</ExtLink>
          <ExtLink href={session.grantTxUrl}>Grant transaction</ExtLink>
          <ExtLink href={session.revokeTxUrl}>Revoke transaction</ExtLink>
        </span>
      </div>

      <ConfirmDialog
        confirmLabel="Revoke"
        description={`The agent's session key stops working on ${network.name}. This needs one passkey approval.`}
        destructive
        dismissOnConfirm
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await store.post('/revoke', { network: network.key })
        }}
        open={confirming}
        title={`Revoke the session on ${network.name}?`}
      />
    </li>
  )
}

export function LiveSection({ networks }: { networks: NetworkState[] }) {
  const live = networks.filter(n => n.session !== null)
  if (live.length === 0) return null

  return (
    <section className="sf-live">
      <h3 className="sf-section-title">Agent sessions</h3>
      <ul className="sf-cards">
        {live.map(n => (n.session ? <SessionCard key={n.key} network={n} session={n.session} /> : null))}
      </ul>
    </section>
  )
}

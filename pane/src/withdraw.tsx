import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  SegmentedControl
} from '@hermes/plugin-sdk'
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

import { compareDecimal, isAddress, isDecimal, isPositive } from './format'
import type { Amount, NetworkState } from './types'
import { InlineError, Num, useAction, usePane } from './ui'

interface WithdrawDialogProps {
  open: boolean
  onClose: () => void
  address: string
  networks: NetworkState[]
}

function assetsOf(network: NetworkState | undefined): Amount[] {
  if (!network) return []
  const native: Amount = { symbol: network.nativeSymbol, amount: network.balances?.native ?? '' }
  return [native, ...(network.balances?.tokens ?? [])]
}

const hasFunds = (network: NetworkState) => assetsOf(network).some(asset => isPositive(asset.amount))

type Action = ReturnType<typeof useAction>

export function WithdrawDialog(props: WithdrawDialogProps) {
  const send = useAction()
  const { open } = props
  const { clear } = send

  useEffect(() => {
    if (open) clear()
  }, [open, clear])

  // The form is mounted per opening, so every withdrawal starts empty. A request in flight keeps
  // the dialog open: its answer belongs here.
  return (
    <Dialog onOpenChange={next => !next && !send.busy && props.onClose()} open={open}>
      {open ? <WithdrawForm {...props} send={send} /> : null}
    </Dialog>
  )
}

function WithdrawForm({ onClose, address, networks, send }: WithdrawDialogProps & { send: Action }) {
  const { store } = usePane()
  const uid = useId()
  const [networkKey, setNetworkKey] = useState<string>(() => (networks.find(hasFunds) ?? networks[0])?.key ?? '')
  const [symbol, setSymbol] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [to, setTo] = useState('')
  const [attempted, setAttempted] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)

  const network = networks.find(n => n.key === networkKey)
  const assets = assetsOf(network)
  // An asset known to be empty cannot be picked. One whose balance was not read still can.
  const empty = (a: Amount) => isDecimal(a.amount) && !isPositive(a.amount)
  const pickable = assets.filter(a => !empty(a))
  const asset = pickable.find(a => a.symbol === symbol) ?? pickable[0]
  const isNative = asset !== undefined && network !== undefined && asset.symbol === network.nativeSymbol
  const known = asset !== undefined && isDecimal(asset.amount)

  // "max" is sent as it is: the plugin works out the largest amount that still leaves the fee behind.
  const isMax = amount.trim().toLowerCase() === 'max'
  let amountError: string | null = null
  if (isMax) amountError = null
  else if (!isPositive(amount)) amountError = 'Enter an amount above 0.'
  else if (asset && known && compareDecimal(amount, asset.amount) === 1) amountError = `More than the ${asset.symbol} balance.`

  let toError: string | null = null
  const target = to.trim()
  if (!isAddress(target)) toError = 'Enter a 0x address with 40 hex characters.'
  else if (target.toLowerCase() === address.toLowerCase()) toError = 'This is the wallet itself.'

  const pickAsset = (next: string) => {
    if (next === asset?.symbol) return
    setSymbol(next)
    setAmount('')
  }

  // Arrow keys move the choice, as in any radio group.
  const onAssetKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 || pickable.length === 0) return
    event.preventDefault()
    const index = Math.max(0, pickable.findIndex(a => a.symbol === asset?.symbol))
    const next = pickable[(index + step + pickable.length) % pickable.length]
    if (!next) return
    pickAsset(next.symbol)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-asset="${CSS.escape(next.symbol)}"]`)?.focus()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (!network || !asset || amountError || toError || send.busy) return
    void send
      .run(() => store.post('/withdraw', { network: network.key, asset: asset.symbol, amount: amount.trim(), to: target }))
      .then(ok => {
        if (ok) onClose()
      })
  }

  return (
    <DialogContent
      className="sf-dialog-shell"
      onOpenAutoFocus={event => {
        // Start in the amount field, not on the first control in the dialog.
        event.preventDefault()
        amountRef.current?.focus()
      }}
    >
      <DialogHeader>
        <DialogTitle>Withdraw</DialogTitle>
        <DialogDescription>You approve the withdrawal with your passkey in the browser.</DialogDescription>
      </DialogHeader>

      <form className="sf-dialog sf-form" id={`${uid}-form`} noValidate onSubmit={submit}>
        <div className="sf-field">
          <span className="sf-label">Network</span>
          <SegmentedControl
            onChange={key => {
              setNetworkKey(key)
              setSymbol(null)
              setAmount('')
            }}
            options={networks.map(n => ({ id: n.key as string, label: n.name }))}
            sizing="content"
            value={networkKey}
          />
        </div>

        <div aria-label="Asset" className="sf-assets" onKeyDown={onAssetKey} role="radiogroup">
          {assets.map(a => {
            const selected = a.symbol === asset?.symbol
            return (
              <button
                aria-checked={selected}
                className="sf-asset"
                data-asset={a.symbol}
                disabled={empty(a)}
                key={a.symbol}
                onClick={() => pickAsset(a.symbol)}
                role="radio"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span className="sf-asset-dot" />
                <span className="sf-strong">{a.symbol}</span>
                {isDecimal(a.amount) ? <Num value={a.amount} /> : <span className="sf-dim">balance not read</span>}
              </button>
            )
          })}
        </div>

        <div className="sf-stack">
          <div className="sf-label-row">
            <label className="sf-label" htmlFor={`${uid}-amount`}>
              Amount
            </label>
            {asset && known && isPositive(asset.amount) ? (
              <Button onClick={() => setAmount(isNative ? 'max' : asset.amount)} size="inline" type="button" variant="text">
                Max
              </Button>
            ) : null}
          </div>
          <Input
            aria-describedby={attempted && amountError ? `${uid}-amount-error` : undefined}
            aria-invalid={attempted && amountError ? true : undefined}
            className="sf-num-input"
            containerClassName={attempted && amountError ? 'sf-invalid' : undefined}
            id={`${uid}-amount`}
            inputMode="text"
            onChange={e => setAmount(e.target.value)}
            placeholder="0.0"
            ref={amountRef}
            suffix={asset?.symbol}
            value={amount}
          />
          {attempted && amountError ? (
            <span className="sf-field-error" id={`${uid}-amount-error`} role="alert">
              {amountError}
            </span>
          ) : null}
          {isNative ? (
            <span className="sf-hint">
              {isMax ? 'Sends everything except the network fee.' : 'The network fee is paid from this balance. Max leaves it behind.'}
            </span>
          ) : null}
        </div>

        <div className="sf-stack">
          <label className="sf-label" htmlFor={`${uid}-to`}>
            To address{network ? ` on ${network.name}` : ''}
          </label>
          <Input
            aria-describedby={attempted && toError ? `${uid}-to-error` : undefined}
            aria-invalid={attempted && toError ? true : undefined}
            className="sf-mono-input"
            id={`${uid}-to`}
            onChange={e => setTo(e.target.value)}
            placeholder="0x"
            value={to}
          />
          {attempted && toError ? (
            <span className="sf-field-error" id={`${uid}-to-error`} role="alert">
              {toError}
            </span>
          ) : null}
        </div>

        {send.error ? <InlineError>{send.error}</InlineError> : null}
      </form>

      <DialogFooter>
        <Button disabled={send.busy} onClick={onClose} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!network || !asset} form={`${uid}-form`} loading={send.busy} type="submit">
          Withdraw
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

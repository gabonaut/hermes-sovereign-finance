import { Badge, ConfirmDialog, SegmentedControl, Skeleton } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { errorText } from './api'
import { AltanaMark } from './icons'
import type { Mode } from './types'
import { InlineError } from './ui'

const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'testnet', label: 'Testnet' },
  { id: 'mainnet', label: 'Mainnet' }
]

interface HeaderProps {
  /** Null until the first state arrives. */
  mode: Mode | null
  /** The first state is still on its way. */
  loading: boolean
  /** The mode being switched to, while the request is out. */
  pending: Mode | null
  disabled: boolean
  /** Resolves once the pane shows the new mode. Rejects with the reason when the switch failed. */
  onSwitch: (mode: Mode) => Promise<void>
}

export function Header({ mode, loading, pending, disabled, onSwitch }: HeaderProps) {
  const [askMainnet, setAskMainnet] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = pending ?? mode

  return (
    <>
    <header className="sf-header">
      <AltanaMark size={18} />
      <h2 className="sf-title">Sovereign Finance</h2>
      {shown === 'mainnet' ? <Badge variant="warn">Real funds</Badge> : null}
      {shown === null ? (
        loading ? (
          <Skeleton style={{ width: 132, height: 24 }} />
        ) : null
      ) : (
        <SegmentedControl
          disabled={disabled || pending !== null}
          onChange={id => {
            if (id === shown) return
            setError(null)
            if (id === 'mainnet') setAskMainnet(true)
            else void onSwitch('testnet').catch(err => setError(errorText(err)))
          }}
          options={MODES}
          value={shown}
        />
      )}
      <ConfirmDialog
        confirmLabel="Switch to mainnet"
        description="Mainnet uses real funds."
        dismissOnConfirm
        onClose={() => setAskMainnet(false)}
        onConfirm={() => onSwitch('mainnet')}
        open={askMainnet}
        title="Switch to mainnet?"
      />
    </header>
    {error ? (
      <div className="sf-strip">
        <InlineError>{error}</InlineError>
      </div>
    ) : null}
    </>
  )
}

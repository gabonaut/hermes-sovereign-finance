import { Button, host, Input } from '@hermes/plugin-sdk'
import { useId, useState } from 'react'

import { defaultsFor, PLAYS, type Play, type PlayContext } from './plays'
import type { NetworkState } from './types'

/** Put a request into the chat box. Falls back to the clipboard when no chat box can take it. */
async function hand(text: string): Promise<'chat' | 'copied' | 'failed'> {
  const composer = (host as { composer?: { setDraft?: (id: null | string, text: string) => Promise<boolean>; focus?: (id?: null | string) => void } }).composer
  try {
    if (composer && typeof composer.setDraft === 'function') {
      for (const target of [null, 'new'] as const) {
        if (await composer.setDraft(target, text)) {
          composer.focus?.(target)
          return 'chat'
        }
      }
    }
  } catch {
    // Fall through to the clipboard.
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

const NOTE = {
  chat: 'Written into the chat box. Press Enter to send it.',
  copied: 'Copied. Paste it into a chat and send it.',
  failed: 'Open a chat first, then press the button again.'
} as const

/**
 * `stage` is where the wallet stands on this network. At "start" it holds no position, so the plays
 * are the next step and are shown as one: first in the card, tinted, with a filled button. Once it
 * holds one they are follow-ups and sit under the positions.
 */
export function Plays({ network, stage }: { network: NetworkState; stage: 'start' | 'holding' }) {
  const uid = useId()
  const defaults = defaultsFor(network)
  const [amount, setAmount] = useState(defaults.amount)
  const [rangePct, setRangePct] = useState(defaults.rangePct)
  const [note, setNote] = useState<{ id: string; kind: keyof typeof NOTE } | null>(null)

  const context: PlayContext = {
    network: network.key,
    networkName: network.name,
    native: network.nativeSymbol,
    pair: defaults.pair,
    amount: amount.trim() || defaults.amount,
    rangePct: rangePct.trim() || defaults.rangePct
  }

  const run = async (play: Play, request: (c: PlayContext) => string) => {
    setNote({ id: play.id, kind: await hand(request(context)) })
  }

  return (
    <section className="sf-plays" data-stage={stage}>
      <div className="sf-plays-head">
        <span className="sf-strong">{stage === 'start' ? 'Next: put the agent to work' : 'Ask the agent'}</span>
        <span className="sf-hint">A button writes the request into the chat box. You send it.</span>
      </div>
      <ul className="sf-play-list">
        {PLAYS.filter(play => play.when === 'both' || play.when === stage).map(play => (
          <li className="sf-play" key={play.id}>
            <div className="sf-play-text">
              <span className="sf-play-title">{play.title}</span>
              <span className="sf-play-blurb">{play.blurb}</span>
              {play.sized ? (
                <span className="sf-play-fields">
                  <label className="sf-play-field" htmlFor={`${uid}-amount`}>
                    <Input
                      className="sf-num-input"
                      id={`${uid}-amount`}
                      inputMode="decimal"
                      onChange={e => setAmount(e.target.value)}
                      suffix={network.nativeSymbol}
                      value={amount}
                    />
                  </label>
                  <label className="sf-play-field" htmlFor={`${uid}-range`}>
                    <Input
                      className="sf-num-input"
                      id={`${uid}-range`}
                      inputMode="decimal"
                      onChange={e => setRangePct(e.target.value)}
                      suffix="% range"
                      value={rangePct}
                    />
                  </label>
                  <span className="sf-hint">{defaults.pair}</span>
                </span>
              ) : null}
              {note?.id === play.id ? <span className="sf-play-note">{NOTE[note.kind]}</span> : null}
            </div>
            <div className="sf-play-actions">
              {play.actions.map(action => (
                <Button
                  key={action.label}
                  onClick={() => void run(play, action.request)}
                  size="sm"
                  type="button"
                  variant={stage === 'start' && play.id === 'open' ? 'default' : 'outline'}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

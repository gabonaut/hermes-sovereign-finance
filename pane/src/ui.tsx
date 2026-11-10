// Small shared pieces: the pane context, the action hook and the atoms every section draws with.

import { CopyButton, Tip } from '@hermes/plugin-sdk'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'

import { errorText } from './api'
import { displayAmount, isWebUrl, shortHex } from './format'
import { IconAlert, IconExternal } from './icons'
import type { Store } from './store'

export interface PaneEnv {
  store: Store
  /** Wall clock, refreshed twice a minute, for relative times. */
  now: number
  /** A job is running or waiting, or the mode is switching: admin buttons are off. */
  locked: boolean
}

export const PaneContext = createContext<PaneEnv | null>(null)

export function usePane(): PaneEnv {
  const env = useContext(PaneContext)
  if (!env) throw new Error('PaneContext is missing')
  return env
}

/** Runs one async action at a time and keeps its error for the place that started it. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (err) {
      if (mounted.current) setError(errorText(err))
      return false
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  const clear = useCallback(() => setError(null), [])

  return { busy, error, run, clear }
}

/**
 * State kept in the store's memory, so it outlives a remount of the pane and follows `key` when the
 * subject changes (another mode, another draft).
 */
export function useRemembered<T>(key: string, initial: () => T): [T, (next: T | ((prev: T) => T)) => void] {
  const { store } = usePane()
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  if (!store.memory.has(key)) store.memory.set(key, initial())
  const value = store.memory.get(key) as T

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = store.memory.get(key) as T
      store.memory.set(key, typeof next === 'function' ? (next as (prev: T) => T)(prev) : next)
      rerender()
    },
    [store, key]
  )

  return [value, update]
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="sf-alert" data-tone="error" role="alert">
      <IconAlert />
      <span>{children}</span>
    </div>
  )
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="sf-alert" data-tone="warn">
      <IconAlert />
      <span>{children}</span>
    </div>
  )
}

/** A decimal amount, mono and tabular, with its symbol. Long fractions are cut and kept in the title. */
export function Num({ value, symbol, strong }: { value: string; symbol?: string; strong?: boolean }) {
  const shown = displayAmount(value)
  const full = symbol ? `${value} ${symbol}` : value
  return (
    <span className="sf-amt" data-strong={strong || undefined} title={shown !== value ? full : undefined}>
      <span className="sf-num">{shown}</span>
      {symbol ? <span className="sf-sym">{symbol}</span> : null}
    </span>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Opens in the system browser. Renders nothing for a missing or non-web URL. */
export function ExtLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  const { store } = usePane()
  const [failed, setFailed] = useState(false)

  if (!isWebUrl(href)) return null

  return (
    <span className="sf-link-wrap">
      <Tip label={hostOf(href)}>
        <button
          className="sf-link"
          onClick={() => {
            void store.open(href).then(ok => setFailed(!ok))
          }}
          role="link"
          type="button"
        >
          {children}
          <IconExternal />
        </button>
      </Tip>
      {failed ? (
        <CopyButton appearance="inline" label="Copy link" text={href}>
          Copy link
        </CopyButton>
      ) : null}
    </span>
  )
}

/**
 * A long hex value with a copy button. `fit` shows as much as the row allows and drops the middle
 * when it runs out of room; otherwise the middle is always cut.
 */
export function Hex({ value, copyLabel, fit }: { value: string; copyLabel: string; fit?: boolean }) {
  return (
    <span className="sf-hex" data-fit={fit || undefined}>
      {fit ? (
        <span className="sf-hex-text" title={value}>
          <span className="sf-hex-head">{value.slice(0, -6)}</span>
          <span className="sf-hex-tail">{value.slice(-6)}</span>
        </span>
      ) : (
        <span className="sf-hex-text" title={value}>
          {shortHex(value)}
        </span>
      )}
      <CopyButton appearance="icon" buttonSize="icon-xs" label={copyLabel} text={value} />
    </span>
  )
}

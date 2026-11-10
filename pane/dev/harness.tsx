// Browser harness: mounts the real pane (src/plugin.tsx) against a mock ctx, inside a frame the width
// of a Hermes right-hand pane. The fixture picker and the other controls sit outside the pane.
//
// URL parameters: fixture, width, theme (light | dark), and shot=1 for the bare frame the screenshot
// script captures (no controls, no latency, a frozen clock).

import type { PluginContext, PluginContribution } from '@hermes/plugin-sdk'
import { createElement, type ReactNode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import plugin from '../src/plugin'
import { fixtureById, FIXTURES, type Fixture } from './fixtures'
import { createMockBackend, type MockBackend } from './mock-backend'
import { setPaneVisible } from './sdk-stub'

const params = new URLSearchParams(window.location.search)
const SHOT = params.get('shot') === '1'
const WIDTHS = [380, 400, 440, 480]

/** 2026-11-10 12:00 UTC. Screenshots are taken with the clock held here. */
const FROZEN_NOW = Date.UTC(2026, 10, 10, 12, 0, 0)
if (SHOT) Date.now = () => FROZEN_NOW

interface Mounted {
  render: () => ReactNode
  backend: MockBackend
  dispose: () => void
}

interface MountOptions {
  fixture: Fixture
  log: (line: string) => void
  browserFails: () => boolean
}

/** Registers the plugin against a fresh mock ctx, the way Hermes Desktop does on load. */
function mountPlugin({ fixture, log, browserFails }: MountOptions): Mounted {
  const disposers: (() => void)[] = []
  const contributions: PluginContribution[] = []
  const storage = new Map<string, unknown>()
  const backend = createMockBackend({ fixture, now: () => Date.now(), latency: SHOT ? 0 : 180, log })

  const track = (dispose: () => void) => {
    disposers.push(dispose)
    return dispose
  }

  const ctx: PluginContext = {
    source: `plugin:${plugin.id}`,
    register: contribution => {
      contributions.push(contribution)
      return () => undefined
    },
    onDispose: fn => void track(fn),
    setTimeout: (fn, ms) => {
      const id = window.setTimeout(fn, ms)
      return track(() => window.clearTimeout(id))
    },
    setInterval: (fn, ms) => {
      const id = window.setInterval(fn, ms)
      return track(() => window.clearInterval(id))
    },
    addEventListener: (target, type, listener, options) => {
      target.addEventListener(type, listener, options)
      return track(() => target.removeEventListener(type, listener, options))
    },
    rest: backend.rest,
    os: {
      openExternal: async url => {
        const failed = browserFails()
        log(`openExternal ${url}${failed ? ' (failed)' : ''}`)
        return !failed
      }
    },
    storage: {
      get: <T,>(key: string, fallback: T) => (storage.has(key) ? (storage.get(key) as T) : fallback),
      set: (key, value) => void storage.set(key, value),
      remove: key => void storage.delete(key)
    }
  }

  plugin.register(ctx)
  const pane = contributions.find(c => c.area === 'panes')
  if (!pane?.render) throw new Error('the plugin did not register a pane')
  log(`registered pane "${pane.id}" (${pane.title}), data ${JSON.stringify(pane.data)}`)

  return {
    render: pane.render,
    backend,
    dispose: () => {
      disposers.forEach(dispose => dispose())
      backend.dispose()
    }
  }
}

function PaneHost({ render }: { render: () => ReactNode }) {
  // Hermes mounts the contribution callback as a component, so its hooks belong to the pane.
  return createElement(render)
}

function Harness() {
  const [fixtureId, setFixtureId] = useState(() => fixtureById(params.get('fixture')).id)
  const [width, setWidth] = useState(() => Number(params.get('width')) || 400)
  const [dark, setDark] = useState(params.get('theme') === 'dark')
  const [visible, setVisible] = useState(true)
  const [browserFails, setBrowserFails] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [epoch, setEpoch] = useState(0)
  const [, setTick] = useState(0)

  const failsRef = useMemo(() => ({ current: false }), [])
  failsRef.current = browserFails
  const linesRef = useMemo(() => ({ current: [] as string[] }), [])
  linesRef.current = lines

  const mounted = useMemo(
    () =>
      mountPlugin({
        fixture: fixtureById(fixtureId),
        log: line => setLines(prev => [...prev.slice(-199), line]),
        browserFails: () => failsRef.current
      }),
    // A new fixture (or Reload) is a fresh plugin load: new ctx, new store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixtureId, epoch]
  )

  useEffect(() => mounted.dispose, [mounted])
  useEffect(() => {
    // For checks driven from the console or a script.
    Object.assign(window, { sfHarness: { stateCalls: mounted.backend.stateCalls, lines: () => linesRef.current } })
  }, [mounted, linesRef])
  useEffect(() => mounted.backend.subscribe(() => setTick(n => n + 1)), [mounted])
  useEffect(() => void document.documentElement.classList.toggle('dark', dark), [dark])
  useEffect(() => setPaneVisible(visible), [visible])

  useEffect(() => {
    if (SHOT) return
    const next = new URLSearchParams({ fixture: fixtureId, width: String(width), theme: dark ? 'dark' : 'light' })
    window.history.replaceState(null, '', `?${next}`)
  }, [fixtureId, width, dark])

  const frame = (
    <div className="hx-frame" id="frame" style={{ width }}>
      <div className="hx-tabs">
        <span className="hx-tab">Sovereign Finance</span>
      </div>
      <div className="hx-pane">
        <div className="hx-layer" data-hidden={!visible || undefined}>
          <PaneHost key={`${fixtureId}:${epoch}`} render={mounted.render} />
        </div>
      </div>
    </div>
  )

  if (SHOT) return frame

  const waiting = mounted.backend.waiting()

  return (
    <div className="hx">
      {frame}
      <div className="hx-side">
        <h1>Sovereign Finance pane harness</h1>
        <p className="hx-note">
          The pane on the left is the real source, with the Hermes SDK replaced by plain HTML stand-ins and the backend by
          fixtures. Buttons work: jobs run against a pretend backend, and the passkey step is answered here.
        </p>
        <div className="hx-row">
          <span>Width</span>
          {WIDTHS.map(w => (
            <button aria-pressed={w === width} className="h-btn" data-size="sm" data-variant={w === width ? 'secondary' : 'outline'} key={w} onClick={() => setWidth(w)} type="button">
              {w}
            </button>
          ))}
        </div>
        <div className="hx-row">
          <span>Theme</span>
          <button className="h-btn" data-size="sm" data-variant={dark ? 'outline' : 'secondary'} onClick={() => setDark(false)} type="button">
            Light
          </button>
          <button className="h-btn" data-size="sm" data-variant={dark ? 'secondary' : 'outline'} onClick={() => setDark(true)} type="button">
            Dark
          </button>
        </div>
        <div className="hx-row">
          <span>Pane</span>
          <label>
            <input checked={visible} onChange={e => setVisible(e.target.checked)} type="checkbox" /> on screen (polling stops when off)
          </label>
          <button className="h-btn" data-size="sm" data-variant="outline" onClick={() => setEpoch(n => n + 1)} type="button">
            Reload plugin
          </button>
        </div>
        <div className="hx-row">
          <span>Passkey</span>
          <button className="h-btn" data-size="sm" data-variant="default" disabled={!waiting} onClick={mounted.backend.approve} type="button">
            Approve
          </button>
          <button className="h-btn" data-size="sm" data-variant="outline" disabled={!waiting} onClick={mounted.backend.reject} type="button">
            Reject
          </button>
          <label>
            <input checked={browserFails} onChange={e => setBrowserFails(e.target.checked)} type="checkbox" /> browser fails to open
          </label>
        </div>
        <div className="hx-fixtures">
          {FIXTURES.map(f => (
            <button aria-pressed={f.id === fixtureId} key={f.id} onClick={() => setFixtureId(f.id)} type="button">
              {f.title}
            </button>
          ))}
        </div>
        <pre className="hx-log">{lines.length > 0 ? lines.join('\n') : 'Calls to ctx.rest and ctx.os.openExternal show up here.'}</pre>
      </div>
    </div>
  )
}

if (SHOT) document.documentElement.dataset.shot = '1'
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')

const rootElement = document.getElementById('app')
if (!rootElement) throw new Error('missing #app')
createRoot(rootElement).render(<Harness />)

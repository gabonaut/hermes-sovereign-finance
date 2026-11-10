// Captures every harness fixture in a headless Chrome and writes PNGs to dev/screenshots/.
//
//   node dev/shoot.mjs                       the eleven core fixtures at 400 and 480 px, light theme,
//                                            plus the extras, the dialogs and a dark set
//   node dev/shoot.mjs --only=draft,mainnet  just those fixtures
//   node dev/shoot.mjs --out=/some/dir       write somewhere else (for a quick look while editing)
//
// No dependencies: it serves dev/ itself and drives Chrome over the DevTools protocol. Set
// CHROME_PATH if Chrome is not in a usual place. The clock, time zone and locale are pinned, so a
// rerun gives the same pictures.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const devDir = path.dirname(fileURLToPath(import.meta.url))
const paneDir = path.dirname(devDir)
const args = process.argv.slice(2)
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const outDir = path.resolve(option('out') ?? path.join(devDir, 'screenshots'))
const only = option('only')?.split(',').filter(Boolean) ?? null
const SCALE = Number(option('scale') ?? 2)

const CORE = [
  'no-wallet',
  'unfunded',
  'funded',
  'draft',
  'job-waiting',
  'job-done',
  'active-in-range',
  'out-of-range',
  'revoked',
  'network-error',
  'mainnet'
]
const EXTRAS = [
  'loading',
  'backend-missing',
  'forbidden',
  'job-running',
  'job-created',
  'job-error',
  'job-partial',
  'draft-low-balance',
  'expired'
]
const DARK = ['no-wallet', 'draft', 'job-waiting', 'job-done', 'active-in-range', 'out-of-range', 'mainnet']

/**
 * States that need something to happen first. `click` lists button texts to press in order, `full`
 * captures the whole pane instead of an 800 px tall viewport.
 */
const SCENES = [
  // The second poll of this fixture fails, ten seconds after the first.
  { name: 'refresh-failed', fixture: 'refresh-failed', click: [], waitFor: '.sf-content > .sf-alert', full: true },
  { name: 'dialog-mainnet', fixture: 'funded', click: ['Mainnet'] },
  { name: 'dialog-withdraw', fixture: 'funded', click: ['Withdraw'] },
  { name: 'dialog-activate', fixture: 'draft', click: ['Activate'] },
  { name: 'dialog-revoke', fixture: 'active-in-range', click: ['Revoke'] },
  { name: 'form-errors', fixture: 'funded', clear: true, click: ['Review permissions'], full: true },
  { name: 'steps-reopened', fixture: 'active-in-range', click: ['Set permissions', 'Activate'], full: true }
]

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

function serve() {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = path.join(devDir, pathname === '/' ? 'index.html' : pathname)
    if (!file.startsWith(devDir + path.sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function findChrome() {
  const home = os.homedir()
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ]
  const found = candidates.find(candidate => candidate && existsSync(candidate))
  if (!found) throw new Error('Chrome was not found. Set CHROME_PATH to a Chrome or Chromium binary.')
  return found
}

async function launch(profileDir) {
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--force-color-profile=srgb',
      '--lang=en-US',
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Chrome did not start in 20 s')), 20000)
    chrome.stderr.on('data', chunk => {
      buffer += chunk
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    chrome.once('exit', code => reject(new Error(`Chrome exited early (${code})`)))
  })
  return { chrome, endpoint }
}

/** Minimal DevTools protocol client over the browser websocket. */
async function connect(endpoint) {
  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('could not reach Chrome')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const waiters = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) entry?.reject(new Error(`${entry.method}: ${message.error.message}`))
      else entry?.resolve(message.result)
      return
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].method === message.method) waiters.splice(i, 1)[0].resolve(message.params)
    }
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject, method })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  const once = method => new Promise(resolve => waiters.push({ method, resolve }))
  return { send, once, close: () => socket.close() }
}

// Runs in the page: resolves when the pane has drawn its first answer and the layout is quiet.
const SETTLED = `
  new Promise(resolve => {
    const deadline = Date.now() + 8000
    const ready = () => document.querySelector('.sf-steps, .sf-failed, .sf-loading')
    const tick = () => {
      if (ready() || Date.now() > deadline) {
        document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Boolean(ready())))))
      } else {
        setTimeout(tick, 30)
      }
    }
    tick()
  })
`

// Runs in the page: sizes the frame so that nothing inside the pane scrolls, and reports its size.
const FIT = `
  (() => {
    const frame = document.getElementById('frame')
    const root = document.querySelector('.sf-root')
    const scroll = document.querySelector('.sf-scroll')
    frame.style.height = '3000px'
    let height = frame.querySelector('.hx-tabs').offsetHeight
    for (const child of root.children) {
      if (child !== scroll) {
        height += child.scrollHeight + (child.offsetHeight - child.clientHeight)
        continue
      }
      const style = getComputedStyle(scroll)
      const inner = [...scroll.children].reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      // A centred error or loading state has no height of its own: give it a pane-sized box.
      height += scroll.querySelector('.sf-failed, .sf-loading') ? 440 : inner + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    }
    height = Math.ceil(height)
    frame.style.height = height + 'px'
    return { width: Math.round(frame.getBoundingClientRect().width), height }
  })()
`

const clickByText = text => `
  (() => {
    const wanted = ${JSON.stringify(text)}
    const all = [...document.querySelectorAll('button')]
    const target = all.find(b => b.textContent.trim() === wanted && !b.disabled) ?? all.find(b => b.textContent.includes(wanted) && !b.disabled)
    if (!target) return false
    target.click()
    return true
  })()
`

const waitForSelector = selector => `
  new Promise((resolve, reject) => {
    const deadline = performance.now() + 15000
    const tick = () => {
      if (document.querySelector(${JSON.stringify(selector)})) resolve(true)
      else if (performance.now() > deadline) reject(new Error('timed out waiting for ${selector}'))
      else setTimeout(tick, 100)
    }
    tick()
  })
`

// Runs in the page: empties every enabled text field of the pane, the way a user would.
const CLEAR_FIELDS = `
  (() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const input of document.querySelectorAll('.sf-root input:not([disabled])')) {
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })()
`

async function main() {
  execFileSync(process.execPath, [path.join(paneDir, 'build.mjs'), '--dev'], { stdio: 'inherit' })
  await mkdir(outDir, { recursive: true })
  await mkdir(path.join(outDir, 'dark'), { recursive: true })

  const server = await serve()
  const origin = `http://127.0.0.1:${server.address().port}`
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'sf-pane-shots-'))
  const { chrome, endpoint } = await launch(profileDir)
  const cdp = await connect(endpoint)
  let count = 0

  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params) => cdp.send(method, params, sessionId)
    await page('Page.enable')
    await page('Runtime.enable')
    await page('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
    await page('Emulation.setLocaleOverride', { locale: 'en-US' })

    const evaluate = async expression => {
      const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
      return result.value
    }
    const viewport = (width, height) =>
      page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false })
    const open = async (fixture, width, theme) => {
      await viewport(width, 800)
      const loaded = cdp.once('Page.loadEventFired')
      await page('Page.navigate', { url: `${origin}/?shot=1&fixture=${fixture}&width=${width}&theme=${theme}` })
      await loaded
      if (!(await evaluate(SETTLED))) throw new Error(`${fixture} never rendered`)
    }
    const save = async (file, width, height) => {
      const { data } = await page('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height, scale: 1 },
        captureBeyondViewport: true
      })
      await writeFile(file, Buffer.from(data, 'base64'))
      count += 1
      console.log(`  ${path.relative(outDir, file)}  ${width}x${height}`)
    }
    const fitAndSave = async (file, width) => {
      // Twice: the first pass can change wrapping (and so heights) once the viewport follows.
      let size = await evaluate(FIT)
      await viewport(width, size.height)
      await evaluate(SETTLED)
      size = await evaluate(FIT)
      await viewport(width, size.height)
      await evaluate(SETTLED)
      await save(file, size.width, size.height)
    }
    const wanted = id => !only || only.includes(id)

    for (const width of [400, 480]) {
      for (const fixture of [...CORE, ...EXTRAS].filter(wanted)) {
        await open(fixture, width, 'light')
        await fitAndSave(path.join(outDir, `${fixture}-${width}.png`), width)
      }
      for (const fixture of DARK.filter(wanted)) {
        await open(fixture, width, 'dark')
        await fitAndSave(path.join(outDir, 'dark', `${fixture}-${width}.png`), width)
      }
    }

    for (const scene of SCENES.filter(s => wanted(s.name) || wanted(s.fixture))) {
      for (const width of [400, 480]) {
        await open(scene.fixture, width, 'light')
        if (scene.waitFor) await evaluate(waitForSelector(scene.waitFor))
        if (scene.clear) await evaluate(CLEAR_FIELDS)
        for (const text of scene.click) {
          if (!(await evaluate(clickByText(text)))) throw new Error(`${scene.name}: no "${text}" button`)
          await evaluate(SETTLED)
        }
        const file = path.join(outDir, `${scene.name}-${width}.png`)
        if (scene.full) await fitAndSave(file, width)
        else await save(file, width, 800)
      }
    }
  } finally {
    cdp.close()
    chrome.kill()
    server.close()
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
  }
  console.log(`${count} screenshots in ${outDir}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

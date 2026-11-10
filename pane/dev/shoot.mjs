// Captures the harness fixtures in a headless Chrome.
//
//   node dev/shoot.mjs                    write the review sheets to dev/screenshots/ (the committed set)
//   node dev/shoot.mjs --each             write one full-size PNG per fixture and scene to dev/dist/shots/
//   node dev/shoot.mjs --each --only=draft,dialog-withdraw --out=/some/dir
//
// A sheet is several captures side by side at 1x, saved as a palette PNG to keep the files small.
// No dependencies: the script serves dev/ itself, drives Chrome over the DevTools protocol, and reads
// and writes PNG with node:zlib. Set CHROME_PATH if Chrome is not in a usual place. The clock, time
// zone and locale are pinned, so a rerun gives the same pictures.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const devDir = path.dirname(fileURLToPath(import.meta.url))
const paneDir = path.dirname(devDir)
const args = process.argv.slice(2)
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const EACH = args.includes('--each')
const outDir = path.resolve(option('out') ?? path.join(devDir, EACH ? 'dist/shots' : 'screenshots'))
const only = option('only')?.split(',').filter(Boolean) ?? null

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

/**
 * States that need something to happen first. `click` lists button texts to press in order, `full`
 * captures the whole pane instead of a pane-sized viewport.
 */
const SCENES = {
  // The second poll of this fixture fails, ten seconds after the first.
  'refresh-failed': { fixture: 'refresh-failed', waitFor: '.sf-content > .sf-alert', full: true },
  'dialog-mainnet': { fixture: 'funded', click: ['Mainnet'] },
  'dialog-withdraw': { fixture: 'funded', click: ['Withdraw'] },
  'dialog-activate': { fixture: 'draft', click: ['Activate'] },
  'dialog-revoke': { fixture: 'active-in-range', click: ['Revoke'] },
  'form-errors': { fixture: 'funded', clear: true, click: ['Review permissions'], full: true },
  'steps-reopened': { fixture: 'active-in-range', click: ['Set permissions', 'Activate'], full: true }
}

const shot = (id, width, extra = {}) => ({ id, width, theme: 'light', ...extra })

/** The committed set: every core fixture at both widths, then the states around them. */
const SHEETS = [
  ...[400, 480].flatMap(width => [
    { file: `core-${width}-1.png`, shots: CORE.slice(0, 4).map(id => shot(id, width)) },
    { file: `core-${width}-2.png`, shots: CORE.slice(4, 8).map(id => shot(id, width)) },
    { file: `core-${width}-3.png`, shots: CORE.slice(8).map(id => shot(id, width)) }
  ]),
  {
    file: 'states-400.png',
    shots: ['loading', 'backend-missing', 'forbidden', 'job-running', 'job-created', 'job-error', 'job-partial'].map(id =>
      shot(id, 400, { maxHeight: 400 })
    )
  },
  {
    file: 'dark-and-dialogs-400.png',
    shots: [
      shot('active-in-range', 400, { theme: 'dark' }),
      shot('dialog-mainnet', 400, { maxHeight: 520 }),
      shot('dialog-withdraw', 400, { maxHeight: 620 }),
      shot('dialog-activate', 400, { maxHeight: 520 }),
      shot('dialog-revoke', 400, { maxHeight: 520 })
    ]
  }
]

// --- Static server and Chrome ---

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
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
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

// --- Snippets that run in the page ---

// Resolves when the pane has drawn its first answer and the layout is quiet.
const SETTLED = `
  new Promise(resolve => {
    const deadline = performance.now() + 8000
    const ready = () => document.querySelector('.sf-steps, .sf-failed, .sf-loading')
    const tick = () => {
      if (ready() || performance.now() > deadline) {
        document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Boolean(ready())))))
      } else {
        setTimeout(tick, 30)
      }
    }
    tick()
  })
`

// Sizes the frame so that nothing inside the pane scrolls (or to the given cap), and reports the
// size of the caption plus frame.
const fit = cap => `
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
      height += scroll.querySelector('.sf-failed, .sf-loading') ? 360 : inner + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    }
    height = Math.ceil(${cap ? `Math.min(height, ${cap})` : 'height'})
    frame.style.height = height + 'px'
    const box = document.getElementById('shot').getBoundingClientRect()
    return { width: Math.round(box.width), height: Math.ceil(box.height) }
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

// Empties every enabled text field of the pane, the way a user would.
const CLEAR_FIELDS = `
  (() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const input of document.querySelectorAll('.sf-root input:not([disabled])')) {
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })()
`

// --- PNG in and out ---

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Decodes an 8-bit RGB or RGBA PNG (what Chrome writes) to { width, height, rgba }. */
function decodePng(file) {
  let offset = 8
  let header = null
  const data = []
  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('latin1', offset + 4, offset + 8)
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] }
    else if (type === 'IDAT') data.push(body)
    offset += length + 12
  }
  if (!header || header.depth !== 8 || (header.color !== 2 && header.color !== 6) || header.interlace !== 0) {
    throw new Error('unexpected PNG layout from Chrome')
  }
  const { width, height } = header
  const bpp = header.color === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(data))
  const rgba = Buffer.alloc(width * height * 4, 255)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0
      const up = previous[x]
      const upLeft = x >= bpp ? previous[x - bpp] : 0
      let add = 0
      if (filter === 1) add = left
      else if (filter === 2) add = up
      else if (filter === 3) add = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      row[x] = (row[x] + add) & 255
    }
    for (let x = 0; x < width; x++) {
      rgba[(y * width + x) * 4] = row[x * bpp]
      rgba[(y * width + x) * 4 + 1] = row[x * bpp + 1]
      rgba[(y * width + x) * 4 + 2] = row[x * bpp + 2]
    }
    previous = row
  }
  return { width, height, rgba }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function chunk(type, body) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  let crc = 0xffffffff
  for (const byte of head.subarray(4)) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
  return Buffer.concat([head, body, tail])
}

/**
 * Encodes RGBA pixels as a palette PNG of at most 256 colours. Colours are grouped at five bits per
 * channel. The most used groups make up most of the palette, and the rest of it goes to the groups
 * furthest from what is already there, so a small accent (a status dot, a range marker) keeps its hue.
 */
function encodePalettePng({ width, height, rgba }) {
  const groups = new Map()
  const keys = new Uint16Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    keys[i] = key
    const group = groups.get(key)
    if (group) {
      group.n += 1
      group.r += r
      group.g += g
      group.b += b
    } else groups.set(key, { key, n: 1, r, g, b })
  }
  const all = [...groups.values()].sort((a, b) => b.n - a.n)
  for (const group of all) {
    group.r = Math.round(group.r / group.n)
    group.g = Math.round(group.g / group.n)
    group.b = Math.round(group.b / group.n)
  }
  const distance = (a, b) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
  const palette = all.slice(0, 208)
  const rest = all.slice(208)
  const gap = rest.map(group => palette.reduce((best, entry) => Math.min(best, distance(group, entry)), Infinity))
  while (palette.length < 256 && rest.length > 0) {
    let pick = 0
    for (let i = 1; i < rest.length; i++) if (gap[i] * Math.log2(2 + rest[i].n) > gap[pick] * Math.log2(2 + rest[pick].n)) pick = i
    if (gap[pick] === 0) break
    const [chosen] = rest.splice(pick, 1)
    gap.splice(pick, 1)
    palette.push(chosen)
    for (let i = 0; i < rest.length; i++) gap[i] = Math.min(gap[i], distance(rest[i], chosen))
  }
  const indexOf = new Uint8Array(1 << 15)
  for (const group of all) {
    let best = 0
    for (let i = 1; i < palette.length; i++) if (distance(group, palette[i]) < distance(group, palette[best])) best = i
    indexOf[group.key] = best
  }
  const rows = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = indexOf[keys[y * width + x]]
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 3, 0, 0, 0], 8)
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from(palette.flatMap(entry => [entry.r, entry.g, entry.b]))),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Lays captures out in a row on a flat background. */
function compose(images, gap = 12) {
  const width = images.reduce((sum, image) => sum + image.width, gap * (images.length + 1))
  const height = Math.max(...images.map(image => image.height)) + gap * 2
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) rgba.set([96, 100, 108, 255], i * 4)
  let left = gap
  for (const image of images) {
    for (let y = 0; y < image.height; y++) {
      image.rgba.copy(rgba, ((y + gap) * width + left) * 4, y * image.width * 4, (y + 1) * image.width * 4)
    }
    left += image.width + gap
  }
  return { width, height, rgba }
}

// --- Capture ---

async function main() {
  execFileSync(process.execPath, [path.join(paneDir, 'build.mjs'), '--dev'], { stdio: 'inherit' })
  await mkdir(outDir, { recursive: true })

  const server = await serve()
  const origin = `http://127.0.0.1:${server.address().port}`
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'sf-pane-shots-'))
  const { chrome, endpoint } = await launch(profileDir)
  const cdp = await connect(endpoint)

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

    /** Captures one fixture or scene and returns the PNG bytes with their size in CSS pixels. */
    const capture = async ({ id, width, theme, maxHeight }, scale) => {
      const scene = SCENES[id]
      const viewport = height => page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
      await viewport(800)
      const loaded = cdp.once('Page.loadEventFired')
      await page('Page.navigate', { url: `${origin}/?shot=1&fixture=${scene?.fixture ?? id}&width=${width}&theme=${theme}` })
      await loaded
      if (!(await evaluate(SETTLED))) throw new Error(`${id} never rendered`)
      if (scene?.waitFor) await evaluate(waitForSelector(scene.waitFor))
      if (scene?.clear) await evaluate(CLEAR_FIELDS)
      for (const text of scene?.click ?? []) {
        if (!(await evaluate(clickByText(text)))) throw new Error(`${id}: no "${text}" button`)
        await evaluate(SETTLED)
      }
      // Twice: the first pass can change wrapping (and so heights) once the viewport follows.
      const cap = maxHeight ?? (scene && !scene.full ? 760 : null)
      let size = await evaluate(fit(cap))
      for (let pass = 0; pass < 2; pass++) {
        await viewport(size.height)
        await evaluate(SETTLED)
        size = await evaluate(fit(cap))
      }
      const { data } = await page('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
        captureBeyondViewport: true
      })
      return Buffer.from(data, 'base64')
    }

    if (EACH) {
      const ids = [...CORE, ...EXTRAS, ...Object.keys(SCENES)].filter(id => !only || only.includes(id))
      for (const id of ids) {
        for (const width of [400, 480]) {
          const file = path.join(outDir, `${id}-${width}.png`)
          await writeFile(file, await capture(shot(id, width), 2))
          console.log(`  ${path.basename(file)}`)
        }
      }
      console.log(`${ids.length * 2} screenshots in ${outDir}`)
      return
    }

    for (const sheet of SHEETS.filter(s => !only || only.some(name => s.file.startsWith(name)))) {
      const images = []
      for (const item of sheet.shots) images.push(decodePng(await capture(item, 1)))
      const png = encodePalettePng(compose(images))
      await writeFile(path.join(outDir, sheet.file), png)
      console.log(`  ${sheet.file}  ${sheet.shots.length} captures  ${Math.round(png.length / 1024)} KB`)
    }
  } finally {
    cdp.close()
    chrome.kill()
    server.close()
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

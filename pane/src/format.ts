// Pure formatting helpers. Amounts stay decimal strings end to end: nothing here goes through a float
// except the position marker, which is only a drawing.

export const ELLIPSIS = '…'

/** 0x1234abcd...ef12 style middle truncation for hashes and addresses. */
export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 2 ? value.slice(0, head) + ELLIPSIS + value.slice(-tail) : value
}

// --- Decimal strings ---

const DECIMAL_RE = /^(\d*)(?:\.(\d*))?$/

interface Dec {
  digits: bigint
  scale: number
}

function parseDec(value: string): Dec | null {
  const m = DECIMAL_RE.exec(value.trim())
  if (!m) return null
  const whole = m[1] ?? ''
  const frac = m[2] ?? ''
  if (whole === '' && frac === '') return null
  return { digits: BigInt((whole || '0') + frac), scale: frac.length }
}

export const isDecimal = (value: string): boolean => parseDec(value) !== null

export function isPositive(value: string): boolean {
  const d = parseDec(value)
  return d !== null && d.digits > 0n
}

/** Digits after the decimal point, ignoring trailing zeros. -1 when the text is not a decimal. */
export function fractionDigits(value: string): number {
  const m = DECIMAL_RE.exec(value.trim())
  if (!m || ((m[1] ?? '') === '' && (m[2] ?? '') === '')) return -1
  return (m[2] ?? '').replace(/0+$/, '').length
}

/** -1, 0 or 1, or null when either side is not a plain decimal. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseDec(a)
  const y = parseDec(b)
  if (!x || !y) return null
  const scale = Math.max(x.scale, y.scale)
  const xs = x.digits * 10n ** BigInt(scale - x.scale)
  const ys = y.digits * 10n ** BigInt(scale - y.scale)
  return xs === ys ? 0 : xs < ys ? -1 : 1
}

/**
 * Shortens a long fraction for display by cutting digits, never rounding up, and groups a long
 * whole part. The caller keeps the full value in a title.
 */
export function displayAmount(value: string): string {
  const m = DECIMAL_RE.exec(value.trim())
  if (!m || ((m[1] ?? '') === '' && (m[2] ?? '') === '')) return value
  const whole = (m[1] ?? '').replace(/^0+(?=\d)/, '') || '0'
  let frac = m[2] ?? ''
  const leadingZeros = /^0*/.exec(frac)?.[0].length ?? 0
  const keep = whole === '0' ? Math.min(18, Math.max(6, leadingZeros + 4)) : 6
  if (frac.length > keep) frac = frac.slice(0, keep)
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole
  return frac ? `${grouped}.${frac}` : grouped
}

// --- Time ---

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** Milliseconds from an ISO string, or null. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function span(ms: number): string {
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (ms < HOUR) return count(Math.max(1, Math.round(ms / MINUTE)), 'minute')
  if (ms < 2 * DAY) return count(Math.round(ms / HOUR), 'hour')
  return count(Math.round(ms / DAY), 'day')
}

/** "just now", "5 minutes ago", "in 30 days". Coarse on purpose so it does not tick while polling. */
export function relativeTime(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs
  if (Math.abs(diff) < MINUTE) return diff > 0 ? 'in under a minute' : 'just now'
  return diff > 0 ? `in ${span(diff)}` : `${span(-diff)} ago`
}

/** For a moment that should be in the past: a clock a little ahead of ours still reads "just now". */
export const timeAgo = (thenMs: number, nowMs: number): string => relativeTime(Math.min(thenMs, nowMs), nowMs)

let dateFormat: Intl.DateTimeFormat | null = null
let dateTimeFormat: Intl.DateTimeFormat | null = null

/** "10 Dec 2026" in the user's locale. */
export function formatDate(ms: number): string {
  dateFormat ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
  return dateFormat.format(ms)
}

/** "10 Dec 2026, 14:00" in the user's locale. */
export function formatDateTime(ms: number): string {
  dateTimeFormat ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return dateTimeFormat.format(ms)
}

// --- Position marker ---

/**
 * Where the current price sits between the bounds, 0 at the lower and 1 at the upper, on a log scale
 * (V3 ticks are logarithmic). Below 0 or above 1 means out of range. Null when the bounds do not
 * describe a finite range.
 */
export function rangePosition(lower: string, upper: string, current: string): number | null {
  const lo = Number(lower)
  const hi = Number(upper)
  const cur = Number(current)
  if (![lo, hi, cur].every(n => Number.isFinite(n) && n > 0) || hi <= lo) return null
  return (Math.log(cur) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
}

// --- URLs ---

function parseUrl(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** Only http and https links can be opened from the pane. */
export function isWebUrl(value: string | null | undefined): value is string {
  const url = parseUrl(value)
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:')
}

/** The passkey page is served by the plugin on this machine, so only a loopback URL opens unasked. */
export function isLoopbackUrl(value: string | null | undefined): value is string {
  const url = parseUrl(value)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return false
  const host = url.hostname.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
}

/** A 20-byte hex address. The backend checks it properly; this only catches typos early. */
export const isAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value.trim())

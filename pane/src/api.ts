// The only door to the backend: ctx.rest, which resolves parsed JSON and rejects with
// Error('<status>: <body>') on an HTTP error. Every route answers 200 with an ok/error envelope.

import type { PluginContext } from '@hermes/plugin-sdk'

import { ELLIPSIS } from './format'

/** /state and /grant read chains, so they get the long deadline. */
export const SLOW_TIMEOUT_MS = 25000

export class ApiError extends Error {
  readonly code: string
  /** HTTP status when the request itself failed, otherwise null. */
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }

  /** The caller is not the local Desktop app. Nothing in the pane can fix that. */
  get forbidden(): boolean {
    return this.status === 403
  }
}

const MAX_DETAIL = 280

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? flat.slice(0, MAX_DETAIL - 1) + ELLIPSIS : flat
}

/** Pulls a readable line out of an HTTP error body: our envelope, FastAPI's `detail`, or the text. */
function bodyDetail(body: string): string {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: unknown }; detail?: unknown; message?: unknown }
      const candidate = parsed.error?.message ?? parsed.detail ?? parsed.message
      if (typeof candidate === 'string' && candidate.trim()) return clip(candidate)
    } catch {
      // Not JSON after all: fall through to the raw text.
    }
  }
  return clip(trimmed)
}

function httpError(status: number, body: string): ApiError {
  const detail = bodyDetail(body)
  if (status === 403) {
    return new ApiError(
      'forbidden',
      'The wallet backend only answers Hermes Desktop running on this computer.',
      status
    )
  }
  if (status === 404) {
    return new ApiError(
      'not_found',
      'The Sovereign Finance backend is not mounted. Enable the plugin for this profile, then restart the gateway.',
      status
    )
  }
  return new ApiError('http_' + status, detail ? `The backend answered ${status}: ${detail}` : `The backend answered ${status}.`, status)
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const raw = err instanceof Error ? err.message : String(err)
  // The status can sit behind an IPC prefix, so look for "<status>: " anywhere in the message.
  const http = /(?:^|\s)([1-5]\d\d):\s?([\s\S]*)$/.exec(raw)
  if (http) return httpError(Number(http[1]), http[2] ?? '')
  if (/timed out/i.test(raw)) return new ApiError('timeout', 'The backend did not answer in time.')
  return new ApiError('unreachable', clip(raw) || 'The backend could not be reached.')
}

interface Envelope {
  ok?: unknown
  data?: unknown
  error?: { code?: unknown; message?: unknown } | null
}

function unwrap(res: unknown): unknown {
  const env = res !== null && typeof res === 'object' ? (res as Envelope) : null
  if (env && env.ok === true) return env.data
  if (env && env.ok === false) {
    const code = typeof env.error?.code === 'string' && env.error.code ? env.error.code : 'error'
    const message = typeof env.error?.message === 'string' ? env.error.message.trim() : ''
    throw new ApiError(code, message || `The backend refused the request (${code}).`)
  }
  throw new ApiError('bad_response', 'The backend sent a response the pane cannot read.')
}

export interface Api {
  get: (path: string, timeoutMs?: number) => Promise<unknown>
  post: (path: string, body: object, timeoutMs?: number) => Promise<unknown>
}

export function createApi(ctx: PluginContext): Api {
  const call = async (path: string, init: { method?: string; body?: object; timeoutMs?: number }) => {
    let res: unknown
    try {
      res = await ctx.rest<unknown>(path, init)
    } catch (err) {
      throw toApiError(err)
    }
    return unwrap(res)
  }
  return {
    get: (path, timeoutMs) => call(path, timeoutMs ? { timeoutMs } : {}),
    post: (path, body, timeoutMs) => call(path, timeoutMs ? { method: 'POST', body, timeoutMs } : { method: 'POST', body })
  }
}

export function errorText(err: unknown): string {
  return toApiError(err).message
}

// The only code that talks to Vapi. Every request goes through the gate, to one fixed origin,
// with no redirects, a timeout, a response-size cap, a concurrency cap and 429 backoff. The key is
// read per request and only ever placed in the Authorization header.
import { VapiError, type VapiErrorCode } from '../shared/errors.ts'
import { assertAllowed, type GatedRequest } from './gate.ts'
import { Limiter } from './limiter.ts'
import type { NetworkLog } from './network-log.ts'

export const VAPI_ORIGIN = 'https://api.vapi.ai'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type VapiClientOptions = {
  getKey: () => Promise<string | null>
  fetch?: FetchLike
  log?: NetworkLog
  timeoutMs?: number
  maxBytes?: number
  maxConcurrent?: number
  maxRetries?: number
  maxRetryWaitMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 4 * 1024 * 1024,
  maxConcurrent: 2,
  maxRetries: 2,
  maxRetryWaitMs: 10_000
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Builds the URL from the fixed origin and a gated path; refuses anything that escapes it. */
export function buildUrl(request: GatedRequest): URL {
  const url = new URL(request.path, VAPI_ORIGIN)
  if (url.origin !== VAPI_ORIGIN || url.pathname !== request.path) {
    throw new VapiError('blocked_by_gate')
  }
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, String(value))
  }
  return url
}

function statusError(status: number, retryAfterMs?: number): VapiError {
  const code: VapiErrorCode =
    status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 429
            ? 'rate_limited'
            : status >= 500
              ? 'server_error'
              : 'bad_response'
  return retryAfterMs === undefined
    ? new VapiError(code, { status })
    : new VapiError(code, { status, retryAfterMs })
}

/** `Retry-After` as seconds or an HTTP date, in ms; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/** Drops a body we will not read; a no-op once it has been read or is being read. */
async function discard(response: Response): Promise<void> {
  if (response.body && !response.body.locked && !response.bodyUsed) {
    await response.body.cancel().catch(() => {})
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response)
    throw new VapiError('too_large')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new VapiError('too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Vapi answers 400 when a date filter reaches past the plan's call-history retention. The body
 *  is only inspected here, capped, and never forwarded. */
async function isRetentionLimit(response: Response): Promise<boolean> {
  try {
    const text = await readCapped(response, 4096)
    return /retention window|call history/i.test(text)
  } catch {
    return false
  }
}

export class VapiClient {
  readonly #getKey: () => Promise<string | null>
  readonly #fetch: FetchLike
  readonly #log: NetworkLog | undefined
  readonly #limiter: Limiter
  readonly #sleep: (ms: number) => Promise<void>
  readonly #now: () => number
  readonly #timeoutMs: number
  readonly #maxBytes: number
  readonly #maxRetries: number
  readonly #maxRetryWaitMs: number

  constructor(options: VapiClientOptions) {
    this.#getKey = options.getKey
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
    this.#log = options.log
    this.#limiter = new Limiter(options.maxConcurrent ?? DEFAULTS.maxConcurrent)
    this.#sleep = options.sleep ?? defaultSleep
    this.#now = options.now ?? Date.now
    this.#timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
    this.#maxBytes = options.maxBytes ?? DEFAULTS.maxBytes
    this.#maxRetries = options.maxRetries ?? DEFAULTS.maxRetries
    this.#maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULTS.maxRetryWaitMs
  }

  /** Sends one gated request and answers the parsed JSON body. */
  async request<T = unknown>(request: GatedRequest, signal?: AbortSignal): Promise<T> {
    assertAllowed(request)
    const url = buildUrl(request)
    const key = await this.#getKey()
    if (!key) throw new VapiError('not_connected')

    return this.#limiter.run(async () => {
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw new VapiError('cancelled')
        try {
          return (await this.#attempt(request, url, key, attempt, signal)) as T
        } catch (error) {
          if (
            error instanceof VapiError &&
            error.code === 'rate_limited' &&
            attempt < this.#maxRetries
          ) {
            const wait = Math.min(error.retryAfterMs ?? 1000 * 2 ** attempt, this.#maxRetryWaitMs)
            await this.#sleep(wait)
            continue
          }
          throw error
        }
      }
    })
  }

  async #attempt(
    request: GatedRequest & { method: string },
    url: URL,
    key: string,
    attempt: number,
    signal: AbortSignal | undefined
  ): Promise<unknown> {
    const started = this.#now()
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: 'error',
      cache: 'no-store',
      signal: combined
    }
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(request.body)
    }

    let status: number | null = null
    let outcome: 'ok' | VapiErrorCode = 'ok'
    try {
      let response: Response
      try {
        response = await this.#fetch(url.href, init)
      } catch {
        if (signal?.aborted) throw new VapiError('cancelled')
        if (timeout.aborted) throw new VapiError('timeout')
        throw new VapiError('network')
      }
      status = response.status
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        await discard(response)
        throw new VapiError('blocked_by_gate', { status })
      }
      if (!response.ok) {
        if (response.status === 400 && (await isRetentionLimit(response))) {
          throw new VapiError('plan_limit', { status })
        }
        await discard(response)
        throw statusError(
          response.status,
          parseRetryAfter(response.headers.get('retry-after'), this.#now())
        )
      }
      let text: string
      try {
        text = await readCapped(response, this.#maxBytes)
      } catch (error) {
        if (error instanceof VapiError) throw error
        if (signal?.aborted) throw new VapiError('cancelled')
        if (timeout.aborted) throw new VapiError('timeout')
        throw new VapiError('network')
      }
      if (text === '') return null
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new VapiError('bad_response', { status })
      }
    } catch (error) {
      outcome = error instanceof VapiError ? error.code : 'internal'
      throw error
    } finally {
      this.#log?.add({
        at: new Date(started).toISOString(),
        method: request.method,
        path: request.path,
        queryKeys: Object.keys(request.query ?? {}),
        status,
        outcome,
        ms: Math.max(0, this.#now() - started),
        attempt
      })
    }
  }
}

// Calls: paged lists (newest first, windowed by createdAt) and single-call detail.
import { VapiError } from '../shared/errors.ts'
import { CALL_RANGES, type CallDetail, type CallPage, type CallRange, type CallSummary } from '../shared/protocol.ts'
import type { TtlCache } from './cache.ts'
import { callDetail, summarizeCall } from './call-parse.ts'
import type { QueryValue } from './gate.ts'
import type { VapiClient } from './http.ts'
import type { Resources } from './resources.ts'

export const PAGE_SIZE = 50

const RANGE_MS: Record<Exclude<CallRange, 'all'>, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000
}

export type CallListInput = { assistantId?: unknown; range?: unknown; before?: unknown; refresh?: unknown }

function isRange(value: unknown): value is CallRange {
  return typeof value === 'string' && (CALL_RANGES as readonly string[]).includes(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

export class Calls {
  readonly #client: VapiClient
  readonly #cache: TtlCache<unknown>
  readonly #resources: Resources
  readonly #now: () => number

  constructor(client: VapiClient, cache: TtlCache<unknown>, resources: Resources, now: () => number = Date.now) {
    this.#client = client
    this.#cache = cache
    this.#resources = resources
    this.#now = now
  }

  /** Assistant id → name, from the (cached) assistant list; empty if that fails. */
  async #names(signal?: AbortSignal): Promise<Map<string, string>> {
    try {
      const list = await this.#resources.list('assistant', false, signal)
      return new Map(list.items.map((item) => [item.id, item.name]))
    } catch {
      return new Map()
    }
  }

  async list(input: CallListInput, signal?: AbortSignal): Promise<CallPage> {
    const range = input.range ?? '7d'
    if (!isRange(range)) throw new VapiError('blocked_by_gate')
    if (input.assistantId !== undefined && typeof input.assistantId !== 'string') {
      throw new VapiError('blocked_by_gate')
    }
    if (input.before !== undefined && !isIsoDate(input.before)) throw new VapiError('blocked_by_gate')

    const query: Record<string, QueryValue> = { limit: PAGE_SIZE }
    if (input.assistantId) query.assistantId = input.assistantId
    if (input.before) query.createdAtLt = input.before
    if (range !== 'all') query.createdAtGt = new Date(this.#now() - RANGE_MS[range]).toISOString()

    const key = `calls:${JSON.stringify({ ...query, createdAtGt: range })}`
    if (input.refresh === true) this.#cache.delete(key)
    const cached = this.#cache.get(key) as CallPage | undefined
    if (cached) return cached

    const raw = await this.#client.request({ method: 'GET', path: '/call', query }, signal)
    if (!Array.isArray(raw)) throw new VapiError('bad_response')
    const names = await this.#names(signal)
    const items = raw
      .map((call) => summarizeCall(call, names))
      .filter((call): call is CallSummary => call !== null)
    const last = items.at(-1)
    const page: CallPage = {
      items,
      nextBefore: raw.length >= PAGE_SIZE && last ? last.createdAt : null,
      fetchedAt: new Date(this.#now()).toISOString()
    }
    this.#cache.set(key, page)
    return page
  }

  async get(id: unknown, signal?: AbortSignal): Promise<CallDetail> {
    if (typeof id !== 'string') throw new VapiError('blocked_by_gate')
    const key = `call:${id}`
    const cached = this.#cache.get(key) as CallDetail | undefined
    if (cached) return cached
    const raw = await this.#client.request({ method: 'GET', path: `/call/${id}` }, signal)
    const detail = callDetail(raw, await this.#names(signal))
    if (!detail) throw new VapiError('bad_response')
    this.#cache.set(key, detail)
    return detail
  }
}

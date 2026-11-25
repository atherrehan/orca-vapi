// Assistants, squads, tools and phone numbers: list summaries and redacted details.
import { VapiError } from '../shared/errors.ts'
import {
  RESOURCE_KINDS,
  type ResourceDetail,
  type ResourceKind,
  type ResourceList,
  type ResourceSummary
} from '../shared/protocol.ts'
import type { TtlCache } from './cache.ts'
import type { VapiClient } from './http.ts'
import { redact } from './redact.ts'

export const LIST_LIMIT = 100
const MAX_TEXT = 200

type Raw = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : undefined
}

function record(value: unknown): Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

function joined(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join(' · ')
}

function slash(a: unknown, b: unknown): string | undefined {
  const left = text(a)
  const right = text(b)
  return left && right ? `${left}/${right}` : (left ?? right)
}

const NAMERS: Record<ResourceKind, (raw: Raw) => { name: string; subtitle: string }> = {
  assistant: (raw) => {
    const model = record(raw.model)
    const voice = record(raw.voice)
    return {
      name: text(raw.name) ?? 'Unnamed assistant',
      subtitle: joined(slash(model.provider, model.model), slash(voice.provider, voice.voiceId))
    }
  },
  squad: (raw) => {
    const members = Array.isArray(raw.members) ? raw.members.length : 0
    return {
      name: text(raw.name) ?? 'Unnamed squad',
      subtitle: `${members} member${members === 1 ? '' : 's'}`
    }
  },
  tool: (raw) => {
    const fn = record(raw.function)
    return {
      name: text(fn.name) ?? text(raw.name) ?? text(raw.type) ?? 'Unnamed tool',
      subtitle: joined(text(raw.type), text(fn.description))
    }
  },
  'phone-number': (raw) => {
    const number = text(raw.number) ?? text(raw.sipUri)
    return {
      name: number ?? text(raw.name) ?? 'Unnamed number',
      subtitle: joined(text(raw.provider), number ? text(raw.name) : undefined)
    }
  }
}

export function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && (RESOURCE_KINDS as readonly string[]).includes(value)
}

export function summarize(kind: ResourceKind, value: unknown): ResourceSummary | null {
  const raw = record(value)
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    ...NAMERS[kind](raw),
    updatedAt: text(raw.updatedAt) ?? text(raw.createdAt) ?? null
  }
}

export class Resources {
  readonly #client: VapiClient
  readonly #cache: TtlCache<unknown>
  readonly #now: () => number

  constructor(client: VapiClient, cache: TtlCache<unknown>, now: () => number = Date.now) {
    this.#client = client
    this.#cache = cache
    this.#now = now
  }

  async list(kind: unknown, refresh = false, signal?: AbortSignal): Promise<ResourceList> {
    if (!isResourceKind(kind)) throw new VapiError('blocked_by_gate')
    const key = `list:${kind}`
    if (refresh) this.#cache.delete(key)
    const cached = this.#cache.get(key) as ResourceList | undefined
    if (cached) return cached

    const raw = await this.#client.request(
      { method: 'GET', path: `/${kind}`, query: { limit: LIST_LIMIT } },
      signal
    )
    if (!Array.isArray(raw)) throw new VapiError('bad_response')
    const items = raw
      .map((item) => summarize(kind, item))
      .filter((item): item is ResourceSummary => item !== null)
    const list: ResourceList = {
      kind,
      items,
      fetchedAt: new Date(this.#now()).toISOString(),
      truncated: raw.length >= LIST_LIMIT
    }
    this.#cache.set(key, list)
    return list
  }

  async get(kind: unknown, id: unknown, signal?: AbortSignal): Promise<ResourceDetail> {
    if (!isResourceKind(kind) || typeof id !== 'string') throw new VapiError('blocked_by_gate')
    const key = `item:${kind}:${id}`
    const cached = this.#cache.get(key) as ResourceDetail | undefined
    if (cached) return cached

    const raw = await this.#client.request({ method: 'GET', path: `/${kind}/${id}` }, signal)
    const summary = summarize(kind, raw)
    if (!summary) throw new VapiError('bad_response')
    const { data, count } = redact(raw)
    const detail: ResourceDetail = { kind, summary, data, redacted: count }
    this.#cache.set(key, detail)
    return detail
  }
}

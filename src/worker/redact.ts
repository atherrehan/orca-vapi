// Strips secrets out of Vapi configs before anything reaches the panel. Assistants, tools and
// phone numbers can hold webhook secrets, auth headers, provider tokens (Twilio, Vonage, ...) and
// credential references; the panel only ever sees `[redacted]` in their place.
import type { Json } from '../shared/protocol.ts'
import { scrub } from './scrub.ts'

export const REDACTED = '[redacted]'

const MAX_DEPTH = 64

/** Key endings that hold secret values, compared without case, `-` or `_`. */
const SENSITIVE_SUFFIXES = [
  'secret',
  'password',
  'passwd',
  'apikey',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'privatekey',
  'signingkey',
  'authorization',
  'credentialid',
  'credentialids',
  'credentials',
  'cookie'
]

/** Whole keys that are secret on their own. A bare `key` is not: Vapi uses it for things like
 *  transcriber context terms, and names real secrets `apiKey`, `privateKey` and so on. */
const SENSITIVE_KEYS = new Set(['token', 'auth', 'bearer', 'jwt', 'pin'])

/** Query parameters kept visible: names ending in `id` whose value is ID-shaped, such as
 *  `tenantId=42`. Every other query value is treated as a possible token. */
const ID_PARAM = /id$/i
const ID_VALUE = /^[A-Za-z0-9_-]{1,64}$/

function keepQueryValue(name: string, value: string): boolean {
  return ID_PARAM.test(name) && !isSensitiveKey(name) && ID_VALUE.test(value)
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '')
  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_SUFFIXES.some((s) => normalized.endsWith(s))
}

type Counter = { count: number }

/** Drops user:password@ and blanks query values, which often carry tokens. */
function sanitizeUrl(value: string, counter: Counter): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  let changed = false
  if (url.username || url.password) {
    url.username = ''
    url.password = ''
    changed = true
  }
  for (const [name, value] of [...url.searchParams.entries()]) {
    if (keepQueryValue(name, value)) continue
    url.searchParams.set(name, 'redacted')
    changed = true
  }
  if (!changed) return value
  counter.count++
  return url.toString()
}

/** Any URL inside a string, including one in the middle of a sentence. */
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi

function redactString(value: string, counter: Counter): string {
  const scrubbed = scrub(value)
  if (scrubbed !== value) counter.count++
  return scrubbed.replace(URL_IN_TEXT, (url) => sanitizeUrl(url, counter))
}

function walk(value: unknown, key: string | null, depth: number, counter: Counter): Json {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return null
  if (key !== null && isSensitiveKey(key) && value !== null && value !== '') {
    counter.count++
    return REDACTED
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return redactString(value, counter)
  if (depth >= MAX_DEPTH) return '[too deep]'

  if (Array.isArray(value)) return value.map((item) => walk(item, null, depth + 1, counter))

  const out: { [key: string]: Json } = {}
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (key !== null && key.toLowerCase() === 'headers' && childValue !== null) {
      counter.count++
      out[childKey] = REDACTED
      continue
    }
    out[childKey] = walk(childValue, childKey, depth + 1, counter)
  }
  return out
}

/** A redacted, JSON-safe copy and how many values were replaced. */
export function redact(value: unknown): { data: Json; count: number } {
  const counter: Counter = { count: 0 }
  const data = walk(value, null, 0, counter)
  return { data, count: counter.count }
}

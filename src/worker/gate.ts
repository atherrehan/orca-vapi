// The request gate: the single choke point every Vapi request passes. It allows only GET on a
// fixed list of read endpoints, plus POST /analytics (a read-only aggregation query). Anything
// else, including every PUT, PATCH and DELETE, is refused before a connection is made.
import { VapiError } from '../shared/errors.ts'

export type HttpMethod = 'GET' | 'POST'
export type QueryValue = string | number

export type GatedRequest = {
  method: string
  path: string
  query?: Readonly<Record<string, QueryValue>>
  body?: unknown
}

type Route = {
  method: HttpMethod
  pattern: RegExp
  query: readonly string[]
  body: boolean
}

const ID = '[A-Za-z0-9-]{1,64}'
const LIST_QUERY = [
  'limit',
  'createdAtGt',
  'createdAtLt',
  'createdAtGe',
  'createdAtLe',
  'updatedAtGt',
  'updatedAtLt',
  'updatedAtGe',
  'updatedAtLe'
] as const

function list(resource: string, extraQuery: readonly string[] = []): Route {
  return {
    method: 'GET',
    pattern: new RegExp(`^/${resource}$`),
    query: [...LIST_QUERY, ...extraQuery],
    body: false
  }
}

function item(resource: string): Route {
  return { method: 'GET', pattern: new RegExp(`^/${resource}/${ID}$`), query: [], body: false }
}

export const ROUTES: readonly Route[] = Object.freeze([
  list('assistant'),
  item('assistant'),
  list('squad'),
  item('squad'),
  list('tool'),
  item('tool'),
  list('phone-number'),
  item('phone-number'),
  list('call', ['id', 'assistantId', 'phoneNumberId']),
  item('call'),
  { method: 'POST', pattern: /^\/analytics$/, query: [], body: true }
])

const SAFE_QUERY_VALUE = /^[A-Za-z0-9:.+_-]{1,64}$/

/** Throws `blocked_by_gate` unless the request is an allowed read. */
export function assertAllowed(request: GatedRequest): asserts request is GatedRequest & {
  method: HttpMethod
} {
  const route = ROUTES.find(
    (candidate) => candidate.method === request.method && candidate.pattern.test(request.path)
  )
  if (!route) throw new VapiError('blocked_by_gate')

  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (!route.query.includes(key)) throw new VapiError('blocked_by_gate')
    if (typeof value === 'number' ? !Number.isFinite(value) : !SAFE_QUERY_VALUE.test(value)) {
      throw new VapiError('blocked_by_gate')
    }
  }

  if (request.body !== undefined && !route.body) throw new VapiError('blocked_by_gate')
}

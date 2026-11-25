import { assert, test } from 'orca/testing'
import { TtlCache } from '../src/worker/cache.ts'
import { VapiClient, type FetchLike } from '../src/worker/http.ts'
import { InsightsService, buildQueries, parseInsights } from '../src/worker/insights.ts'
import { Resources } from '../src/worker/resources.ts'
import { VapiError } from '../src/shared/errors.ts'
import { ASSISTANT } from './fixtures/vapi.ts'

const NOW = Date.parse('2026-11-25T00:00:00.000Z')

/** Shaped like a real answer: counts as strings, aliases camelCased, duration in minutes. */
const ANALYTICS = [
  {
    name: 'totals',
    result: [
      { calls: '6', cost: 1.0936, avgDuration: 1.5, costLlm: 0.511, costStt: 0.0393, costTts: 0.0651, costVapi: 0.4781, costTransport: 0 }
    ]
  },
  {
    name: 'byAssistant',
    result: [
      { assistantId: 'asst-3333', calls: '1', cost: 0.2 },
      { assistantId: ASSISTANT.id, calls: '5', cost: 0.8936 }
    ]
  },
  {
    name: 'byEndedReason',
    result: [
      { endedReason: 'customer-ended-call', calls: '1' },
      { endedReason: 'assistant-request-returned-error', calls: '2' },
      { endedReason: 'assistant-said-end-call-phrase', calls: '3' }
    ]
  },
  {
    name: 'daily',
    result: [
      { date: '2026-11-24T00:00:00.000Z', calls: '1', cost: 0.1 },
      { date: '2026-11-20T00:00:00.000Z', calls: '5', cost: 0.9936 }
    ]
  }
]

test('queries: call table only, groupBy as arrays, camelCase aliases, given time range', () => {
  const body = buildQueries('2026-11-18T00:00:00.000Z', '2026-11-25T00:00:00.000Z') as {
    queries: { table: string; name: string; groupBy?: unknown; timeRange: Record<string, string>; operations: { alias: string }[] }[]
  }
  assert.deepEqual(
    body.queries.map((q) => q.name),
    ['totals', 'byAssistant', 'byEndedReason', 'daily']
  )
  for (const q of body.queries) {
    assert.equal(q.table, 'call')
    assert.equal(q.timeRange.start, '2026-11-18T00:00:00.000Z')
    if (q.groupBy !== undefined) assert.ok(Array.isArray(q.groupBy), `${q.name} groupBy must be an array`)
    for (const op of q.operations) assert.match(op.alias, /^[a-z][A-Za-z]*$/, op.alias)
  }
  assert.equal(body.queries[3]?.timeRange.step, 'day')
})

test('parse: string counts, minutes to seconds, names, sorting, cost lines adding up', () => {
  const insights = parseInsights(
    ANALYTICS,
    '7d',
    '2026-11-18T00:00:00.000Z',
    '2026-11-25T00:00:00.000Z',
    new Map([[ASSISTANT.id, 'Front Desk']]),
    '2026-11-25T00:00:00.000Z'
  )
  assert.deepEqual(insights.totals, { calls: 6, cost: 1.0936, avgDurationSec: 90 })
  assert.deepEqual(
    insights.costs.map((c) => c.label),
    ['Model (LLM)', 'Transcriber (STT)', 'Voice (TTS)', 'Vapi platform', 'Total']
  )
  const parts = insights.costs.filter((c) => c.label !== 'Total').reduce((sum, c) => sum + c.amount, 0)
  assert.ok(Math.abs(parts - 1.0935) < 0.0001)
  assert.deepEqual(
    insights.byAssistant.map((a) => [a.name, a.calls]),
    [
      ['Front Desk', 5],
      ['asst-333…', 1]
    ]
  )
  assert.deepEqual(
    insights.byEndedReason.map((r) => [r.reason, r.severity]),
    [
      ['assistant-said-end-call-phrase', 'ok'],
      ['assistant-request-returned-error', 'error'],
      ['customer-ended-call', 'ok']
    ]
  )
  assert.deepEqual(
    insights.daily.map((d) => d.date.slice(0, 10)),
    ['2026-11-20', '2026-11-24']
  )
})

test('parse: empty and odd answers', () => {
  const empty = parseInsights([], '24h', 'a', 'b', new Map(), 'c')
  assert.deepEqual(empty.totals, { calls: 0, cost: 0, avgDurationSec: null })
  assert.deepEqual(empty.costs, [{ label: 'Total', amount: 0 }])
  assert.throws(
    () => parseInsights({ not: 'a list' }, '24h', 'a', 'b', new Map(), 'c'),
    (error: unknown) => error instanceof VapiError && error.code === 'bad_response'
  )
})

function setup() {
  const requests: { url: URL; init: RequestInit }[] = []
  const fetch: FetchLike = async (raw, init) => {
    const url = new URL(raw)
    requests.push({ url, init })
    if (url.pathname === '/assistant') return new Response(JSON.stringify([ASSISTANT]))
    if (url.pathname === '/analytics') return new Response(JSON.stringify(ANALYTICS))
    return new Response('{}', { status: 404 })
  }
  const client = new VapiClient({ getKey: async () => 'k'.repeat(32), fetch })
  const cache = new TtlCache<unknown>(60_000, () => NOW)
  const service = new InsightsService(client, cache, new Resources(client, cache, () => NOW), () => NOW)
  return { service, requests }
}

test('service: one POST /analytics for the range, cached until refresh', async () => {
  const { service, requests } = setup()
  const insights = await service.get('7d')
  const posts = requests.filter((r) => r.url.pathname === '/analytics')
  assert.equal(posts.length, 1)
  assert.equal(posts[0]?.init.method, 'POST')
  const body = JSON.parse(String(posts[0]?.init.body)) as { queries: { timeRange: { start: string } }[] }
  assert.equal(body.queries[0]?.timeRange.start, '2026-11-18T00:00:00.000Z')
  assert.equal(insights.byAssistant[0]?.name, 'Front Desk')

  await service.get('7d')
  assert.equal(requests.filter((r) => r.url.pathname === '/analytics').length, 1)
  await service.get('7d', true)
  assert.equal(requests.filter((r) => r.url.pathname === '/analytics').length, 2)
})

test('service: unknown ranges are refused before any request', async () => {
  const { service, requests } = setup()
  for (const range of ['90d', '', null, 7]) {
    try {
      await service.get(range)
      assert.fail('expected a rejection')
    } catch (error) {
      assert.ok(error instanceof VapiError)
      assert.equal(error.code, 'blocked_by_gate')
    }
  }
  assert.equal(requests.length, 0)
})

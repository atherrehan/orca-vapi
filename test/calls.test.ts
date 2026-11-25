import { assert, test } from 'orca/testing'
import { TtlCache } from '../src/worker/cache.ts'
import { Calls, PAGE_SIZE } from '../src/worker/calls.ts'
import { VapiClient, type FetchLike } from '../src/worker/http.ts'
import { Resources } from '../src/worker/resources.ts'
import { VapiError } from '../src/shared/errors.ts'
import { CALL } from './fixtures/calls.ts'
import { ASSISTANT } from './fixtures/vapi.ts'

const NOW = Date.parse('2026-11-25T00:00:00.000Z')

function setup(callPage: unknown[] = [CALL], status = 200, body?: string) {
  const urls: URL[] = []
  const fetch: FetchLike = async (raw) => {
    const url = new URL(raw)
    urls.push(url)
    if (url.pathname === '/assistant') return new Response(JSON.stringify([ASSISTANT]))
    if (url.pathname === '/call') return new Response(body ?? JSON.stringify(callPage), { status })
    if (url.pathname === `/call/${CALL.id}`) return new Response(JSON.stringify(CALL))
    return new Response('{}', { status: 404 })
  }
  const client = new VapiClient({ getKey: async () => 'k'.repeat(32), fetch })
  const cache = new TtlCache<unknown>(60_000, () => NOW)
  const resources = new Resources(client, cache, () => NOW)
  return { calls: new Calls(client, cache, resources, () => NOW), urls }
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof VapiError)
    return error.code
  }
  throw new Error('expected a rejection')
}

test('7d range sends limit and createdAtGt; names come from the assistant list', async () => {
  const { calls, urls } = setup()
  const page = await calls.list({ range: '7d' })
  const callUrl = urls.find((url) => url.pathname === '/call')
  assert.equal(callUrl?.searchParams.get('limit'), String(PAGE_SIZE))
  assert.equal(callUrl?.searchParams.get('createdAtGt'), '2026-11-18T00:00:00.000Z')
  assert.equal(page.items[0]?.assistantName, 'Front Desk')
  assert.equal(page.nextBefore, null)
})

test('all-time sends no date filter; assistant and before are passed through', async () => {
  const { calls, urls } = setup()
  await calls.list({ range: 'all', assistantId: 'asst-1111-2222', before: '2026-11-20T00:00:00.000Z' })
  const callUrl = urls.find((url) => url.pathname === '/call')
  assert.equal(callUrl?.searchParams.get('createdAtGt'), null)
  assert.equal(callUrl?.searchParams.get('assistantId'), 'asst-1111-2222')
  assert.equal(callUrl?.searchParams.get('createdAtLt'), '2026-11-20T00:00:00.000Z')
})

test('a full page offers the last createdAt as the next cursor', async () => {
  const page = Array.from({ length: PAGE_SIZE }, (_, i) => ({
    ...CALL,
    id: `call-${i}`,
    createdAt: new Date(NOW - i * 60_000).toISOString()
  }))
  const { calls } = setup(page)
  const result = await calls.list({ range: '24h' })
  assert.equal(result.nextBefore, page.at(-1)?.createdAt)
})

test('call lists are cached; refresh refetches', async () => {
  const { calls, urls } = setup()
  await calls.list({ range: '7d' })
  await calls.list({ range: '7d' })
  await calls.list({ range: '7d', refresh: true })
  assert.equal(urls.filter((url) => url.pathname === '/call').length, 2)
})

test('a plan retention 400 becomes plan_limit; other 400s stay bad_response', async () => {
  const retention = setup(
    [],
    400,
    '{"message":"Your subscription plan only covers the last 14 days of call history. The requested start date exceeds your retention window.","statusCode":400}'
  )
  assert.equal(await code(retention.calls.list({ range: '30d' })), 'plan_limit')
  const other = setup([], 400, '{"message":"limit must not be greater than 1000"}')
  assert.equal(await code(other.calls.list({ range: '30d' })), 'bad_response')
})

test('bad inputs are refused before any request', async () => {
  const { calls, urls } = setup()
  assert.equal(await code(calls.list({ range: '90d' })), 'blocked_by_gate')
  assert.equal(await code(calls.list({ range: '7d', assistantId: 5 })), 'blocked_by_gate')
  assert.equal(await code(calls.list({ range: '7d', before: 'yesterday' })), 'blocked_by_gate')
  assert.equal(await code(calls.list({ range: '7d', assistantId: 'x&limit=1000' })), 'blocked_by_gate')
  assert.equal(await code(calls.get('../assistant')), 'blocked_by_gate')
  assert.equal(await code(calls.get(42)), 'blocked_by_gate')
  assert.equal(urls.filter((url) => url.pathname === '/call').length, 0)
})

test('get returns the parsed detail', async () => {
  const { calls } = setup()
  const detail = await calls.get(CALL.id)
  assert.equal(detail.summary.assistantName, 'Front Desk')
  assert.equal(detail.toolCalls.length, 3)
})

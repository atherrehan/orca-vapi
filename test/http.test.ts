import { assert, test } from 'orca/testing'
import { VapiClient, VAPI_ORIGIN, parseRetryAfter, type FetchLike } from '../src/worker/http.ts'
import { NetworkLog } from '../src/worker/network-log.ts'
import { VapiError, toPublicError } from '../src/shared/errors.ts'

const KEY = 'test-key-0123456789abcdef-SECRET'

type Call = { url: string; init: RequestInit }

function fakeFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init }
    calls.push(call)
    return handler(call, calls.length - 1)
  }
  return { fetch, calls }
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

function client(fetch: FetchLike, extra: Partial<ConstructorParameters<typeof VapiClient>[0]> = {}) {
  return new VapiClient({ getKey: async () => KEY, fetch, sleep: async () => {}, ...extra })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof VapiError, String(error))
    assert.ok(!JSON.stringify(toPublicError(error)).includes(KEY), 'key leaked into error')
    assert.ok(!(error as Error).message.includes(KEY), 'key leaked into message')
    return (error as VapiError).code
  }
  throw new Error('expected a rejection')
}

test('sends the key only to api.vapi.ai, with no redirects and no caching', async () => {
  const { fetch, calls } = fakeFetch(() => json([{ id: 'a1' }]))
  const result = await client(fetch).request({
    method: 'GET',
    path: '/call',
    query: { assistantId: 'a1', limit: 5 }
  })
  assert.deepEqual(result, [{ id: 'a1' }])
  assert.equal(calls.length, 1)
  const call = calls[0]!
  assert.equal(new URL(call.url).origin, VAPI_ORIGIN)
  assert.equal(call.url, `${VAPI_ORIGIN}/call?assistantId=a1&limit=5`)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.cache, 'no-store')
  assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`)
  assert.equal(call.init.body, undefined)
})

test('posts a JSON body only to /analytics', async () => {
  const { fetch, calls } = fakeFetch(() => json([]))
  await client(fetch).request({ method: 'POST', path: '/analytics', body: { queries: [] } })
  assert.equal(calls[0]!.init.body, '{"queries":[]}')
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>)['Content-Type'],
    'application/json'
  )
})

test('a blocked request never opens a connection or reads the key', async () => {
  let keyReads = 0
  const { fetch, calls } = fakeFetch(() => json({}))
  const c = client(fetch, {
    getKey: async () => {
      keyReads++
      return KEY
    }
  })
  assert.equal(await codeOf(c.request({ method: 'DELETE', path: '/assistant/a1' })), 'blocked_by_gate')
  assert.equal(await codeOf(c.request({ method: 'GET', path: '//evil.example/x' })), 'blocked_by_gate')
  assert.equal(calls.length, 0)
  assert.equal(keyReads, 0)
})

test('not_connected without a key, and no request is sent', async () => {
  const { fetch, calls } = fakeFetch(() => json({}))
  const c = client(fetch, { getKey: async () => null })
  assert.equal(await codeOf(c.request({ method: 'GET', path: '/assistant' })), 'not_connected')
  assert.equal(calls.length, 0)
})

test('maps HTTP statuses to typed errors without leaking bodies', async () => {
  const cases: [number, string][] = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [400, 'bad_response'],
    [500, 'server_error'],
    [503, 'server_error']
  ]
  for (const [status, code] of cases) {
    const { fetch } = fakeFetch(() => json({ message: `echo ${KEY}` }, { status }))
    assert.equal(await codeOf(client(fetch).request({ method: 'GET', path: '/assistant' })), code)
  }
})

test('a redirect is refused', async () => {
  const { fetch } = fakeFetch(
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
  )
  assert.equal(
    await codeOf(client(fetch).request({ method: 'GET', path: '/assistant' })),
    'blocked_by_gate'
  )
})

test('a network failure becomes `network`, even if the error text holds the key', async () => {
  const fetch: FetchLike = async () => {
    throw new TypeError(`fetch failed for Bearer ${KEY}`)
  }
  assert.equal(await codeOf(client(fetch).request({ method: 'GET', path: '/assistant' })), 'network')
})

test('retries 429 using Retry-After, then succeeds', async () => {
  const waits: number[] = []
  const { fetch, calls } = fakeFetch((_call, index) =>
    index === 0 ? json({}, { status: 429, headers: { 'retry-after': '2' } }) : json({ ok: true })
  )
  const result = await client(fetch, {
    sleep: async (ms) => {
      waits.push(ms)
    }
  }).request({ method: 'GET', path: '/assistant' })
  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 2)
  assert.deepEqual(waits, [2000])
})

test('gives up on 429 after the retry budget, capping the wait', async () => {
  const waits: number[] = []
  const { fetch, calls } = fakeFetch(() =>
    json({}, { status: 429, headers: { 'retry-after': '120' } })
  )
  const c = client(fetch, {
    maxRetries: 2,
    sleep: async (ms) => {
      waits.push(ms)
    }
  })
  assert.equal(await codeOf(c.request({ method: 'GET', path: '/assistant' })), 'rate_limited')
  assert.equal(calls.length, 3)
  assert.deepEqual(waits, [10_000, 10_000])
})

test('refuses responses over the size cap, declared or streamed', async () => {
  const declared = fakeFetch(
    () => new Response('{}', { headers: { 'content-length': String(10 * 1024 * 1024) } })
  )
  assert.equal(
    await codeOf(client(declared.fetch).request({ method: 'GET', path: '/assistant' })),
    'too_large'
  )

  const streamed = fakeFetch(() => new Response(JSON.stringify({ blob: 'x'.repeat(2048) })))
  assert.equal(
    await codeOf(
      client(streamed.fetch, { maxBytes: 1024 }).request({ method: 'GET', path: '/assistant' })
    ),
    'too_large'
  )
})

test('times out a request that never answers', async () => {
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  assert.equal(
    await codeOf(client(fetch, { timeoutMs: 20 }).request({ method: 'GET', path: '/assistant' })),
    'timeout'
  )
})

test('a caller abort becomes `cancelled`', async () => {
  const controller = new AbortController()
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      setTimeout(() => controller.abort(), 5)
    })
  assert.equal(
    await codeOf(client(fetch).request({ method: 'GET', path: '/assistant' }, controller.signal)),
    'cancelled'
  )
})

test('invalid JSON becomes `bad_response`', async () => {
  const { fetch } = fakeFetch(() => new Response('<html>oops</html>'))
  assert.equal(
    await codeOf(client(fetch).request({ method: 'GET', path: '/assistant' })),
    'bad_response'
  )
})

test('never runs more than two requests at once', async () => {
  let inFlight = 0
  let peak = 0
  const fetch: FetchLike = async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 10))
    inFlight--
    return json([])
  }
  const c = client(fetch)
  await Promise.all(Array.from({ length: 6 }, () => c.request({ method: 'GET', path: '/tool' })))
  assert.equal(peak, 2)
})

test('the network log keeps paths and query names, never values or the key', async () => {
  const log = new NetworkLog(10)
  const { fetch } = fakeFetch((_call, index) => (index === 0 ? json([]) : json({}, { status: 404 })))
  const c = client(fetch, { log })
  await c.request({ method: 'GET', path: '/call', query: { assistantId: 'secret-assistant-id' } })
  await codeOf(c.request({ method: 'GET', path: '/call/abc' }))
  const entries = log.recent()
  assert.equal(entries.length, 2)
  assert.equal(entries[0]!.outcome, 'not_found')
  assert.equal(entries[0]!.status, 404)
  assert.deepEqual(entries[1]!.queryKeys, ['assistantId'])
  const text = JSON.stringify(entries)
  assert.ok(!text.includes('secret-assistant-id'))
  assert.ok(!text.includes(KEY))
})

test('parses Retry-After as seconds or a date', () => {
  assert.equal(parseRetryAfter('3', 0), 3000)
  assert.equal(parseRetryAfter(null, 0), undefined)
  assert.equal(parseRetryAfter('soon', 0), undefined)
  const now = Date.parse('2026-11-24T08:00:00Z')
  assert.equal(parseRetryAfter('Tue, 24 Nov 2026 08:00:05 GMT', now), 5000)
})

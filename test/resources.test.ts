import { assert, test } from 'orca/testing'
import { TtlCache } from '../src/worker/cache.ts'
import { VapiClient, type FetchLike } from '../src/worker/http.ts'
import { LIST_LIMIT, Resources, summarize } from '../src/worker/resources.ts'
import { VapiError } from '../src/shared/errors.ts'
import { ASSISTANT, BY_PATH, PHONE_NUMBER, SECRETS, SQUAD, TOOL } from './fixtures/vapi.ts'

function setup(byPath: Record<string, unknown> = BY_PATH, now = () => 0) {
  const paths: string[] = []
  const fetch: FetchLike = async (url) => {
    const { pathname } = new URL(url)
    paths.push(`${pathname}${new URL(url).search}`)
    return pathname in byPath
      ? new Response(JSON.stringify(byPath[pathname]))
      : new Response('{}', { status: 404 })
  }
  const client = new VapiClient({ getKey: async () => 'k'.repeat(32), fetch })
  const cache = new TtlCache<unknown>(60_000, now)
  return { resources: new Resources(client, cache, now), paths, cache }
}

test('summaries for each kind', () => {
  assert.deepEqual(summarize('assistant', ASSISTANT), {
    id: ASSISTANT.id,
    name: 'Front Desk',
    subtitle: 'openai/gpt-4.1 · 11labs/rachel',
    updatedAt: ASSISTANT.updatedAt
  })
  assert.equal(summarize('squad', SQUAD)?.subtitle, '2 members')
  assert.equal(summarize('tool', TOOL)?.name, 'lookupBooking')
  assert.equal(summarize('tool', TOOL)?.subtitle, 'function · Find a booking by reference')
  assert.equal(summarize('phone-number', PHONE_NUMBER)?.name, '+61400000000')
  assert.equal(summarize('phone-number', PHONE_NUMBER)?.subtitle, 'twilio · Main line')
  assert.equal(summarize('assistant', { id: 'x', name: null })?.name, 'Unnamed assistant')
  assert.equal(summarize('assistant', { name: 'no id' }), null)
  assert.equal(summarize('assistant', 'garbage'), null)
})

test('list fetches page of 100, summarises, and never includes secrets', async () => {
  const { resources, paths } = setup()
  const list = await resources.list('assistant')
  assert.deepEqual(paths, [`/assistant?limit=${LIST_LIMIT}`])
  assert.equal(list.items.length, 2)
  assert.equal(list.truncated, false)
  const text = JSON.stringify(list)
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret)
})

test('list is cached until refresh', async () => {
  const { resources, paths } = setup()
  await resources.list('tool')
  await resources.list('tool')
  assert.equal(paths.length, 1)
  await resources.list('tool', true)
  assert.equal(paths.length, 2)
})

test('cache entries expire', async () => {
  let now = 0
  const { resources, paths } = setup(BY_PATH, () => now)
  await resources.list('squad')
  now = 61_000
  await resources.list('squad')
  assert.equal(paths.length, 2)
})

test('a full page is marked truncated', async () => {
  const many = Array.from({ length: LIST_LIMIT }, (_, i) => ({ id: `t-${i}`, type: 'function' }))
  const { resources } = setup({ '/tool': many })
  assert.equal((await resources.list('tool')).truncated, true)
})

test('get returns a redacted detail with a count', async () => {
  const { resources, paths } = setup()
  const detail = await resources.get('assistant', ASSISTANT.id)
  assert.deepEqual(paths, [`/assistant/${ASSISTANT.id}`])
  assert.equal(detail.summary.name, 'Front Desk')
  assert.ok(detail.redacted >= 8)
  const text = JSON.stringify(detail)
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret)
})

test('unknown kinds and bad ids never reach the network', async () => {
  const { resources, paths } = setup()
  for (const attempt of [
    () => resources.list('credential'),
    () => resources.list('../call'),
    () => resources.get('assistant', '../call'),
    () => resources.get('assistant', 42),
    () => resources.get('org', 'x')
  ]) {
    try {
      await attempt()
      assert.fail('expected a rejection')
    } catch (error) {
      assert.ok(error instanceof VapiError)
      assert.equal(error.code, 'blocked_by_gate')
    }
  }
  assert.equal(paths.length, 0)
})

test('a non-array list answer is a bad_response', async () => {
  const { resources } = setup({ '/assistant': { not: 'a list' } })
  try {
    await resources.list('assistant')
    assert.fail('expected a rejection')
  } catch (error) {
    assert.ok(error instanceof VapiError)
    assert.equal(error.code, 'bad_response')
  }
})

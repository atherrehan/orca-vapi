// Runs the real worker wiring over Orca's mock host, with a fake fetch so nothing leaves the
// machine.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaWorkerApi } from 'orca/worker'
import * as main from '../src/worker/main.ts'
import { createRuntime } from '../src/worker/runtime.ts'
import type { FetchLike } from '../src/worker/http.ts'
import { API_KEY_SECRET } from '../src/worker/keystore.ts'
import { ASSISTANT, BY_PATH, SECRETS } from './fixtures/vapi.ts'

const KEY = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b'

function fakeVapi(status = 200) {
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    return new Response(status === 200 ? '[]' : '{"message":"Invalid Key"}', { status })
  }
  return { fetch, urls }
}

async function mount(options: { status?: number; keyring?: string; secrets?: Record<string, string> } = {}) {
  const vapi = fakeVapi(options.status)
  const host = mockHost({
    results: { 'secrets.protection': { status: options.keyring ?? 'os-keyring' } },
    ...(options.secrets ? { secrets: options.secrets } : {})
  })
  const module = { default: (orca: OrcaWorkerApi) => createRuntime(orca, { fetch: vapi.fetch }) }
  const worker = await mountWorker(module, { host })
  return { worker, host, vapi }
}

test('the real main module starts and answers vapi.state', async () => {
  const host = mockHost({ results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host })
  const state = await worker.request('vapi.state')
  assert.deepEqual(state, {
    connected: false,
    fingerprint: null,
    keyring: 'os-keyring',
    version: main.VERSION
  })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('connect checks the key with one read-only request, then stores it', async () => {
  const { worker, host, vapi } = await mount()
  const result = await worker.request('vapi.connect', { apiKey: `  ${KEY} ` })
  assert.deepEqual(result, { ok: true, data: { fingerprint: '…4a5b' } })
  assert.deepEqual(vapi.urls, ['https://api.vapi.ai/assistant?limit=1'])
  assert.equal(host.data().secrets[API_KEY_SECRET], KEY)
  assert.deepEqual(worker.posts, [{ event: 'vapi.changed', payload: { reason: 'connected' } }])

  const state = await worker.request('vapi.state')
  assert.equal(state.connected, true)
  assert.equal(state.fingerprint, '…4a5b')
  assert.ok(!JSON.stringify(state).includes(KEY))
  await worker.deactivate()
})

test('a key Vapi rejects is not stored', async () => {
  const { worker, host } = await mount({ status: 401 })
  const result = await worker.request('vapi.connect', { apiKey: KEY })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'unauthorized')
  assert.equal(host.data().secrets[API_KEY_SECRET], undefined)
  assert.deepEqual(worker.posts, [])
  await worker.deactivate()
})

test('a malformed key is refused before any request', async () => {
  const { worker, vapi } = await mount()
  for (const apiKey of ['', 'nope', 'has spaces in the middle of it']) {
    const result = await worker.request('vapi.connect', { apiKey })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'invalid_key')
  }
  assert.equal(vapi.urls.length, 0)
  await worker.deactivate()
})

test('no key is accepted when the OS keyring is unavailable', async () => {
  const { worker, host, vapi } = await mount({ keyring: 'unavailable' })
  const result = await worker.request('vapi.connect', { apiKey: KEY })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'keyring_unavailable')
  assert.equal(vapi.urls.length, 0)
  assert.equal(host.data().secrets[API_KEY_SECRET], undefined)
  await worker.deactivate()
})

test('disconnect removes the key and clears network activity', async () => {
  const { worker, host } = await mount()
  await worker.request('vapi.connect', { apiKey: KEY })
  assert.equal((await worker.request('vapi.network.recent')).length, 1)

  assert.deepEqual(await worker.request('vapi.disconnect'), { ok: true, data: null })
  assert.equal(host.data().secrets[API_KEY_SECRET], undefined)
  assert.equal((await worker.request('vapi.network.recent')).length, 0)
  assert.equal((await worker.request('vapi.state')).connected, false)
  await worker.deactivate()
})

test('network activity never contains the key', async () => {
  const { worker } = await mount()
  await worker.request('vapi.connect', { apiKey: KEY })
  const entries = await worker.request('vapi.network.recent')
  assert.equal(entries[0]?.path, '/assistant')
  assert.deepEqual(entries[0]?.queryKeys, ['limit'])
  assert.ok(!JSON.stringify(entries).includes(KEY))
  await worker.deactivate()
})

test('commands: refresh, network and disconnect', async () => {
  const { worker, host } = await mount({ secrets: { [API_KEY_SECRET]: KEY } })
  assert.equal(await worker.command('vapi.refresh'), 'Vapi Orca: refreshed.')
  assert.match(String(await worker.command('vapi.network')), /no requests/)
  assert.match(String(await worker.command('vapi.disconnect')), /disconnected/)
  assert.equal(host.data().secrets[API_KEY_SECRET], undefined)
  assert.equal(await worker.command('vapi.disconnect'), 'Vapi Orca: not connected.')
  assert.deepEqual(
    worker.posts.map((post) => post.payload),
    [{ reason: 'refresh' }, { reason: 'disconnected' }]
  )
  await worker.deactivate()
})

test('resources: list and redacted detail through the panel API', async () => {
  const urls: string[] = []
  const fetch: FetchLike = async (url) => {
    urls.push(url)
    const path = new URL(url).pathname
    return path in BY_PATH
      ? new Response(JSON.stringify(BY_PATH[path]))
      : new Response('{}', { status: 404 })
  }
  const host = mockHost({
    results: { 'secrets.protection': { status: 'os-keyring' } },
    secrets: { [API_KEY_SECRET]: KEY }
  })
  const worker = await mountWorker(
    { default: (orca: OrcaWorkerApi) => createRuntime(orca, { fetch }) },
    { host }
  )

  const list = await worker.request('vapi.resources.list', { kind: 'phone-number' })
  assert.ok(list.ok)
  if (list.ok) assert.equal(list.data.items[0]?.name, '+61400000000')

  const detail = await worker.request('vapi.resources.get', { kind: 'assistant', id: ASSISTANT.id })
  assert.ok(detail.ok)
  const text = JSON.stringify(detail)
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret)

  await worker.request('vapi.resources.list', { kind: 'phone-number' })
  assert.equal(urls.length, 2, 'second list call is served from the cache')
  await worker.command('vapi.refresh')
  await worker.request('vapi.resources.list', { kind: 'phone-number' })
  assert.equal(urls.length, 3, 'refresh clears the cache')

  const bad = await worker.request('vapi.resources.list', { kind: 'credential' } as never)
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.error.code, 'blocked_by_gate')
  await worker.deactivate()
})

test('resources answer not_connected without a key', async () => {
  const { worker, vapi } = await mount()
  const list = await worker.request('vapi.resources.list', { kind: 'assistant' })
  assert.equal(list.ok, false)
  if (!list.ok) assert.equal(list.error.code, 'not_connected')
  assert.equal(vapi.urls.length, 0)
  await worker.deactivate()
})

test('worker logs never contain the key', async () => {
  const { worker } = await mount()
  await worker.request('vapi.connect', { apiKey: KEY })
  await worker.request('vapi.disconnect')
  assert.ok(worker.logs.length > 0)
  assert.ok(!worker.logs.join('\n').includes(KEY))
  await worker.deactivate()
})

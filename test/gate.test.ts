import { assert, test } from 'orca/testing'
import { assertAllowed, type GatedRequest } from '../src/worker/gate.ts'
import { VapiError } from '../src/shared/errors.ts'

const ID = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b'

function blocked(request: GatedRequest): boolean {
  try {
    assertAllowed(request)
    return false
  } catch (error) {
    return error instanceof VapiError && error.code === 'blocked_by_gate'
  }
}

test('allows the read endpoints v1 needs', () => {
  const allowed: GatedRequest[] = [
    { method: 'GET', path: '/assistant' },
    { method: 'GET', path: `/assistant/${ID}` },
    { method: 'GET', path: '/squad' },
    { method: 'GET', path: `/squad/${ID}` },
    { method: 'GET', path: '/tool' },
    { method: 'GET', path: `/tool/${ID}` },
    { method: 'GET', path: '/phone-number' },
    { method: 'GET', path: `/phone-number/${ID}` },
    { method: 'GET', path: '/call', query: { assistantId: ID, limit: 50 } },
    { method: 'GET', path: '/call', query: { createdAtLt: '2026-11-24T08:00:00.000Z' } },
    { method: 'GET', path: `/call/${ID}` },
    { method: 'POST', path: '/analytics', body: { queries: [] } }
  ]
  for (const request of allowed) assert.equal(blocked(request), false, JSON.stringify(request))
})

test('blocks every write method, even on known paths', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST', 'HEAD', 'OPTIONS', 'get']) {
    assert.ok(blocked({ method, path: `/assistant/${ID}` }), method)
    assert.ok(blocked({ method, path: '/call' }), method)
  }
})

test('blocks unknown, nested and escaping paths', () => {
  const paths = [
    '/',
    '/assistants',
    `/assistant/${ID}/extra`,
    '/assistant/../call',
    '/assistant/%2e%2e',
    '//evil.example/assistant',
    'https://evil.example/assistant',
    '/assistant?x=1',
    `/assistant/${'a'.repeat(65)}`,
    '/file',
    '/credential',
    '/org'
  ]
  for (const path of paths) assert.ok(blocked({ method: 'GET', path }), path)
})

test('blocks unknown query keys and unsafe query values', () => {
  assert.ok(blocked({ method: 'GET', path: '/assistant', query: { assistantId: ID } }))
  assert.ok(blocked({ method: 'GET', path: `/call/${ID}`, query: { limit: 1 } }))
  assert.ok(blocked({ method: 'GET', path: '/call', query: { assistantId: 'a b' } }))
  assert.ok(blocked({ method: 'GET', path: '/call', query: { assistantId: 'x&limit=1' } }))
  assert.ok(blocked({ method: 'GET', path: '/call', query: { limit: Number.NaN } }))
})

test('blocks a body on GET requests', () => {
  assert.ok(blocked({ method: 'GET', path: '/assistant', body: {} }))
})

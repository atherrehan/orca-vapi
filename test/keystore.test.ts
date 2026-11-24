import { assert, test } from 'orca/testing'
import {
  API_KEY_SECRET,
  KeyStore,
  fingerprint,
  normalizeKey,
  type SecretsPort
} from '../src/worker/keystore.ts'
import { VapiError } from '../src/shared/errors.ts'
import type { KeyringStatus } from '../src/shared/protocol.ts'

const KEY = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b'

function memoryPort(protection: KeyringStatus = 'os-keyring') {
  const data = new Map<string, string>()
  const port: SecretsPort = {
    protection: async () => protection,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value)
    },
    delete: async (key) => {
      data.delete(key)
    }
  }
  return { port, data }
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof VapiError)
    return error.code
  }
  throw new Error('expected a rejection')
}

test('stores a trimmed key in the OS keyring and answers only its fingerprint', async () => {
  const { port, data } = memoryPort()
  const store = new KeyStore(port)
  assert.equal(await store.save(`  ${KEY}\n`), '…4a5b')
  assert.equal(data.get(API_KEY_SECRET), KEY)
  assert.equal(await store.hasKey(), true)
  assert.equal(await store.fingerprint(), '…4a5b')
})

test('refuses to store a key when the keyring is not available', async () => {
  for (const status of ['unavailable', 'unknown'] as const) {
    const { port, data } = memoryPort(status)
    assert.equal(await codeOf(new KeyStore(port).save(KEY)), 'keyring_unavailable')
    assert.equal(data.size, 0)
  }
})

test('rejects values that are not key-shaped', async () => {
  const { port, data } = memoryPort()
  const store = new KeyStore(port)
  for (const bad of ['', 'short', 'has space inside the key value', `${KEY}\nnext`, 'x'.repeat(201)]) {
    assert.equal(await codeOf(store.save(bad)), 'invalid_key', JSON.stringify(bad))
  }
  assert.equal(data.size, 0)
})

test('clear removes the key', async () => {
  const { port, data } = memoryPort()
  const store = new KeyStore(port)
  await store.save(KEY)
  await store.clear()
  assert.equal(data.size, 0)
  assert.equal(await store.hasKey(), false)
  assert.equal(await store.fingerprint(), null)
})

test('a failing keyring read counts as no key', async () => {
  const { port } = memoryPort()
  port.get = async () => {
    throw new Error('keyring locked')
  }
  assert.equal(await new KeyStore(port).hasKey(), false)
})

test('normalizeKey and fingerprint', () => {
  assert.equal(normalizeKey(` ${KEY} `), KEY)
  assert.equal(fingerprint(KEY), '…4a5b')
})

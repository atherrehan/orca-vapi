// The Vapi key lives only in Orca's encrypted secrets (OS keyring). This module stores, reads
// and clears it, and refuses to store it anywhere less safe.
import type { OrcaWorkerApi } from 'orca/worker'
import type { KeyringStatus } from '../shared/protocol.ts'
import { VapiError } from '../shared/errors.ts'

export const API_KEY_SECRET = 'vapi-api-key'

const KEY_SHAPE = /^[A-Za-z0-9_-]{20,200}$/

/** The slice of Orca the key store needs, so tests can stand in for it. */
export type SecretsPort = {
  protection(): Promise<KeyringStatus>
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export function orcaSecretsPort(orca: OrcaWorkerApi): SecretsPort {
  const granted = (): boolean => orca.grantedCapabilities.includes('secrets:own')
  return {
    async protection() {
      if (!granted()) return 'unavailable'
      try {
        const { status } = await orca.host.call('secrets.protection')
        return status
      } catch {
        return 'unknown'
      }
    },
    async get(key) {
      return granted() ? orca.secrets.get(key) : null
    },
    async set(key, value) {
      if (!granted()) throw new VapiError('keyring_unavailable')
      await orca.secrets.set(key, value)
    },
    async delete(key) {
      if (granted()) await orca.secrets.delete(key)
    }
  }
}

/** Trims pasted whitespace and checks the key's shape; throws `invalid_key` otherwise. */
export function normalizeKey(raw: string): string {
  const key = raw.trim()
  if (!KEY_SHAPE.test(key)) throw new VapiError('invalid_key')
  return key
}

/** What the panel may show of a key: its last four characters. */
export function fingerprint(key: string): string {
  return `…${key.slice(-4)}`
}

export class KeyStore {
  readonly #port: SecretsPort

  constructor(port: SecretsPort) {
    this.#port = port
  }

  protection(): Promise<KeyringStatus> {
    return this.#port.protection()
  }

  /** Stores the key only when the OS keyring protects it; answers its fingerprint. */
  async save(raw: string): Promise<string> {
    const key = normalizeKey(raw)
    if ((await this.#port.protection()) !== 'os-keyring') throw new VapiError('keyring_unavailable')
    await this.#port.set(API_KEY_SECRET, key)
    return fingerprint(key)
  }

  async load(): Promise<string | null> {
    try {
      return await this.#port.get(API_KEY_SECRET)
    } catch {
      return null
    }
  }

  async hasKey(): Promise<boolean> {
    return (await this.load()) !== null
  }

  async fingerprint(): Promise<string | null> {
    const key = await this.load()
    return key === null ? null : fingerprint(key)
  }

  async clear(): Promise<void> {
    await this.#port.delete(API_KEY_SECRET)
  }
}

// Connecting and disconnecting. A key is stored only after Vapi accepts it on a read-only
// request, and only in the OS keyring.
import { VapiError } from '../shared/errors.ts'
import type { VapiState } from '../shared/protocol.ts'
import { VapiClient, type VapiClientOptions } from './http.ts'
import { KeyStore, normalizeKey } from './keystore.ts'
import type { NetworkLog } from './network-log.ts'

export type ClientFactory = (getKey: () => Promise<string | null>) => VapiClient

export function clientFactory(
  log: NetworkLog,
  extra: Omit<VapiClientOptions, 'getKey' | 'log'> = {}
): ClientFactory {
  return (getKey) => new VapiClient({ ...extra, getKey, log })
}

export class Connection {
  readonly #keys: KeyStore
  readonly #makeClient: ClientFactory
  readonly #log: NetworkLog
  readonly #version: string

  constructor(keys: KeyStore, makeClient: ClientFactory, log: NetworkLog, version: string) {
    this.#keys = keys
    this.#makeClient = makeClient
    this.#log = log
    this.#version = version
  }

  async state(): Promise<VapiState> {
    const fingerprint = await this.#keys.fingerprint()
    return {
      connected: fingerprint !== null,
      fingerprint,
      keyring: await this.#keys.protection(),
      version: this.#version
    }
  }

  /** Validates the candidate key with `GET /assistant?limit=1`, then stores it. */
  async connect(rawKey: unknown, signal?: AbortSignal): Promise<{ fingerprint: string }> {
    if (typeof rawKey !== 'string') throw new VapiError('invalid_key')
    const key = normalizeKey(rawKey)
    if ((await this.#keys.protection()) !== 'os-keyring') throw new VapiError('keyring_unavailable')
    const probe = this.#makeClient(async () => key)
    await probe.request({ method: 'GET', path: '/assistant', query: { limit: 1 } }, signal)
    return { fingerprint: await this.#keys.save(key) }
  }

  async disconnect(): Promise<void> {
    await this.#keys.clear()
    this.#log.clear()
  }
}

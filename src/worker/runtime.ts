// Wires the worker together. `activate` in main.ts calls this with real dependencies; tests call
// it with a fake fetch so no request ever leaves the machine.
import type { OrcaWorkerApi } from 'orca/worker'
import { toPublicError } from '../shared/errors.ts'
import type { ChangeReason, NetworkEntry, Result } from '../shared/protocol.ts'
import { Connection, clientFactory } from './connection.ts'
import type { FetchLike } from './http.ts'
import { KeyStore, orcaSecretsPort } from './keystore.ts'
import { NetworkLog } from './network-log.ts'
import { Resources } from './resources.ts'
import { scrub } from './scrub.ts'
import { TtlCache } from './cache.ts'

export const VERSION = '0.1.0'
const CACHE_TTL_MS = 60_000

export type RuntimeDeps = { fetch?: FetchLike }

async function settle<T>(task: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await task() }
  } catch (error) {
    return { ok: false, error: toPublicError(error) }
  }
}

function formatNetwork(entries: NetworkEntry[]): string {
  if (entries.length === 0) return 'Vapi Orca: no requests to api.vapi.ai yet.'
  const lines = entries.map((entry) => {
    const query = entry.queryKeys.length ? `?${entry.queryKeys.join('&')}` : ''
    const status = entry.status ?? '---'
    return `${entry.at}  ${entry.method.padEnd(4)} ${status}  ${String(entry.ms).padStart(5)}ms  ${entry.path}${query}  ${entry.outcome}`
  })
  return ['Vapi Orca: recent requests to api.vapi.ai (newest first)', ...lines].join('\n')
}

export function createRuntime(orca: OrcaWorkerApi, deps: RuntimeDeps = {}): void {
  const keys = new KeyStore(orcaSecretsPort(orca))
  const network = new NetworkLog(50)
  const cache = new TtlCache<unknown>(CACHE_TTL_MS)
  const makeClient = clientFactory(network, deps.fetch ? { fetch: deps.fetch } : {})
  const connection = new Connection(keys, makeClient, network, VERSION)
  const resources = new Resources(makeClient(() => keys.load()), cache)
  const forget = async (): Promise<void> => {
    cache.clear()
    await connection.disconnect()
  }
  const log = async (message: string): Promise<void> => {
    orca.log(scrub(message, [await keys.load()]))
  }
  const changed = (reason: ChangeReason): void => orca.panels.post('vapi.changed', { reason })

  orca.panels.handle('vapi.state', () => connection.state())

  orca.panels.handle('vapi.connect', async (input, { signal }) => {
    const result = await settle(() => connection.connect(input?.apiKey, signal))
    if (result.ok) {
      cache.clear()
      await log(`Connected (${result.data.fingerprint})`)
      changed('connected')
    } else {
      await log(`Connect failed: ${result.error.code}`)
    }
    return result
  })

  orca.panels.handle('vapi.disconnect', async () => {
    const result = await settle(async () => {
      await forget()
      return null
    })
    if (result.ok) {
      await log('Disconnected; key removed from the keyring')
      changed('disconnected')
    }
    return result
  })

  orca.panels.handle('vapi.network.recent', () => network.recent())

  orca.panels.handle('vapi.resources.list', (input, { signal }) =>
    settle(() => resources.list(input?.kind, input?.refresh === true, signal))
  )

  orca.panels.handle('vapi.resources.get', (input, { signal }) =>
    settle(() => resources.get(input?.kind, input?.id, signal))
  )

  orca.commands.register('vapi.refresh', () => {
    cache.clear()
    changed('refresh')
    return 'Vapi Orca: refreshed.'
  })

  orca.commands.register('vapi.disconnect', async () => {
    if (!(await keys.hasKey())) return 'Vapi Orca: not connected.'
    await forget()
    changed('disconnected')
    return 'Vapi Orca: disconnected. The API key was removed from the OS keyring.'
  })

  orca.commands.register('vapi.network', () => formatNetwork(network.recent()))

  void log(`Vapi Orca worker ${VERSION} started`)
}

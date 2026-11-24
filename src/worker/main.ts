// The plugin's worker. Orca starts it on the panel's first plugin.request and transpiles this
// file as it loads: no build step. Only the worker ever talks to Vapi or touches the API key.
import type { OrcaWorkerApi } from 'orca/worker'
import type { VapiState } from '../shared/protocol.ts'
import { KeyStore, orcaSecretsPort } from './keystore.ts'

export const VERSION = '0.1.0'

export default function activate(orca: OrcaWorkerApi): void {
  const keys = new KeyStore(orcaSecretsPort(orca))

  orca.panels.handle('vapi.state', async (): Promise<VapiState> => ({
    connected: await keys.hasKey(),
    keyring: await keys.protection(),
    version: VERSION
  }))

  orca.log(`Vapi Orca worker ${VERSION} started`)
}

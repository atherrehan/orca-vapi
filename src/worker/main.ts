// The plugin's worker. Orca starts it on the panel's first plugin.request and transpiles this
// file as it loads: no build step. Only the worker ever talks to Vapi or touches the API key.
import type { OrcaWorkerApi } from 'orca/worker'
import type { KeyringStatus, VapiState } from '../shared/protocol.ts'

export const VERSION = '0.1.0'
export const API_KEY_SECRET = 'vapi-api-key'

async function keyringStatus(orca: OrcaWorkerApi): Promise<KeyringStatus> {
  try {
    const { status } = await orca.host.call('secrets.protection')
    return status
  } catch {
    return 'unknown'
  }
}

async function hasStoredKey(orca: OrcaWorkerApi): Promise<boolean> {
  if (!orca.grantedCapabilities.includes('secrets:own')) return false
  try {
    return (await orca.secrets.get(API_KEY_SECRET)) !== null
  } catch {
    return false
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('vapi.state', async (): Promise<VapiState> => ({
    connected: await hasStoredKey(orca),
    keyring: await keyringStatus(orca),
    version: VERSION
  }))

  orca.log(`Vapi Orca worker ${VERSION} started`)
}

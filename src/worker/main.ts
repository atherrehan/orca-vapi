// The plugin's worker. Orca starts it on the panel's first plugin.request and transpiles this
// file as it loads: no build step. Only the worker ever talks to Vapi or touches the API key.
import type { OrcaWorkerApi } from 'orca/worker'
import { createRuntime } from './runtime.ts'

export { VERSION } from './runtime.ts'

export default function activate(orca: OrcaWorkerApi): void {
  createRuntime(orca)
}

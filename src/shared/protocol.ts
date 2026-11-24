// The panel <-> worker contract, declared once: the panel and the worker both read it.
import type { VapiErrorCode } from './errors.ts'

export type KeyringStatus = 'os-keyring' | 'unavailable' | 'unknown'

/** One request in the "Network activity" view: no query values, headers or bodies. */
export type NetworkEntry = {
  at: string
  method: string
  path: string
  queryKeys: string[]
  status: number | null
  outcome: 'ok' | VapiErrorCode
  ms: number
  attempt: number
}

export type VapiState = {
  /** A Vapi key is stored in the OS keyring. */
  connected: boolean
  /** How Orca protects secrets at rest on this machine. */
  keyring: KeyringStatus
  /** Plugin version, for the panel footer. */
  version: string
}

declare module 'orca' {
  interface PluginRequests {
    /** Connection and environment state for the panel's first render. */
    'vapi.state': { output: VapiState }
  }
}

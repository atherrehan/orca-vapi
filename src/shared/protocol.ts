// The panel <-> worker contract, declared once: the panel and the worker both read it.
import type { PublicError, VapiErrorCode } from './errors.ts'

export type KeyringStatus = 'os-keyring' | 'unavailable' | 'unknown'

/** Worker answers carry typed errors in the value, because Orca turns unknown thrown codes into
 *  `action_failed`. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: PublicError }

export type VapiState = {
  /** A Vapi key is stored in the OS keyring. */
  connected: boolean
  /** The stored key's last four characters, e.g. `…4a5b`; never the key itself. */
  fingerprint: string | null
  /** How Orca protects secrets at rest on this machine. */
  keyring: KeyringStatus
  /** Plugin version, for the panel footer. */
  version: string
}

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

export type ChangeReason = 'connected' | 'disconnected' | 'refresh'

declare module 'orca' {
  interface PluginRequests {
    /** Connection and environment state. */
    'vapi.state': { output: VapiState }
    /** Checks the key against Vapi (read-only), then stores it in the OS keyring. */
    'vapi.connect': { input: { apiKey: string }; output: Result<{ fingerprint: string }> }
    /** Deletes the stored key and clears everything held in memory. */
    'vapi.disconnect': { output: Result<null> }
    /** Recent requests to api.vapi.ai, newest first. */
    'vapi.network.recent': { output: NetworkEntry[] }
  }
  interface PluginPanelEvents {
    /** Tells every open panel to reload its state. */
    'vapi.changed': { reason: ChangeReason }
  }
}

// The panel <-> worker contract, declared once: the panel and the worker both read it.
export type KeyringStatus = 'os-keyring' | 'unavailable' | 'unknown'

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

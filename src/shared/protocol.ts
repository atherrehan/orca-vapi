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

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export const RESOURCE_KINDS = ['assistant', 'squad', 'tool', 'phone-number'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** One row in a resource list. */
export type ResourceSummary = {
  id: string
  name: string
  subtitle: string
  updatedAt: string | null
}

export type ResourceList = {
  kind: ResourceKind
  items: ResourceSummary[]
  fetchedAt: string
  /** Vapi returned a full page; there may be more than the plugin shows. */
  truncated: boolean
}

export type ResourceDetail = {
  kind: ResourceKind
  summary: ResourceSummary
  /** The item's config with secrets, auth headers and credentials replaced by `[redacted]`. */
  data: Json
  /** How many values the redactor replaced. */
  redacted: number
}

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
    /** Assistants, squads, tools or phone numbers, summarised; cached for a minute. */
    'vapi.resources.list': {
      input: { kind: ResourceKind; refresh?: boolean }
      output: Result<ResourceList>
    }
    /** One item's redacted config. */
    'vapi.resources.get': {
      input: { kind: ResourceKind; id: string }
      output: Result<ResourceDetail>
    }
  }
  interface PluginPanelEvents {
    /** Tells every open panel to reload its state. */
    'vapi.changed': { reason: ChangeReason }
  }
}

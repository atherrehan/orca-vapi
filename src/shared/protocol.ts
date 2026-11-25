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

export const CALL_RANGES = ['24h', '7d', '30d', 'all'] as const
export type CallRange = (typeof CALL_RANGES)[number]

/** How a call ended, for colouring: fine, worth a look, or a failure. */
export type Severity = 'ok' | 'warn' | 'error'

export type CallSummary = {
  id: string
  assistantId: string | null
  assistantName: string | null
  type: string | null
  status: string | null
  endedReason: string | null
  severity: Severity
  startedAt: string | null
  durationSec: number | null
  cost: number | null
  /** The customer's number with all but the last four digits masked. */
  customer: string | null
  createdAt: string
}

export type CallPage = {
  items: CallSummary[]
  /** Pass back as `before` to load older calls; null when there are no more. */
  nextBefore: string | null
  fetchedAt: string
}

export type TranscriptTurn = { role: 'assistant' | 'user' | 'tool'; text: string; at: number | null }

export type ToolCallEntry = {
  id: string
  name: string
  at: number | null
  arguments: Json
  result: string | null
  /** Seconds between the call and its result, when Vapi timed both. */
  seconds: number | null
  failed: boolean
  /** Why it counts as failed: no result, or an error-looking result. */
  reason: string | null
}

export type CostLine = { label: string; amount: number }

export type CallDetail = {
  summary: CallSummary
  endedReasonText: string | null
  analysis: { summary: string | null; success: string | null }
  recordingUrl: string | null
  toolCalls: ToolCallEntry[]
  transcript: TranscriptTurn[]
  costs: CostLine[]
  /** The call object without its message log, redacted. */
  raw: Json
  redacted: number
}

export const INSIGHT_RANGES = ['24h', '7d', '14d', '30d'] as const
export type InsightRange = (typeof INSIGHT_RANGES)[number]

export type Insights = {
  range: InsightRange
  start: string
  end: string
  totals: { calls: number; cost: number; avgDurationSec: number | null }
  costs: CostLine[]
  byAssistant: { assistantId: string; name: string; calls: number; cost: number }[]
  byEndedReason: { reason: string; severity: Severity; calls: number }[]
  daily: { date: string; calls: number; cost: number }[]
  fetchedAt: string
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
    /** A page of calls, newest first. */
    'vapi.calls.list': {
      input: { assistantId?: string; range: CallRange; before?: string; refresh?: boolean }
      output: Result<CallPage>
    }
    /** One call: transcript, tool-call timeline, costs and a redacted raw view. */
    'vapi.calls.get': { input: { id: string }; output: Result<CallDetail> }
    /** Cost and call aggregates from POST /analytics (read-only). */
    'vapi.insights': { input: { range: InsightRange; refresh?: boolean }; output: Result<Insights> }
  }
  interface PluginPanelEvents {
    /** Tells every open panel to reload its state. */
    'vapi.changed': { reason: ChangeReason }
  }
}

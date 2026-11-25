// Turns Vapi call objects into what the panel shows: summaries, a transcript, a tool-call
// timeline with failures flagged, and a cost breakdown. Pure functions, no I/O.
import type {
  CallDetail,
  CallSummary,
  CostLine,
  Json,
  Severity,
  ToolCallEntry,
  TranscriptTurn
} from '../shared/protocol.ts'
import { redact } from './redact.ts'

type Raw = Record<string, unknown>

const MAX_TEXT = 2000
const MAX_TURNS = 500
const MAX_TOOL_CALLS = 200

function record(value: unknown): Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Text that came from Vapi, cleaned of tokens and URL secrets, and capped. */
function clean(text: string, max = MAX_TEXT): string {
  const out = redact(text).data as string
  return out.length > max ? `${out.slice(0, max)}…` : out
}

export function severityOf(endedReason: string | null): Severity {
  if (!endedReason) return 'ok'
  if (/error|fail|fault|crash|invalid/i.test(endedReason)) return 'error'
  if (/timed-out|timeout|did-not-answer|no-answer|busy|voicemail|exceeded|rejected|silence/i.test(endedReason)) {
    return 'warn'
  }
  return 'ok'
}

/** `customer-ended-call` → `Customer ended call`. */
export function endedReasonText(endedReason: string | null): string | null {
  if (!endedReason) return null
  const words = endedReason.replace(/[._-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Keeps the last four characters: `+61400001234` → `••••••1234`. */
export function maskNumber(value: string | null): string | null {
  if (!value) return null
  if (value.length <= 4) return '••••'
  return `${'•'.repeat(Math.min(value.length - 4, 6))}${value.slice(-4)}`
}

export function summarizeCall(value: unknown, names: ReadonlyMap<string, string>): CallSummary | null {
  const raw = record(value)
  const id = str(raw.id)
  const createdAt = str(raw.createdAt)
  if (!id || !createdAt) return null
  const assistantId = str(raw.assistantId)
  const startedAt = str(raw.startedAt)
  const endedAt = str(raw.endedAt)
  const started = startedAt ? Date.parse(startedAt) : Number.NaN
  const ended = endedAt ? Date.parse(endedAt) : Number.NaN
  const endedReason = str(raw.endedReason)
  const customer = record(raw.customer)
  return {
    id,
    assistantId,
    assistantName:
      (assistantId ? names.get(assistantId) : undefined) ?? str(record(raw.assistant).name) ?? null,
    type: str(raw.type),
    status: str(raw.status),
    endedReason,
    severity: severityOf(endedReason),
    startedAt,
    durationSec:
      Number.isFinite(started) && Number.isFinite(ended)
        ? Math.max(0, Math.round((ended - started) / 1000))
        : null,
    cost: num(raw.cost),
    customer: maskNumber(str(customer.number) ?? str(customer.sipUri)),
    createdAt
  }
}

function messagesOf(raw: Raw): unknown[] {
  const fromArtifact = record(raw.artifact).messages
  if (Array.isArray(fromArtifact)) return fromArtifact
  return Array.isArray(raw.messages) ? raw.messages : []
}

function parseArguments(value: unknown): Json {
  if (typeof value === 'string') {
    try {
      return redact(JSON.parse(value)).data
    } catch {
      return clean(value)
    }
  }
  return redact(value ?? null).data
}

const FAILURE = /\b(error|failed|failure|exception|timed? ?out|unauthori[sz]ed|forbidden|not found|invalid|denied)\b|status(?: code)?:? ?[45]\d\d/i

function resultText(message: Raw): string | null {
  const result = message.result ?? message.content
  if (result === undefined || result === null) return null
  return clean(typeof result === 'string' ? result : JSON.stringify(result))
}

export function parseConversation(value: unknown): {
  transcript: TranscriptTurn[]
  toolCalls: ToolCallEntry[]
} {
  const transcript: TranscriptTurn[] = []
  const toolCalls: ToolCallEntry[] = []
  const byId = new Map<string, ToolCallEntry>()

  for (const item of messagesOf(record(value))) {
    const message = record(item)
    const role = str(message.role)
    const at = num(message.secondsFromStart)

    const calls = message.toolCalls ?? message.tool_calls
    if (Array.isArray(calls)) {
      for (const call of calls) {
        if (toolCalls.length >= MAX_TOOL_CALLS) break
        const c = record(call)
        const fn = record(c.function)
        const entry: ToolCallEntry = {
          id: str(c.id) ?? `call-${toolCalls.length}`,
          name: str(fn.name) ?? str(c.name) ?? str(c.type) ?? 'unknown tool',
          at,
          arguments: parseArguments(fn.arguments ?? c.arguments),
          result: null,
          seconds: null,
          failed: false,
          reason: null
        }
        toolCalls.push(entry)
        byId.set(entry.id, entry)
      }
      continue
    }

    if (role === 'tool_call_result' || role === 'tool') {
      const id = str(message.toolCallId) ?? str(message.tool_call_id)
      const entry = id ? byId.get(id) : undefined
      if (entry) {
        entry.result = resultText(message)
        if (at !== null && entry.at !== null) entry.seconds = Math.max(0, at - entry.at)
      }
      continue
    }

    if (transcript.length >= MAX_TURNS) continue
    const text = str(message.message) ?? str(message.content)
    if (!text) continue
    if (role === 'bot' || role === 'assistant') transcript.push({ role: 'assistant', text: clean(text), at })
    else if (role === 'user') transcript.push({ role: 'user', text: clean(text), at })
  }

  for (const entry of toolCalls) {
    if (entry.result === null) {
      entry.failed = true
      entry.reason = 'No result was recorded'
    } else if (FAILURE.test(entry.result)) {
      entry.failed = true
      entry.reason = 'Result looks like an error'
    }
  }
  return { transcript, toolCalls }
}

const COST_LABELS: [string, string][] = [
  ['llm', 'Model (LLM)'],
  ['stt', 'Transcriber (STT)'],
  ['tts', 'Voice (TTS)'],
  ['vapi', 'Vapi platform'],
  ['transport', 'Transport'],
  ['chat', 'Chat'],
  ['analysis', 'Analysis']
]

export function costLines(value: unknown): CostLine[] {
  const raw = record(value)
  const breakdown = record(raw.costBreakdown)
  const lines: CostLine[] = []
  for (const [key, label] of COST_LABELS) {
    const amount = num(breakdown[key])
    if (amount !== null && amount !== 0) lines.push({ label, amount })
  }
  const total = num(raw.cost) ?? num(breakdown.total)
  if (total !== null) lines.push({ label: 'Total', amount: total })
  return lines
}

export function recordingUrl(value: unknown): string | null {
  const raw = record(value)
  const artifact = record(raw.artifact)
  const recording = record(artifact.recording)
  const candidates = [
    recording.stereoUrl,
    record(recording.mono).combinedUrl,
    artifact.recordingUrl,
    artifact.stereoRecordingUrl,
    raw.recordingUrl,
    raw.stereoRecordingUrl
  ]
  for (const candidate of candidates) {
    const url = str(candidate)
    if (url && url.startsWith('https://')) return url
  }
  return null
}

/** The call without its message log and transcript, which the panel shows separately. */
function withoutConversation(value: unknown): unknown {
  const raw = { ...record(value) }
  delete raw.messages
  delete raw.transcript
  if (raw.customer) {
    const customer = { ...record(raw.customer) }
    for (const field of ['number', 'sipUri']) {
      if (typeof customer[field] === 'string') customer[field] = maskNumber(customer[field])
    }
    raw.customer = customer
  }
  if (raw.artifact) {
    const artifact = { ...record(raw.artifact) }
    delete artifact.messages
    delete artifact.messagesOpenAIFormatted
    delete artifact.transcript
    raw.artifact = artifact
  }
  return raw
}

export function callDetail(value: unknown, names: ReadonlyMap<string, string>): CallDetail | null {
  const summary = summarizeCall(value, names)
  if (!summary) return null
  const raw = record(value)
  const analysis = record(raw.analysis)
  const success = analysis.successEvaluation
  const { transcript, toolCalls } = parseConversation(value)
  const { data, count } = redact(withoutConversation(value))
  const analysisSummary = str(analysis.summary)
  return {
    summary,
    endedReasonText: endedReasonText(summary.endedReason),
    analysis: {
      summary: analysisSummary ? clean(analysisSummary) : null,
      success: success === undefined || success === null ? null : clean(String(success), 200)
    },
    recordingUrl: recordingUrl(value),
    toolCalls,
    transcript,
    costs: costLines(value),
    raw: data,
    redacted: count
  }
}

// Insights from POST /analytics: one request with four fixed, read-only aggregation queries.
// The request body is built here from constants; nothing from the panel goes into it but the
// range, which is checked against a fixed list.
import { VapiError } from '../shared/errors.ts'
import { INSIGHT_RANGES, type CostLine, type InsightRange, type Insights } from '../shared/protocol.ts'
import type { TtlCache } from './cache.ts'
import { severityOf } from './call-parse.ts'
import type { VapiClient } from './http.ts'
import type { Resources } from './resources.ts'

const HOUR = 3600 * 1000
const RANGE_MS: Record<InsightRange, number> = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '14d': 14 * 24 * HOUR,
  '30d': 30 * 24 * HOUR
}

const COST_COLUMNS: [string, string][] = [
  ['costBreakdown.llm', 'Model (LLM)'],
  ['costBreakdown.stt', 'Transcriber (STT)'],
  ['costBreakdown.tts', 'Voice (TTS)'],
  ['costBreakdown.vapi', 'Vapi platform'],
  ['costBreakdown.transport', 'Transport']
]

/** `costBreakdown.llm` → `costLlm`. Already camelCase, because Vapi camelCases aliases it is given. */
function costAlias(column: string): string {
  const leaf = column.split('.').pop() ?? column
  return `cost${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`
}

/** Vapi's analytics `duration` column is in minutes. */
const SECONDS_PER_DURATION_UNIT = 60

export function buildQueries(start: string, end: string): unknown {
  const timeRange = { start, end, timezone: 'UTC' }
  const countAndCost = [
    { operation: 'count', column: 'id', alias: 'calls' },
    { operation: 'sum', column: 'cost', alias: 'cost' }
  ]
  return {
    queries: [
      {
        table: 'call',
        name: 'totals',
        timeRange,
        operations: [
          ...countAndCost,
          { operation: 'avg', column: 'duration', alias: 'avgDuration' },
          ...COST_COLUMNS.map(([column]) => ({ operation: 'sum', column, alias: costAlias(column) }))
        ]
      },
      { table: 'call', name: 'byAssistant', groupBy: ['assistantId'], timeRange, operations: countAndCost },
      {
        table: 'call',
        name: 'byEndedReason',
        groupBy: ['endedReason'],
        timeRange,
        operations: [{ operation: 'count', column: 'id', alias: 'calls' }]
      },
      { table: 'call', name: 'daily', timeRange: { ...timeRange, step: 'day' }, operations: countAndCost }
    ]
  }
}

type Row = Record<string, unknown>

/** Vapi may answer numbers as strings; anything unreadable counts as 0. */
function n(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

function rowsOf(response: unknown, name: string): Row[] {
  if (!Array.isArray(response)) return []
  const query = response.find(
    (item): item is { name: string; result: unknown } =>
      item !== null && typeof item === 'object' && (item as { name?: unknown }).name === name
  )
  return Array.isArray(query?.result)
    ? query.result.filter((row): row is Row => row !== null && typeof row === 'object')
    : []
}

export function parseInsights(
  response: unknown,
  range: InsightRange,
  start: string,
  end: string,
  names: ReadonlyMap<string, string>,
  fetchedAt: string
): Insights {
  if (!Array.isArray(response)) throw new VapiError('bad_response')
  const totals = rowsOf(response, 'totals')[0] ?? {}
  const calls = n(totals.calls)
  const costs: CostLine[] = COST_COLUMNS.map(([column, label]) => ({
    label,
    amount: n(totals[costAlias(column)])
  })).filter((line) => line.amount !== 0)
  costs.push({ label: 'Total', amount: n(totals.cost) })

  return {
    range,
    start,
    end,
    totals: {
      calls,
      cost: n(totals.cost),
      avgDurationSec: calls > 0 ? n(totals.avgDuration) * SECONDS_PER_DURATION_UNIT : null
    },
    costs,
    byAssistant: rowsOf(response, 'byAssistant')
      .map((row) => {
        const assistantId = typeof row.assistantId === 'string' ? row.assistantId : ''
        return {
          assistantId,
          name: names.get(assistantId) ?? (assistantId ? `${assistantId.slice(0, 8)}…` : 'No assistant'),
          calls: n(row.calls),
          cost: n(row.cost)
        }
      })
      .sort((a, b) => b.cost - a.cost),
    byEndedReason: rowsOf(response, 'byEndedReason')
      .map((row) => {
        const reason = typeof row.endedReason === 'string' && row.endedReason ? row.endedReason : 'unknown'
        return { reason, severity: severityOf(reason), calls: n(row.calls) }
      })
      .sort((a, b) => b.calls - a.calls),
    daily: rowsOf(response, 'daily')
      .map((row) => ({ date: typeof row.date === 'string' ? row.date : '', calls: n(row.calls), cost: n(row.cost) }))
      .filter((day) => day.date !== '')
      .sort((a, b) => a.date.localeCompare(b.date)),
    fetchedAt
  }
}

export function isInsightRange(value: unknown): value is InsightRange {
  return typeof value === 'string' && (INSIGHT_RANGES as readonly string[]).includes(value)
}

export class InsightsService {
  readonly #client: VapiClient
  readonly #cache: TtlCache<unknown>
  readonly #resources: Resources
  readonly #now: () => number

  constructor(client: VapiClient, cache: TtlCache<unknown>, resources: Resources, now: () => number = Date.now) {
    this.#client = client
    this.#cache = cache
    this.#resources = resources
    this.#now = now
  }

  async get(range: unknown, refresh = false, signal?: AbortSignal): Promise<Insights> {
    if (!isInsightRange(range)) throw new VapiError('blocked_by_gate')
    const key = `insights:${range}`
    if (refresh) this.#cache.delete(key)
    const cached = this.#cache.get(key) as Insights | undefined
    if (cached) return cached

    const now = this.#now()
    const end = new Date(now).toISOString()
    const start = new Date(now - RANGE_MS[range]).toISOString()
    const response = await this.#client.request(
      { method: 'POST', path: '/analytics', body: buildQueries(start, end) },
      signal
    )
    let names = new Map<string, string>()
    try {
      const list = await this.#resources.list('assistant', false, signal)
      names = new Map(list.items.map((item) => [item.id, item.name]))
    } catch {
      // Names are a nicety; ids still show.
    }
    const insights = parseInsights(response, range, start, end, names, new Date(now).toISOString())
    this.#cache.set(key, insights)
    return insights
  }
}

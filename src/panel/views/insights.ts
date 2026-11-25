// Insights: headline numbers, calls per day, cost by assistant, end reasons and cost breakdown.
import type { InsightRange, Insights, Result } from '../../shared/protocol.ts'
import { button, el } from '../dom.ts'
import { duration, money } from '../format.ts'

export type InsightActions = {
  insights(range: InsightRange, refresh: boolean): Promise<Result<Insights>>
}

const RANGES: { value: InsightRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' }
]

function kpi(label: string, value: string): HTMLElement {
  return el('div', { className: 'kpi' }, [
    el('div', { className: 'kpi-value', text: value }),
    el('div', { className: 'kpi-label muted small', text: label })
  ])
}

/** Every UTC day from start to end, so quiet days show as gaps instead of disappearing. */
function days(start: string, end: string): string[] {
  const out: string[] = []
  const first = new Date(start.slice(0, 10) + 'T00:00:00Z').getTime()
  const last = new Date(end.slice(0, 10) + 'T00:00:00Z').getTime()
  for (let t = first; t <= last && out.length < 62; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

function dailyChart(data: Insights): HTMLElement {
  const byDay = new Map(data.daily.map((day) => [day.date.slice(0, 10), day]))
  const span = days(data.start, data.end)
  const max = Math.max(1, ...data.daily.map((day) => day.calls))
  return el(
    'div',
    { className: 'bars', attrs: { role: 'img', 'aria-label': 'Calls per day' } },
    span.map((date) => {
      const day = byDay.get(date)
      const calls = day?.calls ?? 0
      const bar = el('div', {
        className: 'bar',
        attrs: { title: `${date}: ${calls} call${calls === 1 ? '' : 's'}, ${money(day?.cost ?? 0)}` }
      })
      bar.style.height = `${Math.max(calls ? 6 : 1, Math.round((calls / max) * 100))}%`
      return bar
    })
  )
}

function meter(fraction: number, className = ''): HTMLElement {
  const fill = el('div', { className: `meter-fill ${className}` })
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
  return el('div', { className: 'meter' }, [fill])
}

function render(data: Insights): HTMLElement[] {
  const { totals } = data
  const perCall = totals.calls ? totals.cost / totals.calls : null
  const maxAssistantCost = Math.max(0.000001, ...data.byAssistant.map((a) => a.cost))
  const maxReason = Math.max(1, ...data.byEndedReason.map((r) => r.calls))
  const errors = data.byEndedReason.filter((r) => r.severity === 'error').reduce((sum, r) => sum + r.calls, 0)

  return [
    el('div', { className: 'kpis' }, [
      kpi('Calls', String(totals.calls)),
      kpi('Cost', money(totals.cost)),
      kpi('Avg duration', duration(totals.avgDurationSec)),
      kpi('Cost / call', money(perCall))
    ]),
    errors
      ? el('p', { className: 'error small', text: `${errors} call${errors === 1 ? '' : 's'} ended with an error.` })
      : el('p', { className: 'muted small', text: 'No calls ended with an error.' }),
    el('h2', { text: 'Calls per day' }),
    dailyChart(data),
    el('h2', { text: 'Cost by assistant' }),
    data.byAssistant.length
      ? el(
          'div',
          { className: 'breakdown' },
          data.byAssistant.slice(0, 15).map((a) =>
            el('div', { className: 'breakdown-row' }, [
              el('span', { className: 'b-label', text: a.name }),
              el('span', { className: 'b-value muted small', text: `${a.calls} · ${money(a.cost)}` }),
              meter(a.cost / maxAssistantCost)
            ])
          )
        )
      : el('p', { className: 'muted', text: 'No calls.' }),
    el('h2', { text: 'How calls ended' }),
    el(
      'div',
      { className: 'breakdown' },
      data.byEndedReason.map((r) =>
        el('div', { className: 'breakdown-row' }, [
          el('span', { className: `b-label ${r.severity}`, text: r.reason }),
          el('span', { className: 'b-value muted small', text: String(r.calls) }),
          meter(r.calls / maxReason, r.severity)
        ])
      )
    ),
    el('h2', { text: 'Cost breakdown' }),
    el(
      'table',
      { className: 'net' },
      data.costs.map((line) =>
        el('tr', { className: line.label === 'Total' ? 'total' : '' }, [
          el('td', { text: line.label }),
          el('td', { className: 'num', text: money(line.amount) }),
          el('td', {
            className: 'num muted small',
            text: line.label === 'Total' || !totals.cost ? '' : `${Math.round((line.amount / totals.cost) * 100)}%`
          })
        ])
      )
    )
  ]
}

export function insightsView(actions: InsightActions): HTMLElement {
  let range: InsightRange = '7d'
  let latest = 0
  const rangeSelect = el('select', { className: 'input small', attrs: { 'aria-label': 'Time range' } })
  for (const option of RANGES) {
    const item = el('option', { text: option.label, attrs: { value: option.value } })
    item.selected = option.value === range
    rangeSelect.append(item)
  }
  const meta = el('p', { className: 'muted small meta' })
  const body = el('div', { className: 'insights' })

  async function load(refresh: boolean): Promise<void> {
    const ticket = ++latest
    meta.textContent = ''
    body.replaceChildren(el('div', { className: 'skeleton' }), el('div', { className: 'skeleton short' }))
    const result = await actions.insights(range, refresh)
    if (ticket !== latest) return
    if (!result.ok) {
      body.replaceChildren(el('p', { className: 'error', text: result.error.message }))
      return
    }
    meta.textContent = `From Vapi analytics · fetched ${new Date(result.data.fetchedAt).toLocaleTimeString()}`
    body.replaceChildren(...render(result.data))
  }

  rangeSelect.addEventListener('change', () => {
    range = rangeSelect.value as InsightRange
    void load(false)
  })

  void load(false)
  return el('section', { className: 'section browser' }, [
    el('div', { className: 'toolbar' }, [rangeSelect, button('Refresh', () => void load(true), 'btn small')]),
    meta,
    body
  ])
}

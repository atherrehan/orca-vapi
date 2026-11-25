// One call: outcome, tool-call timeline (failures first-class), transcript, costs and raw JSON.
import type { CallDetail, ToolCallEntry } from '../../shared/protocol.ts'
import { button, el } from '../dom.ts'
import { dateTime, duration, money, offset } from '../format.ts'
import { jsonTree } from './json-tree.ts'

function toolCall(entry: ToolCallEntry): HTMLElement {
  const status = entry.failed
    ? el('span', { className: 'error small', text: `✕ ${entry.reason ?? 'Failed'}` })
    : el('span', { className: 'ok small', text: '✓' })
  const timing = entry.seconds === null ? '' : `${entry.seconds.toFixed(1)}s`
  return el('details', { className: `tool${entry.failed ? ' failed' : ''}` }, [
    el('summary', {}, [
      el('span', { className: 'muted mono small', text: offset(entry.at) }),
      el('span', { className: 'mono tool-name', text: entry.name }),
      status,
      el('span', { className: 'spacer' }),
      el('span', { className: 'muted small', text: timing })
    ]),
    el('div', { className: 'tool-body' }, [
      el('p', { className: 'label small', text: 'Arguments' }),
      jsonTree(entry.arguments),
      el('p', { className: 'label small', text: 'Result' }),
      el('pre', { className: 'mono pre', text: entry.result ?? '(no result recorded)' })
    ])
  ])
}

function section(title: string, children: (HTMLElement | null)[], open = true): HTMLElement {
  const details = el('details', { className: 'section' }, [
    el('summary', { text: title }),
    ...children.filter((child): child is HTMLElement => child !== null)
  ])
  details.open = open
  return details
}

export function callDetailView(detail: CallDetail, openExternal: (url: string) => Promise<void>): HTMLElement {
  const s = detail.summary
  const failed = detail.toolCalls.filter((entry) => entry.failed).length
  const recording = detail.recordingUrl

  return el('div', { className: 'call' }, [
    el('h2', { text: s.assistantName ?? s.assistantId ?? 'Call' }),
    el('dl', { className: 'status' }, [
      el('dt', { text: 'Started' }),
      el('dd', { text: dateTime(s.startedAt ?? s.createdAt) }),
      el('dt', { text: 'Duration' }),
      el('dd', { text: duration(s.durationSec) }),
      el('dt', { text: 'Cost' }),
      el('dd', { text: money(s.cost) }),
      el('dt', { text: 'Ended' }),
      el('dd', { className: s.severity, text: detail.endedReasonText ?? s.status ?? '—' }),
      el('dt', { text: 'Caller' }),
      el('dd', { className: 'mono', text: s.customer ?? '—' })
    ]),
    el('div', { className: 'toolbar' }, [
      recording ? button('▶ Open recording', () => void openExternal(recording), 'btn small') : null,
      el('span', { className: 'muted small mono', text: s.id })
    ].filter((child): child is HTMLElement => child !== null)),
    detail.analysis.summary ? section('Summary', [el('p', { text: detail.analysis.summary })]) : null,
    section(
      `Tool calls (${detail.toolCalls.length}${failed ? `, ${failed} failed` : ''})`,
      detail.toolCalls.length
        ? detail.toolCalls.map(toolCall)
        : [el('p', { className: 'muted', text: 'No tool calls in this call.' })]
    ),
    section(
      `Transcript (${detail.transcript.length})`,
      [
        el(
          'div',
          { className: 'transcript' },
          detail.transcript.map((turn) =>
            el('div', { className: `turn ${turn.role}` }, [
              el('span', { className: 'muted mono small', text: offset(turn.at) }),
              el('span', { className: 'who small', text: turn.role === 'assistant' ? 'AI' : 'Caller' }),
              el('span', { className: 'said', text: turn.text })
            ])
          )
        )
      ],
      failed === 0
    ),
    section(
      'Cost breakdown',
      [
        el(
          'table',
          { className: 'net' },
          detail.costs.map((line) =>
            el('tr', { className: line.label === 'Total' ? 'total' : '' }, [
              el('td', { text: line.label }),
              el('td', { className: 'num', text: money(line.amount) })
            ])
          )
        )
      ],
      false
    ),
    section(
      `Raw call${detail.redacted ? ` (${detail.redacted} values redacted)` : ''}`,
      [jsonTree(detail.raw)],
      false
    )
  ].filter((child): child is HTMLElement => child !== null))
}

// The "Network activity" section: every request the worker made to api.vapi.ai, without query
// values, headers or bodies.
import type { NetworkEntry } from '../../shared/protocol.ts'
import { button, el } from '../dom.ts'

function time(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString()
}

function table(entries: NetworkEntry[]): HTMLElement {
  if (entries.length === 0) {
    return el('p', { className: 'muted', text: 'No requests to api.vapi.ai yet.' })
  }
  return el('table', { className: 'net' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Time' }),
        el('th', { text: 'Request' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'ms' })
      ])
    ]),
    el(
      'tbody',
      {},
      entries.map((entry) => {
        const query = entry.queryKeys.length ? `?${entry.queryKeys.join('&')}` : ''
        return el('tr', { className: entry.outcome === 'ok' ? '' : 'error' }, [
          el('td', { text: time(entry.at) }),
          el('td', { className: 'mono', text: `${entry.method} ${entry.path}${query}` }),
          el('td', { text: entry.status === null ? entry.outcome : String(entry.status) }),
          el('td', { text: String(entry.ms) })
        ])
      })
    )
  ])
}

export function networkSection(load: () => Promise<NetworkEntry[]>): HTMLElement {
  const body = el('div', { className: 'net-body' })

  const refresh = async (): Promise<void> => {
    try {
      body.replaceChildren(table(await load()))
    } catch {
      body.replaceChildren(el('p', { className: 'error', text: 'Could not load network activity.' }))
    }
  }

  const details = el('details', { className: 'section' }, [
    el('summary', { text: 'Network activity' }),
    el('p', {
      className: 'muted small',
      text: 'Every request this plugin made to api.vapi.ai. Query values, headers and bodies are never recorded.'
    }),
    button('Refresh', () => void refresh(), 'btn small'),
    body
  ])
  details.addEventListener('toggle', () => {
    if (details.open) void refresh()
  })
  return details
}

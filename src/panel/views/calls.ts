// The call list: filter by assistant and time range, load older pages, open a call.
import type {
  CallDetail,
  CallPage,
  CallRange,
  CallSummary,
  ResourceList,
  Result
} from '../../shared/protocol.ts'
import { button, el } from '../dom.ts'
import { dateTime, duration, money } from '../format.ts'
import { callDetailView } from './call-detail.ts'

export type CallActions = {
  calls(input: { assistantId?: string; range: CallRange; before?: string; refresh?: boolean }): Promise<Result<CallPage>>
  call(id: string): Promise<Result<CallDetail>>
  assistants(): Promise<Result<ResourceList>>
  openExternal(url: string): Promise<void>
}

const RANGES: { value: CallRange; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' }
]

function select(options: { value: string; label: string }[], selected: string, label: string): HTMLSelectElement {
  const node = el('select', { className: 'input small', attrs: { 'aria-label': label } })
  for (const option of options) {
    const item = el('option', { text: option.label, attrs: { value: option.value } })
    item.selected = option.value === selected
    node.append(item)
  }
  return node
}

function row(call: CallSummary, open: () => void): HTMLElement {
  return el('li', {}, [
    el('button', { className: 'row-btn', attrs: { type: 'button' }, on: { click: open } }, [
      el('span', { className: 'row-name' }, [
        el('span', { className: `dot ${call.severity}`, attrs: { 'aria-hidden': 'true' } }),
        ` ${call.assistantName ?? call.assistantId ?? 'Unknown assistant'}`
      ]),
      el('span', { className: 'row-date muted small', text: dateTime(call.startedAt ?? call.createdAt) }),
      el('span', {
        className: 'row-sub muted',
        text: [duration(call.durationSec), money(call.cost), call.endedReason ?? call.status, call.customer]
          .filter(Boolean)
          .join(' · ')
      })
    ])
  ])
}

export function callsView(actions: CallActions): HTMLElement {
  let range: CallRange = '7d'
  let assistantId = ''
  let items: CallSummary[] = []
  let nextBefore: string | null = null
  let latest = 0

  const assistantSelect = select([{ value: '', label: 'All assistants' }], '', 'Assistant')
  const rangeSelect = select(RANGES, range, 'Time range')
  const meta = el('p', { className: 'muted small meta' })
  const body = el('div', { className: 'browser-body' })
  const more = el('div', { className: 'more' })
  const toolbar = el('div', { className: 'toolbar wrap' }, [
    assistantSelect,
    rangeSelect,
    button('Refresh', () => void load(true), 'btn small')
  ])
  const root = el('section', { className: 'section browser' }, [toolbar, meta, body, more])

  assistantSelect.addEventListener('change', () => {
    assistantId = assistantSelect.value
    void load(false)
  })
  rangeSelect.addEventListener('change', () => {
    range = rangeSelect.value as CallRange
    void load(false)
  })

  function renderList(): void {
    toolbar.hidden = false
    const failing = items.filter((call) => call.severity === 'error').length
    meta.textContent = `${items.length} call${items.length === 1 ? '' : 's'}${failing ? ` · ${failing} with errors` : ''}`
    body.replaceChildren(
      items.length === 0
        ? el('p', { className: 'muted', text: 'No calls in this range.' })
        : el('ul', { className: 'rows' }, items.map((call) => row(call, () => void open(call))))
    )
    more.replaceChildren(nextBefore ? button('Load older calls', () => void loadMore(), 'btn small') : '')
  }

  async function load(refresh: boolean): Promise<void> {
    const ticket = ++latest
    toolbar.hidden = false
    meta.textContent = ''
    more.replaceChildren()
    body.replaceChildren(el('div', { className: 'skeleton' }), el('div', { className: 'skeleton' }))
    const result = await actions.calls({ range, refresh, ...(assistantId ? { assistantId } : {}) })
    if (ticket !== latest) return
    if (!result.ok) {
      items = []
      nextBefore = null
      body.replaceChildren(el('p', { className: 'error', text: result.error.message }))
      return
    }
    items = result.data.items
    nextBefore = result.data.nextBefore
    renderList()
  }

  async function loadMore(): Promise<void> {
    if (!nextBefore) return
    const ticket = ++latest
    more.replaceChildren(el('span', { className: 'muted small', text: 'Loading…' }))
    const result = await actions.calls({ range, before: nextBefore, ...(assistantId ? { assistantId } : {}) })
    if (ticket !== latest) return
    if (!result.ok) {
      more.replaceChildren(el('p', { className: 'error', text: result.error.message }))
      return
    }
    items = [...items, ...result.data.items]
    nextBefore = result.data.nextBefore
    renderList()
  }

  async function open(call: CallSummary): Promise<void> {
    const ticket = ++latest
    toolbar.hidden = true
    meta.textContent = ''
    more.replaceChildren()
    const back = button('← Back', () => {
      latest++
      renderList()
    }, 'btn small')
    body.replaceChildren(back, el('div', { className: 'skeleton' }))
    const result = await actions.call(call.id)
    if (ticket !== latest) return
    body.replaceChildren(
      back,
      result.ok
        ? callDetailView(result.data, actions.openExternal)
        : el('p', { className: 'error', text: result.error.message })
    )
  }

  void actions.assistants().then((result) => {
    if (!result.ok) return
    for (const item of result.data.items) {
      assistantSelect.append(el('option', { text: item.name, attrs: { value: item.id } }))
    }
  })
  void load(false)
  return root
}

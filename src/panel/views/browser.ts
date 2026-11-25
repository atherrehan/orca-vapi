// Browse assistants, squads, tools and phone numbers: tabs, search, list and a redacted detail.
import type {
  ResourceDetail,
  ResourceKind,
  ResourceList,
  ResourceSummary,
  Result
} from '../../shared/protocol.ts'
import { button, el } from '../dom.ts'
import { copyText, jsonTree } from './json-tree.ts'

export type BrowserActions = {
  list(kind: ResourceKind, refresh: boolean): Promise<Result<ResourceList>>
  get(kind: ResourceKind, id: string): Promise<Result<ResourceDetail>>
}

const TABS: { kind: ResourceKind; label: string }[] = [
  { kind: 'assistant', label: 'Assistants' },
  { kind: 'squad', label: 'Squads' },
  { kind: 'tool', label: 'Tools' },
  { kind: 'phone-number', label: 'Numbers' }
]

function when(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

function matches(item: ResourceSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || `${item.name} ${item.subtitle} ${item.id}`.toLowerCase().includes(q)
}

export function resourceBrowser(actions: BrowserActions): HTMLElement {
  let kind: ResourceKind = 'assistant'
  let query = ''
  let list: ResourceList | null = null
  /** Bumped by every load and navigation, so a slow answer never overwrites a newer view. */
  let latest = 0

  const tabs = el('div', { className: 'tabs', attrs: { role: 'tablist' } })
  const search = el('input', {
    className: 'input small',
    attrs: { type: 'search', placeholder: 'Filter by name or id', 'aria-label': 'Filter' }
  })
  const meta = el('p', { className: 'muted small meta' })
  const body = el('div', { className: 'browser-body' })
  const toolbar = el('div', { className: 'toolbar' }, [
    search,
    button('Refresh', () => void loadList(true), 'btn small')
  ])
  const root = el('section', { className: 'section browser' }, [tabs, toolbar, meta, body])

  search.addEventListener('input', () => {
    query = search.value
    renderList()
  })

  function renderTabs(): void {
    tabs.replaceChildren(
      ...TABS.map((tab) => {
        const selected = tab.kind === kind
        return el('button', {
          className: `tab${selected ? ' selected' : ''}`,
          text: tab.label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(selected) },
          on: {
            click: () => {
              if (tab.kind === kind && list) return
              kind = tab.kind
              renderTabs()
              void loadList(false)
            }
          }
        })
      })
    )
  }

  function renderList(): void {
    toolbar.hidden = false
    if (!list) return
    const shown = list.items.filter((item) => matches(item, query))
    meta.textContent =
      `${shown.length} of ${list.items.length}` +
      (list.truncated ? ' (first 100 only)' : '') +
      ` · fetched ${new Date(list.fetchedAt).toLocaleTimeString()}`
    if (shown.length === 0) {
      body.replaceChildren(
        el('p', { className: 'muted', text: list.items.length ? 'No matches.' : 'Nothing here yet.' })
      )
      return
    }
    body.replaceChildren(
      el(
        'ul',
        { className: 'rows' },
        shown.map((item) =>
          el('li', {}, [
            el(
              'button',
              {
                className: 'row-btn',
                attrs: { type: 'button' },
                on: { click: () => void openDetail(item) }
              },
              [
                el('span', { className: 'row-name', text: item.name }),
                el('span', { className: 'row-sub muted', text: item.subtitle }),
                el('span', { className: 'row-date muted small', text: when(item.updatedAt) })
              ]
            )
          ])
        )
      )
    )
  }

  async function loadList(refresh: boolean): Promise<void> {
    const ticket = ++latest
    toolbar.hidden = false
    body.replaceChildren(el('div', { className: 'skeleton' }), el('div', { className: 'skeleton' }))
    meta.textContent = ''
    const result = await actions.list(kind, refresh)
    if (ticket !== latest) return
    if (!result.ok) {
      list = null
      body.replaceChildren(el('p', { className: 'error', text: result.error.message }))
      return
    }
    list = result.data
    renderList()
  }

  async function openDetail(item: ResourceSummary): Promise<void> {
    const ticket = ++latest
    toolbar.hidden = true
    meta.textContent = ''
    const back = button(
      '← Back',
      () => {
        latest++
        renderList()
      },
      'btn small'
    )
    body.replaceChildren(back, el('div', { className: 'skeleton' }))
    const result = await actions.get(kind, item.id)
    if (ticket !== latest) return
    if (!result.ok) {
      body.replaceChildren(back, el('p', { className: 'error', text: result.error.message }))
      return
    }
    const detail = result.data
    const json = JSON.stringify(detail.data, null, 2)
    const copied = el('span', { className: 'muted small' })
    const parts: (HTMLElement | null)[] = [
      el('div', { className: 'toolbar' }, [
        back,
        button(
          'Copy JSON',
          () => {
            copied.textContent = copyText(json) ? 'Copied' : 'Copy failed'
          },
          'btn small'
        ),
        copied
      ]),
      el('h2', { text: detail.summary.name }),
      el('p', { className: 'muted small mono', text: detail.summary.id }),
      detail.redacted > 0
        ? el('p', {
            className: 'badge',
            text: `${detail.redacted} secret value${detail.redacted === 1 ? '' : 's'} redacted`
          })
        : null,
      jsonTree(detail.data)
    ]
    body.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
  }

  renderTabs()
  void loadList(false)
  return root
}

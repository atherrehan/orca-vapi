// A read-only, collapsible JSON viewer. Values are rendered with textContent only.
import type { Json } from '../../shared/protocol.ts'
import { el } from '../dom.ts'

const REDACTED = '[redacted]'
const OPEN_DEPTH = 1

function scalar(value: Exclude<Json, Json[] | { [key: string]: Json }>): HTMLElement {
  if (value === null) return el('span', { className: 'j-null', text: 'null' })
  if (typeof value === 'string') {
    if (value === REDACTED) return el('span', { className: 'j-redacted', text: REDACTED })
    return el('span', { className: 'j-string', text: JSON.stringify(value) })
  }
  return el('span', { className: `j-${typeof value}`, text: String(value) })
}

function node(label: string | null, value: Json, depth: number): HTMLElement {
  const key = label === null ? null : el('span', { className: 'j-key', text: `${label}: ` })

  if (value === null || typeof value !== 'object') {
    return el('div', { className: 'j-row' }, [key, scalar(value)])
  }

  const entries: [string, Json][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value)
  const shape = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`

  if (entries.length === 0) {
    return el('div', { className: 'j-row' }, [key, el('span', { className: 'j-null', text: shape })])
  }

  const details = el('details', { className: 'j-node' }, [
    el('summary', {}, [key, el('span', { className: 'j-shape', text: shape })]),
    el(
      'div',
      { className: 'j-children' },
      entries.map(([childKey, childValue]) => node(childKey, childValue, depth + 1))
    )
  ])
  details.open = depth < OPEN_DEPTH
  return details
}

export function jsonTree(value: Json): HTMLElement {
  return el('div', { className: 'j-tree mono' }, [node(null, value, 0)])
}

/** Copies through a hidden textarea: plugin frames refuse navigator.clipboard. */
export function copyText(text: string): boolean {
  const area = el('textarea', { attrs: { readonly: '', 'aria-hidden': 'true' } })
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

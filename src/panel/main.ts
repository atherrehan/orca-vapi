// The panel. It runs in Orca's isolated frame with no network; everything it shows comes from
// the worker through orca.plugin.request. Text is only ever set with textContent, never innerHTML.
import type { VapiState } from '../shared/protocol.ts'

type Child = Node | string

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.className) node.className = props.className
  if (props.text !== undefined) node.textContent = props.text
  for (const child of children) node.append(child)
  return node
}

function keyringLabel(state: VapiState): HTMLElement {
  if (state.keyring === 'os-keyring') return el('span', { className: 'ok', text: 'OS keyring' })
  if (state.keyring === 'unavailable') {
    return el('span', { className: 'error', text: 'Unavailable: keys cannot be stored safely' })
  }
  return el('span', { className: 'warn', text: 'Unknown' })
}

function renderState(root: HTMLElement, state: VapiState): void {
  root.replaceChildren(
    el('h1', { text: 'Vapi Orca' }),
    el('p', { className: 'disclaimer', text: 'Unofficial. Not affiliated with or endorsed by Vapi.' }),
    el('dl', { className: 'status' }, [
      el('dt', { text: 'Connection' }),
      el('dd', {
        className: state.connected ? 'ok' : 'muted',
        text: state.connected ? 'Connected' : 'Not connected'
      }),
      el('dt', { text: 'Secret storage' }),
      el('dd', {}, [keyringLabel(state)])
    ]),
    el('footer', { text: `v${state.version} · read-only` })
  )
}

function renderError(root: HTMLElement, error: unknown): void {
  const code = (error as { code?: unknown })?.code
  root.replaceChildren(
    el('h1', { text: 'Vapi Orca' }),
    el('p', {
      className: 'error',
      text: `Could not reach the plugin worker${typeof code === 'string' ? ` (${code})` : ''}.`
    })
  )
}

async function start(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) return
  try {
    renderState(root, await orca.plugin.request('vapi.state'))
  } catch (error) {
    renderError(root, error)
  }
}

void start()

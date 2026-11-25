// Shown once a key is stored: connection status, the resource browser and network activity.
import type { NetworkEntry, VapiState } from '../../shared/protocol.ts'
import { button, el, footer, header } from '../dom.ts'
import { resourceBrowser, type BrowserActions } from './browser.ts'
import { callsView, type CallActions } from './calls.ts'
import { insightsView, type InsightActions } from './insights.ts'
import { networkSection } from './network.ts'

export type ConnectedActions = BrowserActions & CallActions & InsightActions & {
  disconnect(): Promise<string | null>
  network(): Promise<NetworkEntry[]>
}

const CONFIRM_MS = 4000

/** Calls, Insights and Config, each built on first visit and kept so switching keeps its state. */
function sections(actions: ConnectedActions): HTMLElement {
  const views: { label: string; build: () => HTMLElement; node?: HTMLElement }[] = [
    { label: 'Calls', build: () => callsView(actions) },
    { label: 'Insights', build: () => insightsView(actions) },
    { label: 'Config', build: () => resourceBrowser(actions) }
  ]
  const nav = el('div', { className: 'segmented', attrs: { role: 'tablist' } })
  const host = el('div')
  const show = (index: number): void => {
    nav.replaceChildren(
      ...views.map((view, i) =>
        el('button', {
          className: `seg${i === index ? ' selected' : ''}`,
          text: view.label,
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(i === index) },
          on: { click: () => show(i) }
        })
      )
    )
    const view = views[index]
    if (!view) return
    view.node ??= view.build()
    host.replaceChildren(view.node)
  }
  show(0)
  return el('div', { className: 'sections' }, [nav, host])
}

export function connectedView(state: VapiState, actions: ConnectedActions): HTMLElement {
  const message = el('p', { className: 'form-message', attrs: { role: 'status' } })
  let armed: ReturnType<typeof setTimeout> | undefined

  const disconnect = button('Disconnect', () => {
    if (armed === undefined) {
      disconnect.textContent = 'Click again to remove the key'
      disconnect.classList.add('danger')
      armed = setTimeout(() => {
        armed = undefined
        disconnect.textContent = 'Disconnect'
        disconnect.classList.remove('danger')
      }, CONFIRM_MS)
      return
    }
    clearTimeout(armed)
    armed = undefined
    disconnect.disabled = true
    void actions.disconnect().then((error) => {
      if (error === null) return
      disconnect.disabled = false
      disconnect.textContent = 'Disconnect'
      disconnect.classList.remove('danger')
      message.className = 'form-message error'
      message.textContent = error
    })
  })

  return el('main', { className: 'view' }, [
    header(),
    el('section', { className: 'section status-bar' }, [
      el('span', { className: 'dot ok', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: 'Connected' }),
      el('span', { className: 'mono muted', text: state.fingerprint ?? '' }),
      el('span', { className: 'spacer' }),
      disconnect
    ]),
    message,
    sections(actions),
    networkSection(actions.network),
    footer(state.version)
  ])
}

// Shown once a key is stored: connection status, disconnect, and network activity.
import type { NetworkEntry, VapiState } from '../../shared/protocol.ts'
import { button, el, footer, header } from '../dom.ts'
import { networkSection } from './network.ts'

export type ConnectedActions = {
  disconnect(): Promise<string | null>
  network(): Promise<NetworkEntry[]>
}

const CONFIRM_MS = 4000

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
    el('section', { className: 'section placeholder' }, [
      el('p', {
        className: 'muted',
        text: 'Assistants, calls, transcripts and insights are coming in the next milestones.'
      })
    ]),
    networkSection(actions.network),
    footer(state.version)
  ])
}

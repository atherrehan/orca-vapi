// Shown while no key is stored: the full-access warning, where to find a key, and the form.
import type { VapiState } from '../../shared/protocol.ts'
import { button, el, footer, header, openExternal } from '../dom.ts'

export const VAPI_DASHBOARD_URL = 'https://dashboard.vapi.ai'

export type OnboardingActions = {
  connect(apiKey: string): Promise<string | null>
}

export function onboardingView(state: VapiState, actions: OnboardingActions): HTMLElement {
  const keyringOk = state.keyring === 'os-keyring'

  const input = el('input', {
    className: 'input',
    attrs: {
      id: 'api-key',
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Paste your Vapi private API key'
    }
  })
  const submit = el('button', {
    className: 'btn primary',
    text: 'Connect',
    attrs: { type: 'submit' }
  })
  const message = el('p', { className: 'form-message', attrs: { role: 'status' } })

  if (!keyringOk) {
    input.disabled = true
    submit.disabled = true
    message.className = 'form-message error'
    message.textContent =
      'This machine has no OS keyring available to Orca, so Vapi Orca will not store a key here.'
  }

  const form = el(
    'form',
    {
      className: 'form',
      on: {
        submit: (event) => {
          event.preventDefault()
          const value = input.value
          input.value = ''
          if (!value.trim()) {
            message.className = 'form-message error'
            message.textContent = 'Paste a key first.'
            return
          }
          input.disabled = true
          submit.disabled = true
          message.className = 'form-message muted'
          message.textContent = 'Checking the key with Vapi (one read-only request)…'
          void actions.connect(value).then((error) => {
            if (error === null) return
            input.disabled = false
            submit.disabled = false
            message.className = 'form-message error'
            message.textContent = error
            input.focus()
          })
        }
      }
    },
    [
      el('label', { className: 'label', text: 'Private API key', attrs: { for: 'api-key' } }),
      input,
      el('div', { className: 'row' }, [submit]),
      message
    ]
  )

  return el('main', { className: 'view' }, [
    header(),
    el('section', { className: 'callout warn' }, [
      el('strong', { text: 'Your key has full access to your Vapi org.' }),
      el('p', {
        text:
          'Vapi private keys cannot be limited to read-only. Vapi Orca itself only reads ' +
          '(GET requests and analytics queries), but if you can, connect a dedicated or development org.'
      })
    ]),
    el('section', { className: 'section' }, [
      el('h2', { text: 'Connect' }),
      el('p', {
        className: 'muted',
        text: 'In the Vapi Dashboard, open Organization → API Keys and copy a private key.'
      }),
      button('Open Vapi Dashboard', () => void openExternal(VAPI_DASHBOARD_URL), 'btn link'),
      form
    ]),
    el('section', { className: 'section' }, [
      el('h2', { text: 'How your key is handled' }),
      el('ul', { className: 'facts' }, [
        el('li', { text: 'Stored encrypted in your OS keyring through Orca. Never in plain files.' }),
        el('li', { text: 'Sent only to https://api.vapi.ai, and only by the plugin worker.' }),
        el('li', { text: 'Never shown again: the panel only sees its last four characters.' }),
        el('li', { text: 'Disconnect removes it from the keyring.' })
      ])
    ]),
    footer(state.version)
  ])
}

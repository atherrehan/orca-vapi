// The panel. It runs in Orca's isolated frame with no network; everything it shows comes from
// the worker through orca.plugin.request. The key typed here is handed straight to the worker
// and never kept: the input is cleared before the request is sent.
import type { Result, VapiState } from '../shared/protocol.ts'
import { el, header, openExternal } from './dom.ts'
import { connectedView } from './views/connected.ts'
import { onboardingView } from './views/onboarding.ts'

/** Connect makes one request to Vapi (10 s timeout, up to two 429 retries); give the worker 30 s. */
const CONNECT_TIMEOUT_MS = 30_000

const root = document.getElementById('app')

function show(view: HTMLElement): void {
  root?.replaceChildren(view)
}

function skeleton(): HTMLElement {
  return el('main', { className: 'view' }, [
    header(),
    el('div', { className: 'skeleton' }),
    el('div', { className: 'skeleton short' })
  ])
}

function failure(error: unknown): HTMLElement {
  const code = (error as { code?: unknown } | null)?.code
  return el('main', { className: 'view' }, [
    header(),
    el('p', {
      className: 'error',
      text: `Could not reach the plugin worker${typeof code === 'string' ? ` (${code})` : ''}.`
    })
  ])
}

/** A request that rejects (the worker restarted or timed out) becomes an ordinary error result,
 *  so a view never hangs on a skeleton or throws an unhandled rejection. */
async function safely<T>(request: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await request
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    return {
      ok: false,
      error: {
        code: 'internal',
        message: `The plugin worker did not answer${typeof code === 'string' ? ` (${code})` : ''}. Try again.`
      }
    }
  }
}

function render(state: VapiState): void {
  if (!state.connected) {
    show(
      onboardingView(state, {
        async connect(apiKey) {
          const result = await safely(
            orca.plugin.request('vapi.connect', { apiKey }, { timeoutMs: CONNECT_TIMEOUT_MS })
          )
          return result.ok ? null : result.error.message
        }
      })
    )
    return
  }
  show(
    connectedView(state, {
      async disconnect() {
        const result = await safely(orca.plugin.request('vapi.disconnect'))
        return result.ok ? null : result.error.message
      },
      network: () => orca.plugin.request('vapi.network.recent'),
      list: (kind, refresh) => safely(orca.plugin.request('vapi.resources.list', { kind, refresh })),
      get: (kind, id) => safely(orca.plugin.request('vapi.resources.get', { kind, id })),
      calls: (input) => safely(orca.plugin.request('vapi.calls.list', input)),
      call: (id) => safely(orca.plugin.request('vapi.calls.get', { id })),
      assistants: () => safely(orca.plugin.request('vapi.resources.list', { kind: 'assistant' })),
      openExternal
    })
  )
}

async function reload(): Promise<void> {
  try {
    render(await orca.plugin.request('vapi.state'))
  } catch (error) {
    show(failure(error))
  }
}

show(skeleton())
orca.plugin.on('vapi.changed', () => void reload())
void reload()

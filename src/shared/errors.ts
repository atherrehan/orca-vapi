// Typed errors shared by worker and panel. Only these codes and fixed messages ever leave the
// worker: raw API bodies, headers and exception messages never do, so a key cannot leak through
// an error.
export type VapiErrorCode =
  | 'not_connected'
  | 'keyring_unavailable'
  | 'invalid_key'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'too_large'
  | 'bad_response'
  | 'server_error'
  | 'blocked_by_gate'
  | 'plan_limit'
  | 'internal'

export const ERROR_MESSAGES: Readonly<Record<VapiErrorCode, string>> = {
  not_connected: 'No Vapi API key is stored. Connect first.',
  keyring_unavailable: 'This machine has no OS keyring, so the key cannot be stored safely.',
  invalid_key: 'That does not look like a Vapi private API key.',
  unauthorized: 'Vapi rejected the API key (401).',
  forbidden: 'The API key is not allowed to do that (403).',
  not_found: 'Vapi could not find that item (404).',
  rate_limited: 'Vapi is rate limiting requests. Try again shortly.',
  timeout: 'Vapi did not answer in time.',
  cancelled: 'The request was cancelled.',
  network: 'Could not reach api.vapi.ai.',
  too_large: 'The response from Vapi was too large.',
  bad_response: 'Vapi sent a response the plugin could not read.',
  server_error: 'Vapi had a server error. Try again later.',
  blocked_by_gate: 'Blocked: this plugin only makes read-only requests to known Vapi endpoints.',
  plan_limit: "That range goes past your Vapi plan's call-history retention. Pick a shorter range.",
  internal: 'Something went wrong inside the plugin.'
}

export type PublicError = {
  code: VapiErrorCode
  message: string
  status?: number
  retryAfterMs?: number
}

export class VapiError extends Error {
  readonly code: VapiErrorCode
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  constructor(code: VapiErrorCode, details: { status?: number; retryAfterMs?: number } = {}) {
    super(ERROR_MESSAGES[code])
    this.name = 'VapiError'
    this.code = code
    this.status = details.status
    this.retryAfterMs = details.retryAfterMs
  }
}

/** The only shape an error takes on its way to the panel. Unknown errors become `internal`. */
export function toPublicError(error: unknown): PublicError {
  if (!(error instanceof VapiError)) return { code: 'internal', message: ERROR_MESSAGES.internal }
  const out: PublicError = { code: error.code, message: ERROR_MESSAGES[error.code] }
  if (error.status !== undefined) out.status = error.status
  if (error.retryAfterMs !== undefined) out.retryAfterMs = error.retryAfterMs
  return out
}

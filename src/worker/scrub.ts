// Last line of defence for anything written to logs: removes known secrets and bearer tokens.
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi

export function scrub(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text.replace(BEARER, 'Bearer [redacted]')
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  return out
}

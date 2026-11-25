import { assert, test } from 'orca/testing'
import { REDACTED, isSensitiveKey, redact } from '../src/worker/redact.ts'
import { ASSISTANT, PHONE_NUMBER, SECRETS, TOOL } from './fixtures/vapi.ts'

function leaks(value: unknown): string[] {
  const text = JSON.stringify(value)
  return SECRETS.filter((secret) => text.includes(secret))
}

test('no fake secret survives redaction of any fixture', () => {
  for (const fixture of [ASSISTANT, TOOL, PHONE_NUMBER]) {
    assert.deepEqual(leaks(redact(fixture).data), [], JSON.stringify(fixture).slice(0, 40))
  }
})

test('assistant: secrets, headers, credentials and URL tokens are replaced, the rest is kept', () => {
  const { data, count } = redact(ASSISTANT)
  const out = data as typeof ASSISTANT
  assert.equal(out.name, 'Front Desk')
  assert.equal(out.firstMessage, 'Hi, how can I help?')
  assert.equal(out.model.maxTokens, 250)
  assert.equal(out.model.model, 'gpt-4.1')
  assert.equal(out.model.apiKey, REDACTED)
  assert.equal(out.server.secret, REDACTED)
  assert.deepEqual(out.server.headers, { Authorization: REDACTED, 'X-Custom': REDACTED })
  assert.equal(out.server.url, 'https://hooks.example.com/vapi?token=redacted')
  assert.equal(out.serverUrlSecret, REDACTED)
  assert.equal(out.credentialIds as unknown, REDACTED)
  assert.ok(!out.metadata.note.includes('FAKE_basic_password'))
  assert.ok(count >= 8, `count was ${count}`)
})

test('phone number: provider tokens are redacted, number and ids kept', () => {
  const out = redact(PHONE_NUMBER).data as typeof PHONE_NUMBER
  assert.equal(out.twilioAuthToken, REDACTED)
  assert.equal(out.number, '+61400000000')
  assert.equal(out.assistantId, 'asst-1111-2222')
})

test('URL query values: ID-shaped *Id params stay, everything else is redacted', () => {
  const url =
    'https://hooks.example.com/webhook?tenantId=42&restaurantId=abc-123&token=FAKE_url_token_def' +
    '&sig=xyz&t=abc&credentialId=cred-1&assistantId=has%20space'
  const { data } = redact({ url })
  const out = new URL((data as { url: string }).url)
  assert.equal(out.searchParams.get('tenantId'), '42')
  assert.equal(out.searchParams.get('restaurantId'), 'abc-123')
  for (const name of ['token', 'sig', 't', 'credentialId', 'assistantId']) {
    assert.equal(out.searchParams.get(name), 'redacted', name)
  }
})

test('transcriber context terms named `key` are kept', () => {
  const { data, count } = redact({ transcriber: { contextGeneral: [{ key: 'biryani' }] } })
  assert.deepEqual(data, { transcriber: { contextGeneral: [{ key: 'biryani' }] } })
  assert.equal(count, 0)
})

test('sensitive key detection', () => {
  for (const key of [
    'secret',
    'serverUrlSecret',
    'apiKey',
    'api_key',
    'twilioAuthToken',
    'vonageApiSecret',
    'password',
    'privateKey',
    'credentialId',
    'credentialIds',
    'credentials',
    'Authorization',
    'token',
    'accessToken'
  ]) {
    assert.ok(isSensitiveKey(key), key)
  }
  for (const key of ['maxTokens', 'name', 'model', 'voiceId', 'keypadInputPlan', 'tokens', 'id', 'key']) {
    assert.ok(!isSensitiveKey(key), key)
  }
})

test('redaction output is plain JSON and leaves null and empty values alone', () => {
  const { data, count } = redact({
    secret: null,
    apiKey: '',
    nested: { list: [1, 'two', true, null, undefined] },
    big: BigInt(5),
    nan: Number.NaN
  })
  assert.deepEqual(data, {
    secret: null,
    apiKey: '',
    nested: { list: [1, 'two', true, null, null] },
    big: '5',
    nan: null
  })
  assert.equal(count, 0)
})

test('deep nesting is cut off instead of recursing forever', () => {
  let deep: Record<string, unknown> = {}
  const root = deep
  for (let i = 0; i < 200; i++) {
    const next: Record<string, unknown> = {}
    deep.child = next
    deep = next
  }
  assert.ok(JSON.stringify(redact(root).data).includes('[too deep]'))
})

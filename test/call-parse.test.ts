import { assert, test } from 'orca/testing'
import {
  callDetail,
  costLines,
  endedReasonText,
  maskNumber,
  parseConversation,
  recordingUrl,
  severityOf,
  summarizeCall
} from '../src/worker/call-parse.ts'
import { CALL, CALL_SECRETS } from './fixtures/calls.ts'

const NAMES = new Map([['asst-1111-2222', 'Front Desk']])

test('summary: name lookup, duration, masked caller, severity', () => {
  assert.deepEqual(summarizeCall(CALL, NAMES), {
    id: 'call-0001',
    assistantId: 'asst-1111-2222',
    assistantName: 'Front Desk',
    type: 'inboundPhoneCall',
    status: 'ended',
    endedReason: 'assistant-said-end-call-phrase',
    severity: 'ok',
    startedAt: '2026-11-24T10:00:02.000Z',
    durationSec: 125,
    cost: 0.1837,
    customer: '••••••1234',
    createdAt: '2026-11-24T10:00:00.000Z'
  })
  assert.equal(summarizeCall({ id: 'x' }, NAMES), null, 'needs createdAt')
})

test('severity and readable ended reasons', () => {
  assert.equal(severityOf('customer-ended-call'), 'ok')
  assert.equal(severityOf('silence-timed-out'), 'warn')
  assert.equal(severityOf('customer-did-not-answer'), 'warn')
  assert.equal(severityOf('pipeline-error-openai-llm-failed'), 'error')
  assert.equal(severityOf(null), 'ok')
  assert.equal(endedReasonText('customer-ended-call'), 'Customer ended call')
})

test('maskNumber keeps only the last four characters', () => {
  assert.equal(maskNumber('+61400001234'), '••••••1234')
  assert.equal(maskNumber('1234'), '••••')
  assert.equal(maskNumber(null), null)
})

test('conversation: transcript without system prompt, tools matched to results', () => {
  const { transcript, toolCalls } = parseConversation(CALL)
  assert.deepEqual(
    transcript.map((turn) => [turn.role, turn.at]),
    [
      ['assistant', 1.2],
      ['user', 4.5],
      ['assistant', 120]
    ]
  )
  assert.deepEqual(
    toolCalls.map((entry) => [entry.name, entry.failed, entry.reason]),
    [
      ['search_menu_item', false, null],
      ['create_cart', true, 'Result looks like an error'],
      ['place_order', true, 'No result was recorded']
    ]
  )
  assert.equal(toolCalls[0]?.seconds, 3)
  assert.equal(toolCalls[1]?.seconds, 1.5)
  assert.deepEqual(toolCalls[0]?.arguments, { search_terms: 'biryani', apiKey: '[redacted]' })
  assert.ok(toolCalls[1]?.result?.includes('token=redacted'))
})

test('costs skip zero lines and end with the total', () => {
  assert.deepEqual(costLines(CALL), [
    { label: 'Model (LLM)', amount: 0.0047 },
    { label: 'Transcriber (STT)', amount: 0.0122 },
    { label: 'Voice (TTS)', amount: 0.0156 },
    { label: 'Vapi platform', amount: 0.1512 },
    { label: 'Total', amount: 0.1837 }
  ])
})

test('recording URL: https only', () => {
  assert.equal(recordingUrl(CALL), 'https://storage.example.com/rec/call-0001.wav')
  assert.equal(recordingUrl({ artifact: { recordingUrl: 'http://insecure.example.com/a.wav' } }), null)
  assert.equal(recordingUrl({}), null)
})

test('detail: no fake secret or full caller number anywhere, raw view without the message log', () => {
  const detail = callDetail(CALL, NAMES)
  assert.ok(detail)
  const text = JSON.stringify(detail)
  for (const secret of CALL_SECRETS) assert.ok(!text.includes(secret), secret)
  assert.equal((detail.raw as { customer: { number: string } }).customer.number, '••••••1234')
  assert.equal(detail.summary.customer, '••••••1234')
  assert.equal(detail.analysis.summary, 'Caller ordered biryani.')
  assert.equal(detail.analysis.success, 'true')
  const raw = detail.raw as { artifact: Record<string, unknown>; messages?: unknown }
  assert.equal(raw.messages, undefined)
  assert.equal(raw.artifact.messages, undefined)
  assert.equal(raw.artifact.transcript, undefined)
  assert.ok(detail.redacted >= 1)
})

test('odd input never throws', () => {
  for (const value of [null, 'x', 42, [], { artifact: { messages: 'nope' } }, { messages: [null, 5, { role: 'bot' }] }]) {
    parseConversation(value)
    costLines(value)
    recordingUrl(value)
    callDetail(value, NAMES)
  }
})

// Hand-written stand-ins for Vapi API objects. All values are fake; the "secret" strings are here
// so tests can prove they never reach the panel.
export const SECRETS = [
  'whsec_FAKE_server_secret_123',
  'Bearer FAKE.jwt.token',
  'FAKE_twilio_auth_token_456',
  'FAKE_openai_key_789',
  'FAKE_header_value_abc',
  'FAKE_url_token_def',
  'FAKE_basic_password',
  'cred-FAKE-0001'
]

export const ASSISTANT = {
  id: 'asst-1111-2222',
  orgId: 'org-0000',
  name: 'Front Desk',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  firstMessage: 'Hi, how can I help?',
  model: {
    provider: 'openai',
    model: 'gpt-4.1',
    maxTokens: 250,
    apiKey: 'FAKE_openai_key_789',
    messages: [{ role: 'system', content: 'You are a receptionist.' }]
  },
  voice: { provider: '11labs', voiceId: 'rachel' },
  server: {
    url: 'https://hooks.example.com/vapi?token=FAKE_url_token_def',
    secret: 'whsec_FAKE_server_secret_123',
    headers: { Authorization: 'Bearer FAKE.jwt.token', 'X-Custom': 'FAKE_header_value_abc' }
  },
  serverUrlSecret: 'whsec_FAKE_server_secret_123',
  credentialIds: ['cred-FAKE-0001'],
  metadata: { note: 'call me at https://admin:FAKE_basic_password@internal.example.com/' }
}

export const SQUAD = {
  id: 'squad-1',
  name: 'Support Squad',
  members: [{ assistantId: 'asst-1111-2222' }, { assistantId: 'asst-3333' }],
  createdAt: '2026-11-02T10:00:00.000Z'
}

export const TOOL = {
  id: 'tool-1',
  type: 'function',
  function: { name: 'lookupBooking', description: 'Find a booking by reference' },
  server: { url: 'https://hooks.example.com/tools', secret: 'whsec_FAKE_server_secret_123' },
  updatedAt: '2026-11-03T10:00:00.000Z'
}

export const PHONE_NUMBER = {
  id: 'pn-1',
  provider: 'twilio',
  number: '+61400000000',
  name: 'Main line',
  twilioAccountSid: 'AC_FAKE_SID',
  twilioAuthToken: 'FAKE_twilio_auth_token_456',
  assistantId: 'asst-1111-2222',
  createdAt: '2026-11-04T10:00:00.000Z'
}

export const BY_PATH: Record<string, unknown> = {
  '/assistant': [ASSISTANT, { id: 'asst-3333', name: null, model: {} }],
  [`/assistant/${ASSISTANT.id}`]: ASSISTANT,
  '/squad': [SQUAD],
  [`/squad/${SQUAD.id}`]: SQUAD,
  '/tool': [TOOL],
  [`/tool/${TOOL.id}`]: TOOL,
  '/phone-number': [PHONE_NUMBER],
  [`/phone-number/${PHONE_NUMBER.id}`]: PHONE_NUMBER
}

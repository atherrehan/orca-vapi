// A fake Vapi call with a mix of good, failed and unanswered tool calls. All values are made up.
export const CALL = {
  id: 'call-0001',
  assistantId: 'asst-1111-2222',
  type: 'inboundPhoneCall',
  status: 'ended',
  endedReason: 'assistant-said-end-call-phrase',
  createdAt: '2026-11-24T10:00:00.000Z',
  startedAt: '2026-11-24T10:00:02.000Z',
  endedAt: '2026-11-24T10:02:07.000Z',
  cost: 0.1837,
  costBreakdown: { llm: 0.0047, stt: 0.0122, tts: 0.0156, vapi: 0.1512, transport: 0, total: 0.1837 },
  customer: { number: '+61400001234' },
  analysis: { summary: 'Caller ordered biryani.', successEvaluation: true },
  artifact: {
    recording: { stereoUrl: 'https://storage.example.com/rec/call-0001.wav' },
    transcript: 'AI: Hi\nUser: Hello',
    messages: [
      { role: 'system', message: 'You are a receptionist.', secondsFromStart: 0 },
      { role: 'bot', message: 'Hi, how can I help?', secondsFromStart: 1.2 },
      { role: 'user', message: 'One biryani please.', secondsFromStart: 4.5 },
      {
        role: 'tool_calls',
        secondsFromStart: 6,
        toolCalls: [
          {
            id: 'tc-1',
            type: 'function',
            function: { name: 'search_menu_item', arguments: '{"search_terms":"biryani","apiKey":"FAKE_arg_secret"}' }
          },
          { id: 'tc-2', type: 'function', function: { name: 'create_cart', arguments: { items: [1] } } },
          { id: 'tc-3', type: 'function', function: { name: 'place_order', arguments: '{}' } }
        ]
      },
      { role: 'tool_call_result', toolCallId: 'tc-1', name: 'search_menu_item', result: 'Found 3 items', secondsFromStart: 9 },
      {
        role: 'tool_call_result',
        toolCallId: 'tc-2',
        name: 'create_cart',
        result: 'Error: status code 500 from https://hooks.example.com/cart?token=FAKE_result_token',
        secondsFromStart: 7.5
      },
      { role: 'bot', message: 'Your order is placed. Bye!', secondsFromStart: 120 }
    ]
  },
  assistantOverrides: { serverUrlSecret: 'FAKE_override_secret' }
}

export const CALL_SECRETS = ['FAKE_arg_secret', 'FAKE_result_token', 'FAKE_override_secret', '+61400001234']

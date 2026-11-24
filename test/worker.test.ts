// Runs src/worker/main.ts's activate(orca) over Orca's mock host.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from '../src/worker/main.ts'

test('vapi.state reports not connected when no key is stored', async () => {
  const host = mockHost()
  const worker = await mountWorker(main, { host })
  const state = await worker.request('vapi.state')
  assert.equal(state.connected, false)
  assert.equal(state.version, main.VERSION)
  assert.ok(['os-keyring', 'unavailable', 'unknown'].includes(state.keyring))
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

import { assert, test } from 'orca/testing'
import { Limiter } from '../src/worker/limiter.ts'
import { NetworkLog } from '../src/worker/network-log.ts'
import { scrub } from '../src/worker/scrub.ts'
import { ERROR_MESSAGES, VapiError, toPublicError } from '../src/shared/errors.ts'
import type { NetworkEntry } from '../src/shared/protocol.ts'

test('scrub removes bearer tokens and known secrets', () => {
  const key = 'abcdef0123456789-secret'
  assert.equal(scrub(`Authorization: Bearer ${key}`), 'Authorization: Bearer [redacted]')
  assert.equal(scrub(`failed with ${key} twice ${key}`, [key]), 'failed with [redacted] twice [redacted]')
  assert.equal(scrub('nothing here', [null, undefined, 'short']), 'nothing here')
})

test('toPublicError exposes only a code and a fixed message', () => {
  assert.deepEqual(toPublicError(new VapiError('not_found', { status: 404 })), {
    code: 'not_found',
    message: ERROR_MESSAGES.not_found,
    status: 404
  })
  assert.deepEqual(toPublicError(new Error('raw details with secret')), {
    code: 'internal',
    message: ERROR_MESSAGES.internal
  })
})

test('Limiter hands slots over without exceeding the limit', async () => {
  const limiter = new Limiter(1)
  const order: number[] = []
  let running = 0
  let peak = 0
  await Promise.all(
    [1, 2, 3].map((n) =>
      limiter.run(async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(n)
        running--
      })
    )
  )
  assert.deepEqual(order, [1, 2, 3])
  assert.equal(peak, 1)
  assert.equal(limiter.active, 0)
})

test('Limiter frees the slot when a task throws', async () => {
  const limiter = new Limiter(1)
  await limiter.run(async () => {
    throw new Error('boom')
  }).catch(() => {})
  assert.equal(await limiter.run(async () => 'next'), 'next')
  assert.equal(limiter.active, 0)
})

test('NetworkLog keeps the newest entries, newest first', () => {
  const log = new NetworkLog(2)
  const entry = (path: string): NetworkEntry => ({
    at: '2026-11-24T08:00:00.000Z',
    method: 'GET',
    path,
    queryKeys: [],
    status: 200,
    outcome: 'ok',
    ms: 1,
    attempt: 0
  })
  log.add(entry('/a'))
  log.add(entry('/b'))
  log.add(entry('/c'))
  assert.deepEqual(
    log.recent().map((e) => e.path),
    ['/c', '/b']
  )
  log.clear()
  assert.equal(log.recent().length, 0)
})

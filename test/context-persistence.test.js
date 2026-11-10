import { test } from 'node:test'
import assert from 'node:assert/strict'
import { persistContext } from '../agent/context-persistence.js'

const origin = 'http://billion-context.inline'
const saved = { ok: true, status: 201, json: async () => ({ replica: { cpId: 'this/checkpoint' } }) }

test('a durability confirmation flushes the requested session and deletes only its own temporary checkpoint', async () => {
  const calls = []
  const warning = await persistContext({ sessionId: 'session-a', origin, fetchFn: async (url, options) => {
    calls.push({ url, ...options }); return options.method === 'POST' ? saved : { ok: true }
  } })
  assert.equal(warning, '')
  assert.equal(JSON.parse(calls[0].body).sessionId, 'session-a')
  assert.equal(JSON.parse(calls[0].body).pinned, false)
  assert.equal(calls[1].url, origin + '/__bili/replicas/this%2Fcheckpoint')
  assert.equal(calls[1].method, 'DELETE')
})

test('native fallback needs no checkpoint; unsupported or failed storage reports a warning instead of throwing', async () => {
  const unused = async () => { throw new Error('must not call the adapter') }
  assert.equal(await persistContext({ enabled: false, origin, sessionId: 'a', fetchFn: unused }), '')
  assert.equal(await persistContext({ origin: '', sessionId: 'a', fetchFn: unused }), '')
  assert.equal(await persistContext({ origin, sessionId: 'a', fetchFn: async () => ({ status: 404 }) }), '')
  for (const status of [501, 500]) {
    assert.match(await persistContext({ origin, sessionId: 'a', fetchFn: async () => ({ status, ok: false }) }), /未确认落盘/)
  }
  assert.match(await persistContext({ origin, sessionId: 'a', fetchFn: async () => { throw new Error('disk failure') } }), /原始 Pi 会话仍保留/)
})

test('cleanup failures preserve the successful save; a delayed save is still cleaned after its deadline', async () => {
  assert.match(await persistContext({ origin, sessionId: 'a', fetchFn: async (_url, options) => options.method === 'POST' ? saved : { ok: false } }), /已保存/)
  const pending = Promise.withResolvers(), calls = []
  const warning = await persistContext({ origin, sessionId: 'a', timeoutMs: 1, fetchFn: async (_url, options) => {
    calls.push(options.method); return options.method === 'POST' ? pending.promise : { ok: true }
  } })
  assert.match(warning, /未确认落盘/)
  pending.resolve(saved); await new Promise(setImmediate)
  assert.deepEqual(calls, ['POST', 'DELETE'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

test('real Pi and billion-context retain compressed facts across processes, restore originals and isolate concurrent workspaces', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/sdk-context.js', import.meta.url))
  const { stdout } = await promisify(execFile)(process.execPath, [fixture], { maxBuffer: 1024 * 1024, timeout: 60000 })
  const result = JSON.parse(stdout.trim().split('\n').at(-1))
  assert.equal(result.ok, true)
  assert.equal(result.processResume, true)
  assert.equal(result.isolated, true)
  assert.equal(result.restored, true)
})

test('actual SDK clients preserve proxy paths and effort, support anonymous endpoints and use protocol-specific credentials', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/sdk-http.js', import.meta.url))
  const { stdout } = await promisify(execFile)(process.execPath, [fixture], { maxBuffer: 1024 * 1024, timeout: 60000 })
  const result = JSON.parse(stdout.trim().split('\n').at(-1))
  assert.equal(result.ok, true)
  assert.equal(result.requests, 4)
  assert.equal(result.anonymous, true)
  assert.equal(result.credentialIsolation, true)
  assert.equal(result.proxyPrefix, true)
  assert.equal(result.selectedEffort, true)
})

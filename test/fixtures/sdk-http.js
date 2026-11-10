// Exercise actual SDK clients, including anonymous endpoints, over local SSE.
import http from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRuntime } from '../../agent/runtime.js'
import { configureBillionContext } from '../../agent/paths.js'

delete process.env.NODE_TEST_CONTEXT

// Explicitly anonymous requests must not inherit ambient credentials.
process.env.OPENAI_API_KEY = 'ambient-fixture-key-must-not-leak'
process.env.ANTHROPIC_API_KEY = 'ambient-fixture-key-must-not-leak'
const cases = [
  { api: 'openai', key: '' }, { api: 'anthropic', key: '' },
  { api: 'openai', key: 'fixture-key' }, { api: 'anthropic', key: 'fixture-key' },
]
const home = await mkdtemp(path.join(tmpdir(), 'sulan-sdk-http-')), folder = path.join(home, 'project')
await mkdir(folder)
await configureBillionContext(home)
let active, requests = 0, failure
const server = http.createServer(async (request, response) => {
  try {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw), anthropic = active.api === 'anthropic'
    requests++
    assert.equal(new URL(request.url, 'http://fixture').pathname, anthropic ? '/proxy/v1/messages' : '/proxy/v1/chat/completions')
    assert.equal(request.headers.authorization, !anthropic && active.key ? 'Bearer fixture-key' : undefined)
    assert.equal(request.headers['x-api-key'], anthropic && active.key ? 'fixture-key' : undefined)
    if (!anthropic) assert.equal(body.reasoning_effort, 'high')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (anthropic) {
      const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
      event('message_start', { message: { id: 'msg_fixture', type: 'message', role: 'assistant', content: [], model: body.model,
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0 } } })
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Fixture complete.' } })
      event('content_block_stop', { index: 0 })
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } })
      event('message_stop', {})
    } else {
      const chunk = (delta, finish_reason) => response.write('data: ' + JSON.stringify({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk',
        created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
      chunk({ role: 'assistant', content: 'Fixture complete.' }, null); chunk({}, 'stop'); response.write('data: [DONE]\n\n')
    }
    response.end()
  } catch (error) { failure = error; response.destroy(error) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  for (const [index, item] of cases.entries()) {
    active = item
    const workspace = { id: 'http-' + index, name: 'HTTP fixture', folder, windows: [] }
    const runtime = await createRuntime({ home, workspace, workspaceRegistry: new Map([[workspace.id, workspace]]), billionContext: true,
      config: { endpoint: `http://127.0.0.1:${server.address().port}/proxy/v1/${item.api === 'anthropic' ? 'messages' : 'chat/completions'}`,
        model: 'fixture-' + index, apiKey: item.key, effort: 'high' } })
    try { assert.equal(await runtime.run('Check this local fixture.'), 'Fixture complete.') }
    catch (error) { throw failure || error }
    finally { runtime.dispose() }
  }
  assert.equal(requests, cases.length)
  console.log(JSON.stringify({ ok: true, requests, proxyPrefix: true, anonymous: true, credentialIsolation: true, selectedEffort: true }))
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await rm(home, { recursive: true, force: true })
}

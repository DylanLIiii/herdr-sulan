// Real remote-observation SDK session: no local coding tools or real HC calls.
import http from 'node:http'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startAgentServer } from '../../agent/server.js'

delete process.env.NODE_TEST_CONTEXT
const root = await mkdtemp(path.join(tmpdir(), 'sulan-sdk-remote-')), folder = path.join(root, 'lookalike')
await mkdir(folder)
const sentinel = path.join(folder, 'must-not-touch.txt'); await writeFile(sentinel, 'local data stays untouched')
let requests = 0
const model = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw), done = body.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'tool_result'))
  requests++
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  event('message_start', { message: { id: 'msg_' + requests, type: 'message', role: 'assistant', content: [], model: body.model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 0 } } })
  event('content_block_start', { index: 0, content_block: done ? { type: 'text', text: '' } : { type: 'tool_use', id: 'remote-read', name: 'hc_read', input: {} } })
  event('content_block_delta', { index: 0, delta: done ? { type: 'text_delta', text: '已通过 HC 读取远程终端；当前仅提供观察与建议。' }
    : { type: 'input_json_delta', partial_json: JSON.stringify({ workspaceId: 'remote', terminal: 'hub/t7', lines: 60 }) } })
  event('content_block_stop', { index: 0 })
  event('message_delta', { delta: { stop_reason: done ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } })
  event('message_stop', {}); response.end()
})
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
let runtime, captured, service
const commands = []
try {
  service = await startAgentServer({ home: path.join(root, 'agent'), port: 0, runtimeFactory: async options => {
    captured = options
    const { createRuntime } = await import('../../agent/runtime.js')
    runtime = await createRuntime({ ...options, hcExec: async (...args) => { commands.push(args); return { stdout: '{"complete":false,"text":"REMOTE_EVIDENCE"}' } } })
    return runtime
  } })
  const workspace = { id: 'remote', name: 'Remote', folder, machine: 'hub', windows: [{ address: 'hub/t7' }] }
  const job = await service.service.start({ workspaceId: workspace.id, workspaces: [workspace], question: '读取远程窗口。', clientTurnId: 'remote',
    config: { endpoint: `http://127.0.0.1:${model.address().port}/v1/messages`, model: 'fixture-remote', apiKey: 'fixture-key' } })
  await service.service.jobs.get(job.id).task
  const answer = await service.service.get(job.id)
  assert.equal(answer.status, 'complete', answer.error)
  assert.equal(answer.workspaceMode, 'observe')
  assert.match(answer.text, /远程终端/)
  assert.deepEqual(runtime.session.getActiveToolNames().filter(name => ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'].includes(name)), [])
  assert.ok(runtime.session.getActiveToolNames().includes('hc_read'))
  assert.deepEqual(commands[0].slice(0, 2), ['hc', ['read', '--json', '--lines', '60', 'hub/t7']])
  assert.notEqual(captured.workspace.observerFolder, folder)
  assert.equal(await readFile(sentinel, 'utf8'), 'local data stays untouched')
  console.log(JSON.stringify({ ok: true, requests, remoteObservation: true, noCodingTools: true }))
} finally {
  await service?.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve))
  await rm(root, { recursive: true, force: true })
}
process.exit(0)

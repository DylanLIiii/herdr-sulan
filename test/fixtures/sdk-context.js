// Real SDK/extension integration against a deterministic local Anthropic wire.
// Worker processes keep bili's fetch patches out of node:test and prove disk resume.
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const ORIGINAL = 'ORIGINAL_ONLY_ZEBRA_953', FACT = 'ALPHA-42'
const toolNames = { hc: 'hc_read', status: 'acp_status', compress: 'compress', decompress: 'decompress' }
const summary = 'm00001–m00004 workspace lookup\n已通过 hc_read 读取 Fixture 工作区的终端，获得测试标记 ALPHA-42。之前的长资料已阅读，工作区 ID 为 fixture，终端为 t-fixture。'

async function worker(configFile, stage) {
  // Native bili intentionally skips bootstrap in node:test workers.
  delete process.env.NODE_TEST_CONTEXT
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  const { configureBillionContext } = await import('../../agent/paths.js')
  await configureBillionContext(config.home)
  const { createRuntime } = await import('../../agent/runtime.js')
  const workspace = { id: 'fixture', name: 'Fixture', folder: config.folder, windows: [{ address: 't-fixture' }] }
  const second = { id: 'second', name: 'Second', folder: config.secondFolder, windows: [] }
  const registry = new Map([[workspace.id, workspace], [second.id, second]])
  const options = { home: config.home, workspace, workspaceRegistry: registry,
    externalSessionsRoot: path.join(config.home, 'empty-external'),
    hcExec: async () => ({ stdout: JSON.stringify({ complete: true,
      text: `Fact ${FACT}. Original detail ${ORIGINAL}. ` + 'Previously consumed project notes. '.repeat(200) }) }),
    config: { endpoint: config.origin + '/v1/messages', model: 'fixture-a', apiKey: 'fixture-key' } }
  const runtimes = []
  const control = phase => new Promise((resolve, reject) => {
    const request = http.request(config.origin + '/control', { method: 'POST' }, response => {
      let raw = ''; response.on('data', chunk => { raw += chunk }); response.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (error) { reject(error) }
      })
    })
    request.on('error', reject); request.end(JSON.stringify({ phase }))
  })
  try {
    const runtime = await createRuntime(options); runtimes.push(runtime)
    if (stage === 'fold') {
      await control('hc'); await runtime.run('Read the registered terminal and retain the important facts.')
      for (let index = 0; index < 4; index++) {
        await control('filler' + index); await runtime.run(`Close independent checkpoint ${index}.`)
      }
      await control('status'); await runtime.run('Inspect context refs.')
      await control('compress'); await runtime.run('Compress the consumed first turn, preserving its known marker.')
      const status = await control('folded')
      assert.ok(status.blockId)
      await runtime.run('Continue with compacted history.')
      return { sessionId: runtime.sessionId }
    }
    assert.equal(runtime.sessionId, config.sessionId, 'resuming a workspace must keep its session ID')
    await control('resumed'); await runtime.run('Read the retained summary after process restart.')
    await control('decompress'); await runtime.run('Restore the precise original details.')
    const other = await createRuntime({ ...options, workspace: second,
      config: { ...options.config, model: 'fixture-b' } }); runtimes.push(other)
    assert.notEqual(other.sessionId, runtime.sessionId)
    await control('isolation')
    await Promise.all([runtime.run('Continue the first project.'), other.run('Inspect this separate project.')])
    return { sessionId: runtime.sessionId, otherSessionId: other.sessionId }
  } finally { for (const runtime of runtimes.reverse()) runtime.dispose() }
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'sulan-sdk-context-'))
  const home = path.join(root, 'agent'), folder = path.join(root, 'a'), secondFolder = path.join(root, 'b')
  await Promise.all([mkdir(home), mkdir(folder), mkdir(secondFolder)])
  // Test-only small recent buffer makes a finite fixture eligible for folding.
  // Runtime defaults and the user's compression policy are not changed.
  await writeFile(path.join(home, 'billion-context.json'), JSON.stringify({ compress: { preserveRecentTokens: 128 } }))
  let phase = 'hc', blockId = '', modelCalls = 0
  const observations = [], declarations = new Set()
  const server = http.createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      if (request.url === '/control') {
        phase = body.phase
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ blockId })); return
      }
      assert.equal(new URL(request.url, 'http://fixture').pathname, '/v1/messages')
      if (request.headers['x-api-key'] !== 'fixture-key') throw new Error('Fixture model authentication differed')
      modelCalls++
      for (const tool of body.tools || []) declarations.add(tool.name)
      const id = phase + '_call'
      const parts = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
      const done = parts.find(part => part.type === 'tool_result' && part.tool_use_id === id)
      const plain = !toolNames[phase], finish = Boolean(done) || plain
      const text = JSON.stringify(body.messages)
      observations.push({ phase, model: body.model, afterTool: Boolean(done), original: text.includes(ORIGINAL), fact: text.includes(FACT) })
      if (done && phase === 'compress') {
        const receipt = typeof done.content === 'string' ? done.content : JSON.stringify(done.content)
        blockId = receipt.match(/\bb\d+\b/)?.[0] || ''
      }
      const params = phase === 'status' ? { scope: 'uncompressed', view: 'messages', tool: 'text' }
        : phase === 'compress' ? { content: summary }
          : phase === 'decompress' ? { blockId, full: true } : { workspaceId: 'fixture', terminal: 't-fixture', lines: 80 }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
      event('message_start', { message: { id: 'msg_' + modelCalls, type: 'message', role: 'assistant', content: [], model: body.model,
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 0 } } })
      if (!finish) {
        event('content_block_start', { index: 0, content_block: { type: 'tool_use', id, name: toolNames[phase], input: {} } })
        event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(params) } })
      } else {
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: `${phase} complete.` } })
      }
      event('content_block_stop', { index: 0 })
      event('message_delta', { delta: { stop_reason: finish ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } })
      event('message_stop', {}); response.end()
    } catch (error) { console.error('Fixture HTTP failure:', error.message); response.destroy(error) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const configFile = path.join(root, 'fixture.json')
  const config = { home, folder, secondFolder, origin: `http://127.0.0.1:${server.address().port}` }
  const execute = promisify(execFile)
  const run = async stage => {
    const { stdout } = await execute(process.execPath, [fileURLToPath(import.meta.url), 'worker', configFile, stage], { maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout.trim().split('\n').at(-1))
  }
  let passed = false
  try {
    await writeFile(configFile, JSON.stringify(config))
    const folded = await run('fold')
    const foldView = observations.find(item => item.phase === 'folded')
    assert.ok(blockId, 'the real compressor must produce a block')
    assert.equal(foldView.original, false, 'old raw tool details must leave the model request')
    assert.equal(foldView.fact, true, 'the summary must retain its key fact')
    await writeFile(configFile, JSON.stringify({ ...config, sessionId: folded.sessionId }))
    const resumed = await run('resume')
    const resumeView = observations.find(item => item.phase === 'resumed')
    assert.equal(resumeView.original, false, 'compressed state must survive a fresh process')
    assert.equal(resumeView.fact, true)
    assert.equal(observations.find(item => item.phase === 'decompress' && item.afterTool)?.original, true, 'decompression must restore exact old details')
    const otherView = observations.find(item => item.phase === 'isolation' && item.model === 'fixture-b')
    assert.equal(otherView.original, false)
    assert.equal(otherView.fact, false, 'another workspace must not inherit this workspace memory')
    assert.equal(observations.find(item => item.phase === 'isolation' && item.model === 'fixture-a')?.original, true)
    for (const tool of ['hc_read', 'compress', 'decompress', 'search_context', 'acp_status']) assert.ok(declarations.has(tool))
    assert.ok(!declarations.has('acp_delegate'), 'context compression must not enable delegation')
    passed = true
    console.log(JSON.stringify({ ok: true, modelCalls, folded: true, restored: true, processResume: true,
      isolated: true, sessionId: resumed.sessionId }))
  } catch (error) {
    error.message += `\nFixture state: ${root}`; throw error
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    if (passed) await rm(root, { recursive: true, force: true })
  }
}

try {
  if (process.argv[2] === 'worker') console.log(JSON.stringify(await worker(process.argv[3], process.argv[4])))
  else await main()
  process.exit(0)
} catch (error) { console.error(error.stack || error); process.exit(1) }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { startAgentServer } from '../agent/server.js'
import { historyTools } from '../agent/history-tools.js'
import { sessionEntries } from '../agent/session-history.js'
import { startAgentTurn, readAgentJob } from '../mods/sulan/agent-client.js'
import { installSulan } from '../scripts/install-layout.js'

const config = { endpoint: 'http://127.0.0.1:3425/v1/messages', model: 'fixture/model', apiKey: 'example-model-key' }
const parsed = result => JSON.parse(result.content[0].text)
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sulan-agent-test-'))
  const folder = path.join(root, 'project'); await mkdir(folder)
  const workspace = { id: 'project', name: 'Project', folder, windows: [{ address: 't7', status: 'working' }] }
  return { root, folder, workspace, home: path.join(root, 'agent'), external: path.join(root, 'external') }
}

test('installer embeds a private Agent connection without returning its token in install output', async () => {
  const f = await fixture(), token = 'fixture-private-connection-token'
  const installed = await installSulan({ home: path.join(f.root, 'app'), name: 'fixture-agent',
    agentConnection: { endpoint: 'http://127.0.0.1:3426', token } })
  const layout = JSON.parse(await readFile(installed.layoutPath, 'utf8'))
  const findSidebar = node => node.content?.props?.role === 'sidebar' ? node : (node.children || []).map(findSidebar).find(Boolean)
  const props = findSidebar(layout).content.props
  assert.equal(props.agentEndpoint, 'http://127.0.0.1:3426')
  assert.equal(props.agentToken, token)
  assert.equal(installed.agentConfigured, true)
  assert.equal(JSON.stringify(installed).includes(token), false)
  assert.equal((await stat(installed.layoutPath)).mode & 0o777, 0o600)
  assert.equal((await stat(path.join(installed.modDir, 'agent-client.js'))).isFile(), true)
})

test('authenticated Agent jobs stream tools, retain model choice and recover a completed request after restart', async t => {
  const f = await fixture(), calls = []
  const runtimeFactory = async options => {
    calls.push(options)
    return { sessionId: 'session-fixture', contextEngine: 'fixture', dispose() {}, abort: async () => {},
      async run(prompt, { onEvent }) {
        onEvent({ type: 'tool_execution_start', toolName: 'hc_workspaces', toolCallId: 'call-1' })
        onEvent({ type: 'tool_execution_end', toolName: 'hc_workspaces', toolCallId: 'call-1', isError: false })
        onEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '资料已读取。' } })
        return '资料已读取，来自 Project 工作区。'
      } }
  }
  let server = await startAgentServer({ home: f.home, port: 0, billionContext: false, runtimeFactory })
  t.after(async () => server.close())
  const connection = () => ({ agentEndpoint: server.connection.endpoint, agentToken: server.connection.token })
  const body = { workspaceId: 'project', workspaces: [f.workspace], question: '读一下项目。', config, clientTurnId: 'turn-1' }
  const initial = await startAgentTurn(connection(), body)
  await server.service.jobs.get(initial.id).task
  const answer = await readAgentJob(connection(), initial.id)
  assert.equal(answer.status, 'complete')
  assert.equal(answer.tools[0].status, 'complete')
  assert.equal(calls[0].config.model, 'fixture/model')
  assert.equal(answer.sessionId, 'session-fixture')
  assert.equal((await startAgentTurn(connection(), body)).id, initial.id, 'same request must not run tools twice')
  assert.equal(calls.length, 1)
  const journal = await readFile(path.join(f.home, 'jobs', `${initial.id}.json`), 'utf8')
  assert.ok(!journal.includes(config.apiKey), 'credentials must not enter the response journal')
  assert.equal((await stat(path.join(f.home, 'connection.json'))).mode & 0o777, 0o600)
  await server.close()
  server = await startAgentServer({ home: f.home, port: 0, billionContext: false, runtimeFactory })
  const resumed = await startAgentTurn(connection(), body)
  assert.equal(resumed.id, initial.id)
  assert.equal(resumed.status, 'complete')
  assert.equal(calls.length, 1, 'restarting the server must not replay a completed coding request')
})

test('the local coding service rejects missing credentials and cross-origin browser requests', async t => {
  const f = await fixture()
  const server = await startAgentServer({ home: f.home, port: 0, billionContext: false, runtimeFactory: async () => { throw Error('should not run') } })
  t.after(() => server.close())
  assert.equal((await fetch(server.connection.endpoint + '/health')).status, 401)
  assert.equal((await fetch(server.connection.endpoint + '/health', { headers: { Authorization: `Bearer ${server.connection.token}`, Origin: 'https://other.example' } })).status, 403)
  const response = await fetch(server.connection.endpoint + '/health', { headers: { Authorization: `Bearer ${server.connection.token}` } })
  assert.equal((await response.json()).agent, 'pi')
})

test('cancellation settles a job, reset starts a fresh session, and one directory cannot have two active writers', async t => {
  const f = await fixture(), started = Promise.withResolvers(), gate = Promise.withResolvers(), fresh = []
  let attempt = 0
  const server = await startAgentServer({ home: f.home, port: 0, billionContext: false, runtimeFactory: async options => {
    const current = ++attempt; fresh.push(options.fresh)
    return { sessionId: `session-${current}`, contextEngine: 'fixture', dispose() {}, abort: async () => gate.resolve('stopped'),
      async run() { if (current === 1) { started.resolve(); return gate.promise } return '新会话回答。' } }
  } })
  t.after(() => server.close())
  const body = { workspaceId: 'project', workspaces: [f.workspace], question: '运行任务。', config, clientTurnId: 'cancel-1' }
  const first = await server.service.start(body); await started.promise
  await assert.rejects(server.service.start({ ...body, clientTurnId: 'second' }), /仍在处理/)
  const stopped = await server.service.cancel(first.id)
  assert.equal(stopped.status, 'cancelled')
  await server.service.reset({ workspaceId: 'project', workspaces: [f.workspace] })
  const next = await server.service.start({ ...body, clientTurnId: 'fresh-1' })
  await server.service.jobs.get(next.id).task
  assert.deepEqual(fresh, [false, true])
  assert.equal((await server.service.get(next.id)).sessionId, 'session-2')
})

test('a persistence warning preserves a completed coding result and cannot cause automatic replay', async t => {
  const f = await fixture(); let executions = 0
  const server = await startAgentServer({ home: f.home, port: 0, billionContext: false, runtimeFactory: async () => ({
    sessionId: 'warning-session', persistenceWarning: '压缩状态未确认落盘；原始会话保留。', dispose() {}, abort: async () => {},
    async run() { executions++; return '编码操作已经完成。' },
  }) })
  t.after(() => server.close())
  const body = { workspaceId: 'project', workspaces: [f.workspace], question: '执行编码任务。', config, clientTurnId: 'durable-warning' }
  const first = await server.service.start(body); await server.service.jobs.get(first.id).task
  const answer = await server.service.get(first.id)
  assert.equal(answer.status, 'complete')
  assert.equal(answer.text, '编码操作已经完成。')
  assert.equal(answer.error, undefined)
  assert.match(answer.statusMessage, /未确认落盘/)
  assert.equal((await server.service.start({ ...body, retry: true })).id, first.id)
  assert.equal(executions, 1)
})

test('stop during the final disk confirmation preserves completed actions without aborting or marking them retryable', async t => {
  const f = await fixture(), saving = Promise.withResolvers(), gate = Promise.withResolvers(); let aborted = 0
  const server = await startAgentServer({ home: f.home, port: 0, billionContext: false, runtimeFactory: async () => ({
    sessionId: 'saving-session', dispose() {}, abort: async () => { aborted++ },
    async run(_prompt, { onEvent }) { onEvent({ type: 'context_persistence_start' }); saving.resolve(); await gate.promise; return '已完成并保存。' },
  }) })
  t.after(() => server.close())
  const first = await server.service.start({ workspaceId: 'project', workspaces: [f.workspace], question: '执行任务。', config, clientTurnId: 'saving' })
  await saving.promise
  const stopped = server.service.cancel(first.id), wasCancelled = server.service.jobs.get(first.id).cancelled
  gate.resolve()
  assert.equal((await stopped).status, 'complete')
  assert.equal(wasCancelled, false)
  assert.equal(aborted, 0)
})

test('HC reads only a terminal registered to the requested workspace, without shell interpolation', async () => {
  const f = await fixture(), calls = []
  const tools = historyTools({ workspaceRegistry: new Map([['project', f.workspace]]), sessionsRoot: f.home, externalSessionsRoot: f.external,
    exec: async (...args) => { calls.push(args); return { stdout: JSON.stringify({ complete: false, why: 'working', text: 'screen only' }) } } })
  const read = tools.find(tool => tool.name === 'hc_read')
  await assert.rejects(read.execute('id', { workspaceId: 'project', terminal: 'other/t1' }), /不属于/)
  assert.equal(calls.length, 0)
  const response = parsed(await read.execute('id', { workspaceId: 'project', terminal: 't7', lines: 80 }))
  assert.deepEqual(calls[0].slice(0, 2), ['hc', ['read', '--json', '--lines', '80', 't7']])
  assert.equal(JSON.parse(response.output).complete, false)
  assert.equal(response.source.kind, 'terminal-output')
})

test('Pi history is scoped to workspace folders and Unicode/CRLF cursors seek to exact record boundaries', async () => {
  const f = await fixture(), sessionDir = path.join(f.external, 'project')
  await mkdir(sessionDir, { recursive: true })
  const records = [
    { type: 'session', id: 'history-a', cwd: f.folder },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: '关键决定：保留工作区来源。' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: '已经记录。' }] } },
  ]
  const file = path.join(sessionDir, 'a.jsonl')
  await writeFile(file, records.map(record => JSON.stringify(record)).join('\r\n') + '\r\n')
  await writeFile(path.join(sessionDir, 'other.jsonl'), JSON.stringify({ type: 'session', id: 'unregistered', cwd: '/unregistered' }) + '\n')
  const registry = new Map([['project', f.workspace]])
  const tools = historyTools({ workspaceRegistry: registry, sessionsRoot: path.join(f.home, 'sessions'), externalSessionsRoot: f.external })
  const execute = async (name, args) => parsed(await tools.find(tool => tool.name === name).execute('id', args))
  const sessions = await execute('agent_sessions', { workspaceId: 'project' })
  assert.equal(sessions.length, 1)
  const search = await execute('agent_history_search', { workspaceId: 'project', query: '关键决定' })
  assert.equal(search.matches[0].sessionId, 'history-a')
  const page = await execute('agent_history', { sessionId: 'history-a', cursor: search.matches[0].cursor, limit: 1 })
  assert.match(page.entries[0].text, /保留工作区来源/)
  assert.equal(page.nextCursor, Buffer.byteLength(JSON.stringify(records[0]) + '\r\n' + JSON.stringify(records[1]) + '\r\n'))
  const following = await execute('agent_history', { sessionId: 'history-a', cursor: page.nextCursor, limit: 1 })
  assert.equal(following.entries[0].text, '已经记录。')
  registry.clear()
  await assert.rejects(execute('agent_history', { sessionId: 'history-a' }), /不在已注册/)
})

test('an oversized transcript record is skipped with a source cursor instead of loading unbounded history', async () => {
  const f = await fixture(), file = path.join(f.root, 'large.jsonl')
  const oversized = JSON.stringify({ type: 'message', message: { role: 'user', content: 'x'.repeat(3 * 1024 * 1024) } }) + '\n'
  await writeFile(file, oversized + JSON.stringify({ type: 'message', message: { role: 'assistant', content: '下一条记录。' } }) + '\n')
  const records = []
  for await (const record of sessionEntries(file)) records.push(record)
  assert.equal(records[0].entry.type, 'oversized')
  assert.equal(records[1].cursor, Buffer.byteLength(oversized))
  assert.equal(records[1].entry.message.content, '下一条记录。')
})

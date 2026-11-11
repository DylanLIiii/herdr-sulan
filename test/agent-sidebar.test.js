import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './native-host.js'

const flush = () => new Promise(setImmediate)
const spaces = () => [{ id: 'a', name: 'A', folder: '/project-a', active: true, tabs: [] }]
const running = (id, text = '', tools = []) => ({ id, status: 'running', text, tools, statusMessage: '读取窗口资料' })
const complete = (id, text) => ({ id, status: 'complete', text, tools: [], statusMessage: '', sessionId: 'session-a' })
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.nodes || []).flatMap(walk)]

test('native chat shows partial Agent replies and tool steps, then stops the actual job', async () => {
  const response = Promise.withResolvers(), stopped = []
  const tools = [{ id: 'tool-1', name: 'hc_read', label: '读取窗口资料', status: 'complete' }]
  const { mod, cx, agentRequests } = await createHost({ props: { mode: 'live' }, spaces: spaces(),
    startAgentTurn: async () => running('job-a'), readAgentJob: () => response.promise,
    stopAgentTurn: async (_connection, id) => { stopped.push(id); return { ...running(id, '部分回答', tools), status: 'cancelled', statusMessage: 'Agent 已停止。' } } })
  mod.selectTab('chat', cx); mod.submitChat(cx, '读一下窗口。'); await flush()
  response.resolve(running('job-a', '部分回答', tools)); await flush()
  assert.equal(mod.turns[0].answer, '部分回答')
  assert.equal(mod.chatRunning, true)
  const toggle = walk(mod.render(cx)).find(node => node.id === 'chat-tools-0')
  assert.match(JSON.stringify(toggle.nodes), /已完成 1 步工具调用/, 'collapsed tool button summarizes step progress')
  toggle.handlers.on_click({}, cx)
  assert.equal(mod.expandedTools.has(0), true)
  const expandedNodes = walk(mod.render(cx))
  assert.ok(expandedNodes.some(node => node.styles.id?.[0] === 'chat-step-trail-0'), 'expanded tools render structured step trail card')
  assert.ok(expandedNodes.some(node => node.styles.id?.[0] === 'chat-elapsed-0'), 'running turn displays live elapsed timer badge')
  assert.equal(agentRequests[0].workspaceId, 'a')
  mod.stopChat(cx); await flush()
  assert.deepEqual(stopped, ['job-a'])
  assert.equal(mod.chatRunning, false)
  assert.equal(mod.agentJob, null)
  assert.equal(mod.turns[0].incomplete, true)
  assert.equal(mod.turns[0].answer, '部分回答')
  mod.close()
})

test('reconnecting a slow status request does not repeat the coding request or accept an older poll', async () => {
  const old = Promise.withResolvers(), fresh = Promise.withResolvers()
  let polls = 0
  const { mod, cx, timers, agentRequests } = await createHost({ props: { mode: 'live' }, spaces: spaces(),
    startAgentTurn: async () => running('job-a'), readAgentJob: () => ++polls === 1 ? old.promise : fresh.promise })
  mod.submitChat(cx, '继续任务。'); await flush()
  timers.find(timer => timer.ms === 15000).callback(cx)
  assert.equal(mod.chatRunning, false)
  assert.ok(mod.agentJob)
  mod.runChatTurn(cx); await flush()
  old.resolve(complete('job-a', '迟到的旧状态')); await flush()
  assert.equal(mod.chatRunning, true)
  assert.equal(mod.turns[0].answer, null)
  assert.ok(mod.agentPollingId, 'an older request must not clear the newer poll guard')
  fresh.resolve(complete('job-a', '恢复后的回答')); await flush()
  assert.equal(mod.turns[0].answer, '恢复后的回答')
  assert.equal(agentRequests.length, 1)
  mod.close()
})

test('workspace changes isolate late replies and reconnect the original workspace job', async () => {
  const list = [...spaces(), { id: 'b', name: 'B', folder: '/project-b', active: false, tabs: [] }]
  const old = Promise.withResolvers(); let polls = 0
  const { mod, cx, agentRequests } = await createHost({ props: { mode: 'live' }, spaces: list,
    startAgentTurn: async () => running('job-a'), readAgentJob: () => ++polls === 1 ? old.promise : Promise.resolve(complete('job-a', 'A 的回答')) })
  mod.submitChat(cx, '调查 A。'); await flush()
  list[0].active = false; list[1].active = true; mod.syncProject()
  old.resolve(complete('job-a', '只属于 A')); await flush()
  assert.equal(mod.project.id, 'b')
  assert.equal(mod.turns.length, 0)
  list[0].active = true; list[1].active = false; mod.syncProject(); mod.pollAgent(cx); await flush()
  assert.equal(mod.turns[0].answer, 'A 的回答')
  assert.equal(agentRequests.length, 1)
  mod.close()
})

test('a reloaded native view retains job identity and saved draft without starting another Agent turn', async () => {
  const storage = new Map(), waiting = Promise.withResolvers(), list = spaces()
  const first = await createHost({ storage, props: { mode: 'live' }, spaces: list,
    startAgentTurn: async () => running('job-a'), readAgentJob: () => waiting.promise })
  first.mod.submitChat(first.cx, '后台调查。'); await flush()
  const turnId = first.mod.turns[0].id
  first.input.set_value('未发送的草稿'); first.input.callbacks.change({}, first.cx)
  first.timers.filter(timer => timer.ms === 200).at(-1).callback(first.cx)
  first.mod.close()
  const second = await createHost({ storage, props: { mode: 'live' }, spaces: list,
    readAgentJob: async () => complete('job-a', '后台任务完成') })
  assert.equal(second.mod.agentJob.id, 'job-a')
  second.mod.pollAgent(second.cx); await flush()
  assert.equal(second.mod.turns[0].id, turnId)
  assert.equal(second.mod.turns[0].answer, '后台任务完成')
  assert.equal(second.input.value(), '未发送的草稿')
  assert.equal(second.agentRequests.length, 0)
  waiting.resolve(complete('job-a', '旧视图的迟到结果')); await flush()
  second.mod.close()
})

test('clearing a remote conversation waits for SDK reset confirmation', async () => {
  const reset = Promise.withResolvers()
  const { mod, cx } = await createHost({ props: { mode: 'live' }, spaces: spaces(), resetAgentSession: () => reset.promise })
  mod.submitChat(cx, '读取资料。'); await flush()
  mod.clearChat(cx); mod.clearChat(cx)
  assert.equal(mod.turns.length, 1)
  assert.equal(mod.chatResetting, true)
  reset.resolve({ ok: true }); await flush()
  assert.equal(mod.turns.length, 0)
  assert.equal(mod.chatResetting, false)
  mod.close()
})

test('an unconfigured Agent connection gives setup instructions without falling back to a model request', async () => {
  const { mod, cx, agentRequests } = await createHost({ props: { mode: 'live', agentToken: '' }, spaces: spaces(),
    completeModel: async () => { throw new Error('chat must use the Agent service') } })
  mod.submitChat(cx, '调查工作区。'); await flush()
  assert.equal(agentRequests.length, 0)
  assert.equal(mod.chatError, true)
  assert.match(mod.chatStatus, /npm run agent/)
  mod.close()
})

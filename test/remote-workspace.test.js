import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startAgentServer } from '../agent/server.js'
import { workspaceKey } from '../agent/paths.js'
import { historyTools } from '../agent/history-tools.js'
import { agentWorkspaces } from '../mods/sulan/agent-client.js'
import { gatherProjectSnapshot, contextSignature } from '../mods/sulan/context.js'

const config = { endpoint: 'http://127.0.0.1:3425/v1/messages', model: 'fixture', apiKey: '' }

test('remote windows are qualified before both summary collection and Agent observations', async () => {
  const spaces = [{ id: 'r', machine: 'hub', folder: '/remote/project', active: true, tabs: [{ id: 't' }] }]
  const agents = [{ address: 't7', space: 'r', tab: 't', title: '远程进展', status: 'working' }]
  const workspaces = agentWorkspaces(spaces, [], agents)
  assert.equal(workspaces[0].windows[0].address, 'hub/t7')
  const calls = []
  const snapshot = await gatherProjectSnapshot({ spacesList: spaces, panesList: [], agentsList: agents,
    hcFn: async args => { calls.push(args); return { code: 0, stdout: '远程终端资料' } } })
  assert.equal(calls[0][1], 'hub/t7')
  assert.notEqual(snapshot.signature, contextSignature({ ...snapshot, project: { ...snapshot.project, machine: 'other' } }))
})

test('remote questions use a private observer directory even when the remote path exists on this host', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'sulan-remote-')), folder = path.join(root, 'local-lookalike')
  await mkdir(folder)
  let received
  const server = await startAgentServer({ home: path.join(root, 'agent'), port: 0, billionContext: false,
    runtimeFactory: async options => {
      received = options
      return { sessionId: 'remote-observer', workspaceMode: 'observe', dispose() {}, abort: async () => {}, run: async () => '可通过 HC 观察远程工作区。' }
    } })
  t.after(() => server.close())
  const workspace = { id: 'remote', name: 'Remote', machine: 'hub', folder, windows: [{ address: 'hub/t7' }] }
  const job = await server.service.start({ workspaceId: workspace.id, workspaces: [workspace], question: '你可以做什么？', config, clientTurnId: 'remote-question' })
  await server.service.jobs.get(job.id).task
  assert.ok(received.workspace.observerFolder.startsWith(path.join(root, 'agent', 'observers')))
  assert.notEqual(received.workspace.observerFolder, folder)
  assert.equal((await server.service.get(job.id)).status, 'complete')
  assert.equal((await server.service.get(job.id)).workspaceMode, 'observe')
  const external = path.join(root, 'external'), own = path.join(root, 'sessions')
  await mkdir(external); await mkdir(own)
  const record = (id, cwd) => JSON.stringify({ type: 'session', id, cwd }) + '\n'
  await writeFile(path.join(external, 'lookalike.jsonl'), record('local-secret', folder))
  await writeFile(path.join(own, 'observer.jsonl'), record('own-observer', received.workspace.observerFolder))
  const tools = historyTools({ workspaceRegistry: server.service.workspaces, sessionsRoot: own, externalSessionsRoot: external })
  const list = await tools.find(tool => tool.name === 'agent_sessions').execute('call', { workspaceId: 'remote' })
  const sessions = JSON.parse(list.content[0].text)
  assert.deepEqual(sessions.map(session => session.sessionId), ['own-observer'])
  assert.equal(sessions[0].scope, 'side-chat-observer')
  await assert.rejects(tools.find(tool => tool.name === 'agent_history').execute('call', { sessionId: 'local-secret' }), /不在已注册/)
})

test('remote machine identity separates session namespaces while existing local keys remain compatible', () => {
  const workspace = { id: 'same', folder: '/project' }
  assert.equal(workspaceKey(workspace), workspaceKey({ ...workspace, machine: 'local' }))
  assert.notEqual(workspaceKey({ ...workspace, machine: 'a' }), workspaceKey({ ...workspace, machine: 'b' }))
})

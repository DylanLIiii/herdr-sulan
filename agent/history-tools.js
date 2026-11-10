import { Type } from 'typebox'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import { listSessions, sessionEntries } from './session-history.js'

const executeFile = promisify(execFile)
const string = Type.String({ minLength: 1, maxLength: 240 })
const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], details: {} })
const textOf = entry => {
  const message = entry.message
  if (!message) return ['compaction', 'oversized'].includes(entry.type) ? String(entry.summary || '') : ''
  if (typeof message.content === 'string') return message.content
  return (message.content || []).map(block => block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : block.type === 'toolCall' ? `${block.name} ${JSON.stringify(block.arguments)}` : '').filter(Boolean).join('\n')
}

export function historyTools({ workspaceRegistry, sessionsRoot, externalSessionsRoot, exec = executeFile }) {
  const workspace = id => {
    const item = workspaceRegistry.get(id)
    if (!item) throw new Error('工作区不在当前应用提供的列表中。请先列出工作区。')
    return item
  }
  const historyFolder = item => item.observerFolder || item.folder
  let cached = [], cachedAt = 0
  async function catalog() {
    if (Date.now() - cachedAt < 3000) return cached
    const folders = new Set([...workspaceRegistry.values()].map(historyFolder))
    const lists = await Promise.all([sessionsRoot, externalSessionsRoot].map(root => listSessions(root, folders)))
    cached = [...new Map(lists.flat().map(item => [item.id, item])).values()]
      .sort((a, b) => Number(new Date(b.modified)) - Number(new Date(a.modified)))
    cachedAt = Date.now()
    return cached
  }
  async function findSession(sessionId) {
    const folders = new Set([...workspaceRegistry.values()].map(historyFolder))
    const session = (await catalog()).find(item => item.id === sessionId && folders.has(item.cwd))
    if (!session) throw new Error('会话不在已注册工作区中。请先调用 agent_sessions。')
    return session
  }
  const tool = (name, label, description, parameters, run) => ({ name, label, description,
    promptSnippet: description, parameters, execute: async (_id, params, signal) => result(await run(params, signal)) })
  return [
    tool('hc_workspaces', '工作区列表', '列出应用提供的工作区及其目录；跨工作区读取前先确认 ID。', Type.Object({}), async () =>
      [...workspaceRegistry.values()].map(({ id, name, folder, machine }) => ({ id, name, folder, machine }))),
    tool('hc_windows', '工作区窗口', '列出指定工作区的终端地址、Agent 类型及状态。', Type.Object({ workspaceId: string }), async ({ workspaceId }) =>
      ({ workspaceId, windows: workspace(workspaceId).windows })),
    tool('hc_read', '读取 Agent 窗口', '读取已登记终端的有限屏幕或历史；保留 HC 返回的完整性标记。工作中的终端可能只有屏幕。',
      Type.Object({ workspaceId: string, terminal: string, lines: Type.Optional(Type.Integer({ minimum: 0, maximum: 300 })) }),
      async ({ workspaceId, terminal, lines = 60 }, signal) => {
        const item = workspace(workspaceId)
        if (!item.windows.some(window => window.address === terminal)) throw new Error('终端不属于指定工作区。')
        const { stdout } = await exec('hc', ['read', '--json', '--lines', String(lines), terminal], { signal, timeout: 15000, maxBuffer: 1024 * 1024 })
        let data
        try { data = JSON.parse(stdout) } catch { data = { text: stdout, completeness: 'unknown' } }
        const serialized = JSON.stringify(data)
        return { source: { workspaceId, terminal, kind: 'terminal-output' }, truncated: serialized.length > 16000,
          output: serialized.slice(0, 16000), note: '终端输出不等于完整 Agent 对话；需要较早细节时查 agent_sessions / agent_history。' }
      }),
    tool('agent_sessions', '查找 Agent 会话', '列出已登记工作区中的 Pi 持久会话，包括此侧聊；用于按需读取完整历史。',
      Type.Object({ workspaceId: string, limit }), async ({ workspaceId, limit = 20 }) => {
        const item = workspace(workspaceId)
        return (await catalog()).filter(session => session.cwd === historyFolder(item)).slice(0, limit).map(session => ({
          sessionId: session.id, workspaceId, firstMessage: String(session.firstMessage || '').slice(0, 200),
          modified: session.modified, messageCount: session.messageCount, source: 'pi-session', scope: item.observerFolder ? 'side-chat-observer' : 'workspace',
        }))
      }),
    tool('agent_history', '回读完整会话', '按会话 ID 和原始条目游标读取 Pi 历史；返回来源与下一游标，压缩后仍可回读旧条目。',
      Type.Object({ sessionId: string, cursor: Type.Optional(Type.Integer({ minimum: 0 })), limit }),
      async ({ sessionId, cursor = 0, limit = 20 }, signal) => {
        const session = await findSession(sessionId), totalBytes = (await stat(session.path)).size
        const output = []
        let size = 0, next = cursor, count = 0
        for await (const record of sessionEntries(session.path, cursor, { signal })) {
          const text = textOf(record.entry)
          const entry = { cursor: record.cursor, type: record.entry.type, role: record.entry.message?.role,
            text: text.slice(0, 6000), truncated: text.length > 6000 || record.entry.type === 'oversized' }
          const length = JSON.stringify(entry).length
          if (text && size + length > 20000) break
          if (text) { output.push(entry); size += length }
          next = record.nextCursor
          if (++count >= limit) break
        }
        return { source: { sessionId, cwd: session.cwd, kind: 'pi-session', cursorUnit: 'byte' }, entries: output,
          nextCursor: next < totalBytes ? next : null, totalBytes }
      }),
    tool('agent_history_search', '搜索 Agent 历史', '在工作区 Pi 会话中查关键词，默认检查每个会话最近 4MB；指定 sessionId 和 beforeCursor 可向前继续搜索。',
      Type.Object({ workspaceId: string, query: string, limit, sessionId: Type.Optional(string), beforeCursor: Type.Optional(Type.Integer({ minimum: 0 })) }),
      async ({ workspaceId, query, limit = 15, sessionId, beforeCursor }, signal) => {
        const item = workspace(workspaceId), matches = [], coverage = [], needle = query.toLowerCase()
        const sessions = (await catalog()).filter(session => session.cwd === historyFolder(item) && (!sessionId || session.id === sessionId)).slice(0, 50)
        for (const session of sessions) {
          const end = Math.min(beforeCursor ?? Infinity, (await stat(session.path)).size)
          const start = Math.max(0, end - 4 * 1024 * 1024)
          coverage.push({ sessionId: session.id, fromByte: start, toByte: end, nextBeforeCursor: start || null })
          if (!end) continue
          for await (const record of sessionEntries(session.path, start, { signal, end: end - 1 })) {
            const text = textOf(record.entry), index = text.toLowerCase().indexOf(needle)
            if (index >= 0 && matches.length < limit) matches.push({ sessionId: session.id, cursor: record.cursor, workspaceId, excerpt: text.slice(Math.max(0, index - 200), index + 1000) })
          }
          if (matches.length >= limit) break
        }
        return { matches, coverage, source: 'pi-session', note: '只搜索登记工作区；未覆盖的更早历史可继续分页搜索。' }
      }),
  ]
}

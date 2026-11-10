import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { privateJson, workspaceKey } from './paths.js'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const labels = { hc_workspaces: '查看工作区', hc_windows: '查看 Agent 窗口', hc_read: '读取窗口资料',
  agent_sessions: '查找历史会话', agent_history: '回读会话记录', agent_history_search: '检索历史',
  compress: '压缩上下文', decompress: '恢复上下文细节', search_context: '搜索上下文', acp_status: '检查上下文状态',
  read: '读取文件', grep: '搜索代码', find: '查找文件', ls: '查看目录', bash: '执行任务', edit: '修改文件', write: '写入文件' }

export class AgentService {
  constructor({ home, externalSessionsRoot, billionContext = true, runtimeFactory }) {
    this.home = home; this.externalSessionsRoot = externalSessionsRoot; this.billionContext = billionContext
    this.runtimeFactory = runtimeFactory || (async options => (await import('./runtime.js')).createRuntime(options))
    this.workspaces = new Map(); this.runtimes = new Map(); this.jobs = new Map(); this.running = new Map(); this.requests = new Map()
    this.resetMarkers = new Set()
    this.ready = readFile(path.join(home, 'resets.json'), 'utf8').then(raw => {
      this.resetMarkers = new Set(JSON.parse(raw))
    }).catch(() => {})
  }
  async registerWorkspaces(input) {
    if (!Array.isArray(input) || input.length > 100) throw fail('需要应用提供的工作区列表。')
    const next = new Map()
    for (const entry of input) {
      if (typeof entry?.id !== 'string' || !entry.id || typeof entry.folder !== 'string' || !entry.folder) continue
      const folder = await realpath(entry.folder).catch(() => path.resolve(entry.folder))
      next.set(entry.id, { id: entry.id.slice(0, 240), name: String(entry.name || '工作区').slice(0, 120), folder,
        machine: entry.machine || null, windows: (Array.isArray(entry.windows) ? entry.windows : []).slice(0, 200)
          .filter(window => typeof window?.address === 'string' && window.address.length < 240)
          .map(window => ({ address: window.address, name: String(window.name || '终端').slice(0, 120),
            programName: String(window.programName || ''), status: String(window.status || 'unknown') })) })
    }
    // Keep the Map object: already-created tools read the current registry.
    this.workspaces.clear()
    for (const [id, item] of next) this.workspaces.set(id, item)
  }
  async start({ workspaceId, workspaces, question, config, clientTurnId, retry = false, brief = '' }) {
    await this.ready
    await this.registerWorkspaces(workspaces)
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) throw fail('请先打开有目录的工作区，再使用侧聊 Agent。')
    if (workspace.machine && workspace.machine !== 'local') throw fail('这个 Agent 服务目前处理本机工作区；远程窗口仍可通过 HC 工具观察。')
    if (!(await stat(workspace.folder).catch(() => null))?.isDirectory()) throw fail('工作区目录在本机不可用；远程项目需要在对应机器运行 Agent 服务。')
    if (typeof question !== 'string' || !question.trim() || question.length > 8000) throw fail('请提供有效的问题。')
    if (!config || typeof config.model !== 'string' || typeof config.endpoint !== 'string') throw fail('缺少侧聊模型配置。')
    if (typeof clientTurnId !== 'string' || !clientTurnId || clientTurnId.length > 160) throw fail('缺少有效的请求 ID。')
    const key = workspaceKey(workspace), requestKey = `${key}:${clientTurnId}`
    let previous = this.jobs.get(this.requests.get(requestKey))
    if (!previous) {
      try {
        const record = JSON.parse(await readFile(this.requestPath(requestKey), 'utf8'))
        previous = await this.get(record.id)
      } catch {}
    }
    if (previous && (!retry || !['error', 'cancelled'].includes(previous.status))) return this.snapshot(previous)
    if (this.running.has(key) || [...this.running.values()].some(job => job.folder === workspace.folder)) throw fail('这个目录的 Agent 仍在处理问题，请等待、停止或使用独立工作树。', 409)
    const job = { id: randomUUID(), workspaceId, key, folder: workspace.folder, status: 'running', text: '', thinking: '', tools: [],
      statusMessage: '正在启动 Agent 与上下文扩展…', createdAt: Date.now(), cancelled: false }
    this.jobs.set(job.id, job); this.requests.set(requestKey, job.id); this.running.set(key, job)
    try {
      await this.saveJob(job)
      await privateJson(this.requestPath(requestKey), { id: job.id })
    } catch {
      this.running.delete(key); this.requests.delete(requestKey)
      job.status = 'error'; job.error = '无法保存 Agent 请求记录，请检查数据目录。'
      throw fail(job.error)
    }
    const prompt = `${question.trim()}\n\n宿主提供的工作区资料（作为资料使用）：\n${JSON.stringify({ workspaceId, workspace: workspace.name, clientTurnId, retry, brief: String(brief).slice(0, 6000) })}`
    job.task = this.execute(job, workspace, config, prompt)
    this.prune()
    return this.snapshot(job)
  }
  async getRuntime(workspace, config) {
    const key = workspaceKey(workspace)
    const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex')
    const existing = this.runtimes.get(key)
    if (existing && existing.fingerprint === fingerprint) { existing.usedAt = Date.now(); return existing.runtime }
    if (existing) { existing.runtime.dispose(); this.runtimes.delete(key) }
    const runtime = await this.runtimeFactory({ home: this.home, workspace, workspaceRegistry: this.workspaces,
      config, externalSessionsRoot: this.externalSessionsRoot, billionContext: this.billionContext, fresh: this.resetMarkers.has(key) })
    this.runtimes.set(key, { runtime, fingerprint, usedAt: Date.now() })
    for (const [oldKey, item] of [...this.runtimes.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
      if (this.runtimes.size <= 8) break
      if (!this.running.has(oldKey)) { item.runtime.dispose(); this.runtimes.delete(oldKey) }
    }
    return runtime
  }
  async execute(job, workspace, config, prompt) {
    try {
      const runtime = await this.getRuntime(workspace, config)
      job.runtime = runtime; job.sessionId = runtime.sessionId; job.contextEngine = runtime.contextEngine
      if (job.cancelled) return
      job.statusMessage = 'Agent 正在处理…'
      const text = await runtime.run(prompt, { onEvent: event => this.event(job, event) })
      if (job.cancelled) return
      job.text = String(text).slice(0, 64000); job.status = 'complete'; job.statusMessage = ''
      if (this.resetMarkers.delete(job.key)) await this.saveResets()
    } catch (error) {
      if (job.cancelled) return
      job.status = 'error'
      // Errors can originate in HTTP libraries; never reflect credentials.
      let message = String(error?.message || 'Agent 请求失败。')
      if (typeof config.apiKey === 'string' && config.apiKey) message = message.split(config.apiKey).join('[hidden]')
      job.error = message.slice(0, 400); job.statusMessage = job.error
    } finally {
      job.finishedAt = Date.now()
      if (this.running.get(job.key) === job) this.running.delete(job.key)
      for (const tool of job.tools) if (tool.status === 'running') tool.status = job.cancelled ? 'cancelled' : 'complete'
      if (job.runtime?.persistenceWarning) job.statusMessage = [job.statusMessage, job.runtime.persistenceWarning].filter(Boolean).join(' ')
      job.runtime = null
      try { await this.saveJob(job) } catch { job.statusMessage = '任务已结束，但响应缓存保存失败。' }
    }
  }
  event(job, event) {
    if (job.cancelled) return
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent
      if (delta?.type === 'text_delta') job.text = (job.text + delta.delta).slice(0, 64000)
      if (delta?.type === 'thinking_delta') job.thinking = (job.thinking + delta.delta).slice(0, 12000)
    } else if (event.type === 'tool_execution_start') {
      job.statusMessage = labels[event.toolName] || `使用工具：${event.toolName}`
      job.tools.push({ id: event.toolCallId, name: event.toolName, label: job.statusMessage, status: 'running' })
      if (job.tools.length > 80) job.tools.shift()
    } else if (event.type === 'tool_execution_end') {
      const tool = job.tools.find(tool => tool.id === event.toolCallId)
      if (tool) tool.status = event.isError ? 'error' : 'complete'
      job.statusMessage = 'Agent 正在整理回答…'
    } else if (event.type === 'context_persistence_start') {
      job.persisting = true; job.statusMessage = '正在保存会话与上下文…'
    } else if (event.type === 'auto_compaction_start') job.statusMessage = '正在检查上下文容量…'
    else if (event.type === 'auto_compaction_end') job.statusMessage = this.billionContext ? '上下文由 billion-context 管理' : '上下文整理结束'
    else if (event.type === 'auto_retry_start') job.statusMessage = '模型请求正在重试…'
  }
  snapshot(job) {
    return { id: job.id, workspaceId: job.workspaceId, sessionId: job.sessionId, status: job.status,
      contextEngine: job.contextEngine, text: job.text, thinking: job.thinking, tools: job.tools.map(tool => ({ ...tool })),
      statusMessage: job.statusMessage, error: job.error }
  }
  requestPath(key) { return path.join(this.home, 'requests', createHash('sha256').update(key).digest('hex') + '.json') }
  saveJob(job) { return privateJson(path.join(this.home, 'jobs', `${job.id}.json`), this.snapshot(job)) }
  async get(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{20,80}$/.test(id)) throw fail('请求 ID 无效。', 404)
    const job = this.jobs.get(id)
    if (job) return this.snapshot(job)
    let cached
    try { cached = JSON.parse(await readFile(path.join(this.home, 'jobs', `${id}.json`), 'utf8')) }
    catch { throw fail('未找到本次请求，Agent 服务可能已重启。可以手动重试。', 404) }
    if (cached.status === 'running') return { ...cached, status: 'error', error: 'Agent 服务曾中断。请先确认之前的执行结果，再手动重试。' }
    return cached
  }
  async cancel(id) {
    const job = this.jobs.get(id)
    if (!job) throw fail('未找到这次 Agent 请求。', 404)
    if (job.status !== 'running') return this.snapshot(job)
    if (job.persisting) { await job.task; return this.snapshot(job) }
    job.cancelled = true; job.status = 'cancelled'; job.statusMessage = 'Agent 已停止。'
    if (job.runtime) { await job.runtime.abort(); await job.task }
    else await this.saveJob(job)
    return this.snapshot(job)
  }
  async reset({ workspaceId, workspaces }) {
    await this.ready
    await this.registerWorkspaces(workspaces)
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) throw fail('工作区不存在。')
    const key = workspaceKey(workspace), job = this.running.get(key)
    if (job) { await this.cancel(job.id); await job.task }
    const existing = this.runtimes.get(key)
    if (existing) { existing.runtime.dispose(); this.runtimes.delete(key) }
    this.resetMarkers.add(key); await this.saveResets()
    return { ok: true, note: '下次提问创建新会话；旧记录保留在历史档案中。' }
  }
  saveResets() { return privateJson(path.join(this.home, 'resets.json'), [...this.resetMarkers]) }
  prune() {
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= 100) break
      if (job.status !== 'running') this.jobs.delete(id)
    }
    if (this.requests.size > 300) for (const [key, id] of this.requests) if (!this.jobs.has(id)) this.requests.delete(key)
  }
  async close() {
    await Promise.allSettled([...this.running.values()].map(job => this.cancel(job.id)))
    await Promise.allSettled([...this.jobs.values()].filter(job => job.task).map(job => job.task))
    for (const { runtime } of this.runtimes.values()) runtime.dispose()
    this.runtimes.clear()
  }
}

// Sulan is a focused native sidebar. Workspace tab-bar adaptation lives in
// workspace.js (Herdr App, Apache-2.0; see vendor/LICENSE.herdr-app).
import { View, div, svg } from 'gpui-kit'
import { h_flex, v_flex, TextareaState, InputState } from 'gpui-base'
import { spaces, panes, focused, agents, terminals, hc, theme, layout, props, nextCommand } from 'herdr'
import { parseSummary } from './summary.js'
import { prepareBrief } from './brief.js'
import { activeProject, gatherProjectSnapshot, buildInstantSummary } from './context.js'
import { MAX_QUESTION, MAX_ANSWER, MAX_TURNS, cleanTurns, replyFields, splitReply,
  summarySystemPrompt, summaryUserPrompt } from './chat.js'
import { completeModel } from './llm.js'
import { resolveModelSettings, validateModelSettings } from './model-settings.js'
import { modelSettingsView } from './settings-view.js'
import { fetchModels } from './models.js'
import { agentWorkspaces, validateAgentConnection, startAgentTurn, readAgentJob, stopAgentTurn, resetAgentSession } from './agent-client.js'
import { DEMO_PROJECTS } from './demo.js'
import { action, summaryView, chatView } from './view.js'
import { findNode, renderWorkspaceTabs } from './workspace.js'

const PREFIX = 'herdr.sulan.v1:'
function load(key) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key) || 'null') } catch { return null }
}
function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true } catch { return false }
}
const clock = at => {
  if (!at) return '尚未更新'
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 更新`
}

export default class Sulan extends View {
  init(initialProps, cx) {
    const p = initialProps ?? props() ?? {}
    this.role = p.role || 'sidebar'
    this.mode = p.mode === 'demo' ? 'demo' : 'live'
    this.width = 396
    this.tab = 'summary'
    this.closed = false
    this.projectKey = ''
    this.project = null
    this.snapshot = null
    this.summary = ''
    this.brief = prepareBrief(null)
    this.updatedAt = 0
    this.summarySource = ''
    this.detailsOpen = false
    this.menuOpen = false
    this.historyOpen = false
    this.page = 'content'
    this.settingsInputs = null
    this.settingsPicker = null
    this.settingsError = ''
    this.settingsNotice = ''
    this.settingsNoticeVersion = 0
    this.modelChoices = []
    this.modelsStatus = 'idle'
    this.modelsError = ''
    this.modelsSource = null
    this.modelsEpoch = 0
    this.modelQuery = ''
    this.loadingContext = false
    this.summarizing = false
    this.queuedAi = false
    this.paused = false
    this.note = ''
    this.isError = false
    this.generation = 0
    this.chatEpoch = 0
    this.chatRunning = false
    this.chatStatus = ''
    this.chatError = false
    this.agentJob = null
    this.agentStarting = null
    this.agentResumePending = null
    this.agentPollingId = null
    this.chatStopping = false
    this.chatResetting = false
    this.clientInstance = Math.random().toString(36).slice(2, 10)
    this.expandedTools = new Set()
    this.turns = []
    this.draft = ''
    this.typing = false
    this.confirmClear = false
    this.expandedThinking = new Set()
    this.spacePanels = load('space.panels') || {}
    this.pressedTab = null
    const preferences = load('prefs') || {}
    Object.assign(this, resolveModelSettings(p, preferences))
    this.focus = cx.focus_handle()
    if (this.role !== 'tabs') {
      this.input = TextareaState.new({ placeholder: '问一个关于当前项目的问题…', rows: 2 })
      this.input.on('change', (_e, cx) => {
        const wasEmpty = !this.draft.trim()
        this.draft = this.input.value()
        // Native text editing owns its own redraw. Only invalidate the outer
        // sidebar when the Send button changes between enabled and disabled.
        if (wasEmpty !== !this.draft.trim()) cx.notify()
        if (this.projectKey && !this.projectKey.startsWith('demo:')) {
          const version = (this.draftSaveEpoch || 0) + 1, key = this.projectKey
          this.draftSaveEpoch = version
          cx.timer.after(200, () => { if (!this.closed && version === this.draftSaveEpoch && key === this.projectKey) this.persistCurrentSpace() })
        }
      })
      this.input.on('submit', (event, cx) => { if (event?.secondary) this.submitChat(cx) })
      this.input.on('focus', (_e, cx) => { this.typing = true; cx.notify() })
      this.input.on('blur', (_e, cx) => { this.typing = false; this.persistCurrentSpace(); cx.notify() })
      this.syncProject()
      this.refresh(cx)
      cx.timer.every(250, cx => {
        if (!this.closed && this.currentSpaceKey() !== this.projectKey) {
          this.syncProject(); this.refresh(cx); cx.notify()
        }
      })
      cx.timer.every(500, cx => {
        if (this.closed) return
        if (this.agentResumePending && !this.chatRunning) {
          const pending = this.agentResumePending; this.agentResumePending = null
          this.runChatTurn(cx, { resume: true, connection: pending.connection })
        } else this.pollAgent(cx)
      })
      cx.timer.every(10000, cx => {
        if (!this.closed && !this.paused && this.visible() && !this.busy()) this.refresh(cx, { silent: true })
      })
    }
    cx.spawn(async cx => {
      while (!this.closed) {
        const command = await nextCommand()
        if (this.closed) return
        if (command === 'focus') this.focus.focus()
        else if (command === 'refresh') this.refresh(cx, { forceAi: true })
        else if (command === 'rebuild') this.refresh(cx, { forceAi: true, rebuild: true })
        else if (command === 'demo') this.switchMode(this.mode === 'demo' ? 'live' : 'demo', cx)
        else if (command === 'chat') this.selectTab('chat', cx)
        else if (command === 'summary') this.selectTab('summary', cx)
        else if (command === 'settings') this.openSettings(cx)
        cx.notify()
      }
    })
  }

  busy() { return this.loadingContext || this.summarizing }
  close() { this.persistCurrentSpace(); this.closed = true; this.generation++; this.chatEpoch++; this.modelsEpoch++ }
  visible() {
    const root = layout(), panel = findNode(root, 'panel'), body = findNode(root, 'panel-body')
    return !(panel && findNode(body, 'sulan') && (panel.hidden || body.active !== 'sulan'))
  }
  currentSpaceKey() {
    if (this.mode === 'demo') return 'demo:herdr-sulan'
    const project = activeProject(spaces(), panes(), focused())
    return project ? `live:${project.id}:${project.folder || project.name}` : 'live:none'
  }
  syncProject() {
    const key = this.currentSpaceKey()
    if (key === this.projectKey) return
    this.persistCurrentSpace()
    this.projectKey = key
    this.generation++; this.chatEpoch++
    this.loadingContext = false; this.summarizing = false; this.queuedAi = false; this.paused = false
    this.chatRunning = false; this.chatStatus = ''; this.chatError = false
    this.agentJob = null; this.agentStarting = null; this.agentResumePending = null; this.chatStopping = false; this.chatResetting = false
    this.expandedTools.clear()
    this.detailsOpen = false; this.historyOpen = false; this.confirmClear = false
    this.expandedThinking.clear()
    const demo = this.mode === 'demo' ? DEMO_PROJECTS[0] : null
    this.project = demo?.project || activeProject(spaces(), panes(), focused())
    const cached = demo || load(key) || {}
    this.snapshot = demo ? { project: demo.project, agents: demo.agents, contextText: demo.summary, capturedAt: Date.now() } : null
    this.setSummary(cached.summary || '', demo ? 'demo' : cached.summarySource || '', cached.updatedAt || 0)
    this.turns = cleanTurns(cached.turns)
    if (cached.agentJob?.id && this.turns.some(turn => turn.id === cached.agentJob.turnId)) {
      this.agentJob = { ...cached.agentJob, key }; this.chatRunning = true
    } else if (cached.agentPending?.turnId && this.turns.some(turn => turn.id === cached.agentPending.turnId)) this.agentResumePending = cached.agentPending
    this.draft = typeof cached.draft === 'string' ? cached.draft : ''
    this.input?.set_value(this.draft)
    this.note = ''; this.isError = false
  }
  persistCurrentSpace() {
    if (!this.projectKey || this.projectKey.startsWith('demo:')) return
    save(this.projectKey, { summary: this.summary, summarySource: this.summarySource, updatedAt: this.updatedAt,
      turns: this.turns, draft: this.draft,
      agentJob: this.agentJob ? { id: this.agentJob.id, turnId: this.agentJob.turnId, connection: this.agentJob.connection } : null,
      agentPending: this.agentStarting ? { turnId: this.agentStarting.turnId, connection: this.agentStarting.connection } : this.agentResumePending })
  }
  savePanelPrefs() { save('space.panels', this.spacePanels) }
  modelConfiguration() {
    return { summaryModel: this.summaryModel, chatModel: this.chatModel, chatEffort: this.chatEffort,
      endpoint: this.endpoint, apiKey: this.apiKey, agentEndpoint: this.agentEndpoint, agentToken: this.agentToken }
  }
  persistPrefs() { return save('prefs', this.modelConfiguration()) }
  openSettings(cx) {
    if (this.role === 'tabs' || this.page === 'settings') return
    if (!this.settingsInputs) {
      this.settingsInputs = {}
      for (const key of ['summaryModel', 'chatModel', 'endpoint', 'apiKey', 'agentEndpoint', 'agentToken']) {
        const state = InputState.new({ placeholder: key === 'agentEndpoint' ? 'http://127.0.0.1:3426' : key === 'agentToken' ? '由布局自动配置，也可手动填写' : key === 'endpoint' ? 'https://gateway/v1/messages' : key === 'apiKey' ? '可留空' : '模型名称或完整路由' })
        state.on('change', (_event, cx) => {
          if (this.settingsError) { this.settingsError = ''; cx.notify() }
          if ((key === 'endpoint' || key === 'apiKey') && this.page === 'settings') this.invalidateModels(cx)
        })
        this.settingsInputs[key] = state
      }
      this.settingsInputs.apiKey.set_masked(true)
      this.settingsInputs.agentToken.set_masked(true)
      this.modelSearchInput = InputState.new({ placeholder: '搜索模型名称或路由…' })
      this.modelSearchInput.on('change', (_event, cx) => { this.modelQuery = this.modelSearchInput.value(); cx.notify() })
    }
    for (const [key, state] of Object.entries(this.settingsInputs)) state.set_value(this[key])
    this.settingsEffort = this.chatEffort
    this.settingsPicker = null; this.settingsError = ''; this.menuOpen = false
    this.page = 'settings'; this.focus.focus(); cx.notify()
    this.loadModels(cx)
  }
  modelServiceDraft() {
    return { endpoint: this.settingsInputs.endpoint.value().trim(), apiKey: this.settingsInputs.apiKey.value().trim() }
  }
  modelsMatch(source) {
    const draft = this.modelServiceDraft()
    return source && source.endpoint === draft.endpoint && source.apiKey === draft.apiKey
  }
  invalidateModels(cx) {
    if (!this.modelsSource || this.modelsMatch(this.modelsSource)) return
    this.modelsEpoch++; this.modelsSource = null; this.modelChoices = []
    this.modelsStatus = 'idle'; this.modelsError = ''; cx.notify()
  }
  loadModels(cx, { force = false } = {}) {
    if (this.closed || this.page !== 'settings') return
    const source = this.modelServiceDraft()
    if (!force && this.modelsMatch(this.modelsSource) && ['loading', 'ready'].includes(this.modelsStatus)) return
    const epoch = ++this.modelsEpoch
    const current = () => !this.closed && this.page === 'settings' && epoch === this.modelsEpoch && this.modelsMatch(source)
    this.modelsSource = source; this.modelsStatus = 'loading'; this.modelsError = ''; this.modelChoices = []
    cx.notify()
    cx.timer.after(20000, cx => {
      if (!current() || this.modelsStatus !== 'loading') return
      this.modelsEpoch++; this.modelsStatus = 'error'
      this.modelsError = '获取模型列表超时。可刷新重试，或直接填写模型名称。'; cx.notify()
    })
    cx.spawn(async cx => {
      try {
        const models = await fetchModels({ ...source, isCurrent: current })
        if (!current()) return
        this.modelChoices = models; this.modelsStatus = 'ready'
      } catch (error) {
        if (!current()) return
        this.modelsStatus = 'error'; this.modelsError = error.message || '暂时无法获取模型列表。'
      } finally { if (current()) cx.notify() }
    })
  }
  toggleModelPicker(key, cx) {
    this.settingsPicker = this.settingsPicker === key ? null : key
    this.modelQuery = ''; this.modelSearchInput.set_value('')
    if (this.settingsPicker && this.modelsStatus === 'idle') this.loadModels(cx)
    cx.notify()
  }
  closeSettings(cx) {
    this.modelsEpoch++
    if (this.modelsStatus === 'loading') { this.modelsStatus = 'idle'; this.modelsSource = null }
    this.page = 'content'; this.settingsPicker = null; this.settingsError = ''
    this.typing = false; this.focus.focus(); cx.notify()
  }
  saveSettings(cx) {
    let config
    try {
      const values = Object.fromEntries(Object.entries(this.settingsInputs).map(([key, input]) => [key, input.value()]))
      config = validateModelSettings({ ...values, chatEffort: this.settingsEffort })
    } catch (error) { this.settingsError = error.message; cx.notify(); return false }
    if (!save('prefs', config)) { this.settingsError = '无法保存到 Herdr 本地配置，请稍后重试。'; cx.notify(); return false }
    Object.assign(this, config)
    this.settingsNotice = '模型设置已保存，下一次请求生效。'
    const version = ++this.settingsNoticeVersion
    this.closeSettings(cx)
    cx.timer.after(5000, cx => { if (!this.closed && version === this.settingsNoticeVersion) { this.settingsNotice = ''; cx.notify() } })
    return true
  }
  setSummary(text, source = 'instant', at = Date.now()) {
    this.summary = String(text || '').trim()
    this.brief = prepareBrief(parseSummary(this.summary))
    this.summarySource = source
    this.updatedAt = at
  }
  selectTab(tab, cx) {
    if (this.tab === tab) return
    this.tab = tab
    this.menuOpen = false
    cx.notify()
  }
  contextRequest() {
    return gatherProjectSnapshot({ spacesList: spaces(), panesList: panes(), focusedInfo: focused(),
      agentsList: agents(), terminalsList: terminals(), hcFn: hc })
  }
  refresh(cx, { forceAi = false, rebuild = false, silent = false } = {}) {
    if (this.closed || this.role === 'tabs') return
    this.syncProject()
    if (this.mode === 'demo') { this.setSummary(DEMO_PROJECTS[0].summary, 'demo'); cx.notify(); return }
    if (this.busy()) { if (forceAi) this.queuedAi = true; return }
    const generation = ++this.generation, key = this.projectKey
    const previousSummary = rebuild ? '' : this.summary
    const displayedSummary = this.summary, previousNote = this.note
    const modelConfig = { endpoint: this.endpoint, apiKey: this.apiKey, model: this.summaryModel }
    this.loadingContext = true; this.paused = false; this.isError = false
    if (!silent) this.note = ''
    if (!silent) cx.notify()
    // A deadline releases the UI and ignores a late answer. Native fetch is
    // not cancellable; pause automatic collection after a deadline expires.
    cx.timer.after(60000, cx => {
      if (this.closed || generation !== this.generation || !this.busy()) return
      this.generation++; this.loadingContext = false; this.summarizing = false; this.queuedAi = false; this.paused = true
      this.note = '更新耗时较长，已保留上一版重点。稍后可以手动重试。'; this.isError = true; cx.notify()
    })
    cx.spawn(async cx => {
      try {
        const snapshot = await this.contextRequest()
        if (this.closed || generation !== this.generation || key !== this.projectKey) return
        const changed = snapshot?.signature !== this.snapshot?.signature
        this.snapshot = snapshot
        if (!snapshot) { this.note = '先打开一个项目，再整理工作重点。'; return }
        if (!this.summary || (this.summarySource === 'instant' && changed)) this.setSummary(buildInstantSummary(snapshot), 'instant')
        if (forceAi) {
          this.summarizing = true; cx.notify()
          const reply = await completeModel({ ...modelConfig,
            system: summarySystemPrompt(), prompt: summaryUserPrompt({ previousSummary, contextText: snapshot.contextText }), maxTokens: 2000 })
          if (this.closed || generation !== this.generation || key !== this.projectKey) return
          const answer = splitReply(reply).answer.trim()
          if (!parseSummary(answer)) throw new Error('模型没有返回可用的速览')
          this.setSummary(answer.slice(0, 10000), 'ai')
          this.note = ''
        } else if (changed && this.summarySource === 'ai') this.note = '任务有新进展；更新后可重新提炼重点。'
        this.persistCurrentSpace()
      } catch (error) {
        if (generation !== this.generation || key !== this.projectKey || this.closed) return
        this.note = '暂时无法更新，已保留现有内容。' + String(error?.message || '').slice(0, 100)
        this.isError = true
      } finally {
        if (!this.closed && generation === this.generation && key === this.projectKey) {
          this.loadingContext = false; this.summarizing = false
          if (!silent || forceAi || this.summary !== displayedSummary || this.note !== previousNote) cx.notify()
          if (this.queuedAi) { this.queuedAi = false; this.refresh(cx, { forceAi: true }) }
        }
      }
    })
  }
  rebuild(cx) { this.refresh(cx, { forceAi: true, rebuild: true }) }
  switchMode(mode, cx) {
    if (this.mode === mode) return
    this.persistCurrentSpace()
    this.mode = mode; this.syncProject(); this.refresh(cx); cx.notify()
  }
  submitChat(cx, question = null) {
    if (this.chatRunning || this.agentJob || this.agentResumePending || this.chatResetting) return
    const text = String(question ?? this.draft).trim()
    if (!text || text.length > MAX_QUESTION) {
      this.chatStatus = text ? `问题请控制在 ${MAX_QUESTION} 字符以内。` : '先写下你的问题。'
      this.chatError = true; cx.notify(); return
    }
    this.turns = [...this.turns, { id: `${Date.now().toString(36)}-${this.clientInstance}-${this.chatEpoch}`, question: text, answer: null }].slice(-MAX_TURNS)
    this.draft = ''; this.input.set_value(''); this.confirmClear = false; this.historyOpen = false
    this.persistCurrentSpace(); this.runChatTurn(cx)
  }
  agentConnection() { return { agentEndpoint: this.agentEndpoint, agentToken: this.agentToken } }
  workspaceSnapshot() { return agentWorkspaces(spaces(), panes(), agents(), terminals()) }
  agentReply(turn, data) {
    if (data.text) Object.assign(turn, replyFields(data.text, 16000))
    if (data.thinking) { turn.thinking = data.thinking.slice(0, 4000); turn.thinkingKind = 'tagged' }
    turn.agent = true; turn.incomplete = data.status !== 'complete'
    turn.tools = (data.tools || []).slice(-12)
    if (data.sessionId) turn.sessionId = data.sessionId
  }
  runChatTurn(cx, { resume = false, connection: override = null } = {}) {
    const turn = this.turns.at(-1)
    if (this.chatRunning || !turn || (turn.answer !== null && !turn.incomplete)) return
    if (this.mode === 'demo') {
      Object.assign(turn, replyFields(DEMO_PROJECTS[0].turns[0].answer, MAX_ANSWER))
      this.chatError = false; this.chatStatus = ''; this.persistCurrentSpace(); cx.notify(); return
    }
    let connection
    try {
      connection = validateAgentConnection(override || this.agentConnection())
      if (!connection.agentToken) throw new Error('请先运行 npm run agent，再安装新版布局以自动配置 Agent 连接令牌。')
    } catch (error) { this.chatError = true; this.chatStatus = error.message; turn.incomplete = true; this.persistCurrentSpace(); cx.notify(); return }
    const retry = !resume && Boolean(turn.incomplete || this.chatError)
    const epoch = ++this.chatEpoch, key = this.projectKey
    turn.id ||= `${Date.now().toString(36)}-${this.clientInstance}-${epoch}`
    this.chatRunning = true; this.chatError = false; this.chatStatus = '正在连接 Pi Agent…'
    if (this.agentJob?.turnId === turn.id) { this.pollAgent(cx); cx.notify(); return }
    const starting = { turnId: turn.id, connection, cancelled: false }
    this.agentStarting = starting; turn.agent = true; turn.incomplete = true
    const current = () => !this.closed && epoch === this.chatEpoch && key === this.projectKey
    const body = { workspaceId: String(this.project?.id || ''), workspaces: this.workspaceSnapshot(), question: turn.question,
      brief: this.summary, clientTurnId: turn.id, retry,
      config: { endpoint: this.endpoint, apiKey: this.apiKey, model: this.chatModel, effort: this.chatEffort } }
    this.persistCurrentSpace(); cx.notify()
    cx.timer.after(20000, cx => {
      if (!current() || this.agentStarting !== starting) return
      starting.cancelled = true; this.agentStarting = null; this.chatEpoch++; this.chatRunning = false
      this.chatError = true; this.chatStatus = 'Agent 连接等待过久，请检查服务后手动重试。'; this.persistCurrentSpace(); cx.notify()
    })
    cx.spawn(async cx => {
      try {
        const data = await startAgentTurn(connection, body)
        if (!current()) {
          if (starting.cancelled) { if (data.status === 'running') await stopAgentTurn(connection, data.id).catch(() => {}) }
          else this.retainDetachedJob(key, turn.id, connection, data, cx)
          return
        }
        this.agentStarting = null
        this.agentJob = { id: data.id, turnId: turn.id, connection, key }
        this.acceptAgentSnapshot(data, cx)
        this.persistCurrentSpace(); this.pollAgent(cx)
      } catch (error) {
        if (!current()) return
        this.agentStarting = null; this.chatRunning = false; this.chatError = true
        this.chatStatus = String(error.message || error).slice(0, 300)
        if ([400, 401, 403].includes(error.status)) turn.agent = false
        this.persistCurrentSpace(); cx.notify()
      }
    })
  }
  retainDetachedJob(key, turnId, connection, data, cx) {
    const cache = load(key)
    const turn = cache?.turns?.find(turn => turn.id === turnId)
    if (!turn) return
    this.agentReply(turn, data)
    cache.agentPending = null
    cache.agentJob = data.status === 'running' ? { id: data.id, turnId, connection } : null
    save(key, cache)
    if (!this.closed && key === this.projectKey && this.turns.at(-1)?.id === turnId && !this.agentStarting && !this.agentJob) {
      this.agentResumePending = null; this.agentJob = { id: data.id, turnId, connection, key }
      this.acceptAgentSnapshot(data, cx); this.persistCurrentSpace()
    }
  }
  acceptAgentSnapshot(data, cx) {
    const job = this.agentJob
    if (!job || job.id !== data.id || job.key !== this.projectKey) return
    const turn = this.turns.find(turn => turn.id === job.turnId)
    if (!turn) return
    const signature = JSON.stringify([data.status, data.text, data.thinking, data.tools, data.statusMessage, data.error])
    if (job.signature === signature) return
    job.signature = signature
    this.agentReply(turn, data)
    this.chatStatus = data.error || data.statusMessage || ''
    this.chatError = data.status === 'error'
    this.chatRunning = data.status === 'running'
    if (!this.chatRunning) { this.agentJob = null; this.chatStopping = false }
    if (!this.chatRunning || Date.now() - (job.savedAt || 0) >= 1000) { job.savedAt = Date.now(); this.persistCurrentSpace() }
    cx.notify()
  }
  pollAgent(cx) {
    const job = this.agentJob
    if (this.closed || !job || !this.chatRunning || this.agentPollingId?.id === job.id) return
    const epoch = this.chatEpoch, key = this.projectKey, polling = { id: job.id }
    this.agentPollingId = polling
    cx.timer.after(15000, cx => {
      if (this.closed || this.agentPollingId !== polling || epoch !== this.chatEpoch || key !== this.projectKey || this.agentJob !== job) return
      this.agentPollingId = null; this.chatRunning = false; this.chatError = true
      this.chatStatus = 'Agent 服务响应较慢，可以重连以查看结果，或发送停止请求。'; this.persistCurrentSpace(); cx.notify()
    })
    cx.spawn(async cx => {
      try {
        const data = await readAgentJob(job.connection, job.id)
        if (!this.closed && epoch === this.chatEpoch && key === this.projectKey && this.agentJob === job) this.acceptAgentSnapshot(data, cx)
      } catch (error) {
        if (this.closed || epoch !== this.chatEpoch || key !== this.projectKey || this.agentJob !== job) return
        this.chatRunning = false; this.chatError = true; this.chatStatus = String(error.message || error).slice(0, 300)
        if ([401, 404].includes(error.status)) this.agentJob = null
        this.persistCurrentSpace(); cx.notify()
      } finally { if (this.agentPollingId === polling) this.agentPollingId = null }
    })
  }
  stopChat(cx) {
    if (this.chatStopping) return
    if (this.agentStarting) {
      this.agentStarting.cancelled = true; this.agentStarting = null; this.chatEpoch++; this.chatRunning = false
      this.chatStatus = '已停止等待；迟到的 Agent 请求会发送停止指令。'; this.persistCurrentSpace(); cx.notify(); return
    }
    const job = this.agentJob
    if (!job) return
    this.chatStopping = true; this.chatStatus = '正在停止 Agent…'; cx.notify()
    cx.spawn(async cx => {
      try {
        const data = await stopAgentTurn(job.connection, job.id)
        if (!this.closed && this.agentJob === job) this.acceptAgentSnapshot(data, cx)
      } catch (error) {
        if (this.closed || this.agentJob !== job) return
        this.chatRunning = false; this.chatError = true; this.chatStatus = '停止请求未确认：' + String(error.message || error).slice(0, 220)
      } finally { this.chatStopping = false; this.persistCurrentSpace(); if (!this.closed) cx.notify() }
    })
  }
  editLastQuestion(cx) {
    const turn = this.turns.at(-1)
    if (this.chatRunning || this.agentJob || !turn || (turn.answer !== null && !turn.incomplete)) return
    this.draft = this.turns.pop().question; this.input.set_value(this.draft)
    this.chatStatus = ''; this.chatError = false; this.persistCurrentSpace(); this.input.focus(); cx.notify()
  }
  clearChat(cx) {
    if (!this.confirmClear) { this.confirmClear = true; cx.notify(); return }
    if (this.chatResetting) return
    const finish = cx => {
      if (this.agentStarting) this.agentStarting.cancelled = true
      this.chatEpoch++; this.chatRunning = false; this.agentJob = null; this.agentStarting = null; this.agentResumePending = null
      this.turns = []; this.chatStatus = ''; this.chatError = false; this.confirmClear = false; this.chatResetting = false
      this.historyOpen = false; this.expandedThinking.clear(); this.expandedTools.clear(); this.persistCurrentSpace(); cx.notify()
    }
    if (this.mode === 'demo' || !this.turns.some(turn => turn.agent)) { finish(cx); return }
    const key = this.projectKey
    this.chatResetting = true; cx.notify()
    cx.spawn(async cx => {
      try {
        await resetAgentSession(this.agentConnection(), { workspaceId: String(this.project?.id || ''), workspaces: this.workspaceSnapshot() })
        if (!this.closed && key === this.projectKey) finish(cx)
      } catch (error) {
        if (this.closed || key !== this.projectKey) return
        this.chatResetting = false; this.chatError = true; this.chatStatus = '未能清空 Agent 会话：' + String(error.message || error).slice(0, 220); cx.notify()
      }
    })
  }
  copyLastAnswer(cx) {
    const text = [...this.turns].reverse().find(turn => turn.answer)?.answer
    if (text) { cx.write_to_clipboard(text); this.chatStatus = '已复制回答。'; this.chatError = false; cx.notify() }
  }
  handleKey(event, cx) {
    if (this.page === 'settings') {
      if (event.key === 'escape') { this.closeSettings(cx); cx.stop_propagation() }
      return
    }
    // Textarea focus notifications may arrive after the first key. Never let
    // unmodified chat typing bubble into global r/b/d/1/2 sidebar shortcuts.
    if (this.tab === 'chat') {
      if (event.key === 'escape') { this.focus.focus(); this.typing = false; cx.stop_propagation(); cx.notify() }
      else if (event.key === 'enter' && (event.modifiers?.control || event.modifiers?.platform)) {
        this.submitChat(cx); cx.stop_propagation()
      }
      return
    }
    const key = event.key?.toLowerCase()
    if (key === '1') this.selectTab('summary', cx)
    else if (key === '2' || key === '3' || key === 'c') { this.selectTab('chat', cx); this.input.focus() }
    else if (key === 'r') this.refresh(cx, { forceAi: true })
    else if (key === 'b') this.rebuild(cx)
    else if (key === 'd') this.switchMode(this.mode === 'demo' ? 'live' : 'demo', cx)
    else return
    cx.stop_propagation()
  }
  renderSummaryContent(t) { return summaryView(this, t) }
  renderChatContent(t) { return chatView(this, t) }
  render(cx) {
    const t = theme()
    if (this.role === 'tabs') return renderWorkspaceTabs(this, t)
    if (this.page === 'settings') return modelSettingsView(this, t)
    const header = h_flex().h(45).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg('mods/sulan/sulan.svg').size(15).text_color(t.accent))
      .child(div().text_size(13).font_semibold().child(this.project?.name || '项目速览'))
      .child(div().flex_1())
      .when(this.mode === 'demo', el => el.child(div().text_size(11).text_color(t.working).child('演示')))
      .child(action('sulan-update', this.busy() ? '整理中…' : '更新', t, cx => this.refresh(cx, { forceAi: true }), { disabled: this.busy() }))
      .child(action('sulan-settings', '设置', t, cx => this.openSettings(cx)))
      .child(action('sulan-menu', '更多', t, cx => { this.menuOpen = !this.menuOpen; cx.notify() }, { active: this.menuOpen }))
    const navigation = h_flex().h(40).flex_none().px(14).gap(4).items_center()
      .child(action('sulan-tab-summary', '速览', t, cx => this.selectTab('summary', cx), { active: this.tab === 'summary' }))
      .child(action('sulan-tab-chat', '侧聊', t, cx => this.selectTab('chat', cx), { active: this.tab === 'chat' }))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.muted).child(this.summarySource === 'instant' ? '任务线索' : clock(this.updatedAt)))
    const root = v_flex().id('sulan-root').size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).font_normal().text_size(13)
      .track_focus(this.focus).on_key_down((event, cx) => this.handleKey(event, cx))
      .child(header).child(navigation)
    if (this.settingsNotice) root.child(div().flex_none().px(18).py(6).text_size(12).text_color(t.done).child(this.settingsNotice))
    if (this.menuOpen) root.child(h_flex().px(14).pb(8).gap(6).flex_none()
      .child(action('sulan-rebuild', '重新整理', t, cx => { this.menuOpen = false; this.rebuild(cx) }, { disabled: this.busy() }))
      .child(action('sulan-demo', this.mode === 'demo' ? '查看实时项目' : '预览示例', t, cx => {
        this.menuOpen = false; this.switchMode(this.mode === 'demo' ? 'live' : 'demo', cx)
      })))
    // Critical path: only one document is constructed for this frame. The
    // inactive tab does no Markdown parsing, diagram layout or native work.
    return root.child(this.tab === 'chat' ? this.renderChatContent(t) : this.renderSummaryContent(t))
  }
}

// Sulan is a focused native sidebar. Workspace tab-bar adaptation lives in
// workspace.js (Herdr App, Apache-2.0; see vendor/LICENSE.herdr-app).
import { View, div, svg } from 'gpui-kit'
import { h_flex, v_flex, TextareaState } from 'gpui-base'
import { spaces, panes, focused, agents, terminals, hc, theme, layout, props, nextCommand } from 'herdr'
import { parseSummary } from './summary.js'
import { prepareBrief } from './brief.js'
import { activeProject, gatherProjectSnapshot, buildInstantSummary } from './context.js'
import { MAX_QUESTION, MAX_ANSWER, MAX_TURNS, cleanTurns, replyFields, splitReply,
  summarySystemPrompt, summaryUserPrompt, sideChatPrompt } from './chat.js'
import { completeModel, DEFAULT_ENDPOINT, DEFAULT_MODEL } from './llm.js'
import { DEMO_PROJECTS } from './demo.js'
import { action, summaryView, chatView } from './view.js'
import { findNode, renderWorkspaceTabs } from './workspace.js'

const PREFIX = 'herdr.sulan.v1:'
function load(key) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key) || 'null') } catch { return null }
}
function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)) } catch {}
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
    this.endpoint = p.endpoint || DEFAULT_ENDPOINT
    this.apiKey = typeof p.apiKey === 'string' ? p.apiKey : 'magpie'
    this.summaryModel = p.summaryModel || DEFAULT_MODEL
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
    this.settingsOpen = false
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
    this.turns = []
    this.draft = ''
    this.typing = false
    this.confirmClear = false
    this.expandedThinking = new Set()
    this.spacePanels = load('space.panels') || {}
    this.pressedTab = null
    const preferences = load('prefs') || {}
    this.chatModel = preferences.chatModel || DEFAULT_MODEL
    this.chatEffort = preferences.chatEffort || 'medium'
    this.focus = cx.focus_handle()
    if (this.role !== 'tabs') {
      this.input = TextareaState.new({ placeholder: '问一个关于当前项目的问题…', rows: 2 })
      this.input.on('change', (_e, cx) => {
        const wasEmpty = !this.draft.trim()
        this.draft = this.input.value()
        // Native text editing owns its own redraw. Only invalidate the outer
        // sidebar when the Send button changes between enabled and disabled.
        if (wasEmpty !== !this.draft.trim()) cx.notify()
      })
      this.input.on('submit', (event, cx) => { if (event?.secondary) this.submitChat(cx) })
      this.input.on('focus', (_e, cx) => { this.typing = true; cx.notify() })
      this.input.on('blur', (_e, cx) => { this.typing = false; cx.notify() })
      this.syncProject()
      this.refresh(cx)
      cx.timer.every(250, cx => {
        if (!this.closed && this.currentSpaceKey() !== this.projectKey) {
          this.syncProject(); this.refresh(cx); cx.notify()
        }
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
        cx.notify()
      }
    })
  }

  busy() { return this.loadingContext || this.summarizing }
  close() { this.closed = true; this.generation++; this.chatEpoch++ }
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
    this.detailsOpen = false; this.historyOpen = false; this.confirmClear = false
    this.expandedThinking.clear()
    const demo = this.mode === 'demo' ? DEMO_PROJECTS[0] : null
    this.project = demo?.project || activeProject(spaces(), panes(), focused())
    const cached = demo || load(key) || {}
    this.snapshot = demo ? { project: demo.project, agents: demo.agents, contextText: demo.summary, capturedAt: Date.now() } : null
    this.setSummary(cached.summary || '', demo ? 'demo' : cached.summarySource || '', cached.updatedAt || 0)
    this.turns = cleanTurns(cached.turns)
    this.draft = typeof cached.draft === 'string' ? cached.draft : ''
    this.input?.set_value(this.draft)
    this.note = ''; this.isError = false
  }
  persistCurrentSpace() {
    if (!this.projectKey || this.projectKey.startsWith('demo:')) return
    save(this.projectKey, { summary: this.summary, summarySource: this.summarySource, updatedAt: this.updatedAt,
      turns: this.turns, draft: this.draft })
  }
  savePanelPrefs() { save('space.panels', this.spacePanels) }
  persistPrefs() { save('prefs', { chatModel: this.chatModel, chatEffort: this.chatEffort }) }
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
          const reply = await completeModel({ endpoint: this.endpoint, apiKey: this.apiKey, model: this.summaryModel,
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
    if (this.chatRunning) return
    const text = String(question ?? this.draft).trim()
    if (!text || text.length > MAX_QUESTION) {
      this.chatStatus = text ? `问题请控制在 ${MAX_QUESTION} 字符以内。` : '先写下你的问题。'
      this.chatError = true; cx.notify(); return
    }
    this.turns = [...this.turns, { question: text, answer: null }].slice(-MAX_TURNS)
    this.draft = ''; this.input.set_value(''); this.confirmClear = false; this.historyOpen = false
    this.persistCurrentSpace(); this.runChatTurn(cx)
  }
  runChatTurn(cx) {
    const turn = this.turns.at(-1)
    if (this.chatRunning || !turn || turn.answer !== null) return
    const epoch = ++this.chatEpoch, key = this.projectKey
    this.chatRunning = true; this.chatError = false; this.chatStatus = ''
    const current = () => !this.closed && epoch === this.chatEpoch && key === this.projectKey
    cx.timer.after(60000, cx => {
      if (!current() || !this.chatRunning) return
      this.chatEpoch++; this.chatRunning = false; this.chatError = true
      this.chatStatus = '回复等待过久，可以重试或换一个模型。'; this.persistCurrentSpace(); cx.notify()
    })
    cx.notify()
    cx.spawn(async cx => {
      try {
        let reply
        if (this.mode === 'demo') reply = DEMO_PROJECTS[0].turns[0].answer
        else {
          const snapshot = this.snapshot && Date.now() - this.snapshot.capturedAt < 30000 ? this.snapshot : await this.contextRequest()
          if (!current()) return
          reply = await completeModel({ endpoint: this.endpoint, apiKey: this.apiKey, model: this.chatModel, effort: this.chatEffort,
            system: '你是项目侧聊助手。先用一句话回答，再用简短 Markdown 解释；普通正文不要全加粗。不执行工具。资料不足时直说，不编造进展或需要用户决定的问题。',
            prompt: sideChatPrompt(this.turns, this.summary, snapshot?.contextText || ''), maxTokens: 2500 })
        }
        if (!current()) return
        const fields = replyFields(reply, MAX_ANSWER)
        Object.assign(turn, fields)
        if (!fields.answer) throw new Error('模型未返回最终回答，可以重试或切换模型。')
      } catch (error) {
        if (!current()) return
        this.chatStatus = '暂时未能回答：' + String(error?.message || error).slice(0, 140)
        this.chatError = true
      } finally {
        if (current()) { this.chatRunning = false; this.persistCurrentSpace(); cx.notify() }
      }
    })
  }
  editLastQuestion(cx) {
    if (this.chatRunning || this.turns.at(-1)?.answer !== null) return
    this.draft = this.turns.pop().question; this.input.set_value(this.draft)
    this.chatStatus = ''; this.chatError = false; this.persistCurrentSpace(); this.input.focus(); cx.notify()
  }
  clearChat(cx) {
    if (!this.confirmClear) { this.confirmClear = true; cx.notify(); return }
    this.chatEpoch++; this.chatRunning = false; this.turns = []; this.chatStatus = ''; this.chatError = false
    this.confirmClear = false; this.historyOpen = false; this.expandedThinking.clear(); this.persistCurrentSpace(); cx.notify()
  }
  copyLastAnswer(cx) {
    const text = [...this.turns].reverse().find(turn => turn.answer)?.answer
    if (text) { cx.write_to_clipboard(text); this.chatStatus = '已复制回答。'; this.chatError = false; cx.notify() }
  }
  handleKey(event, cx) {
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
    const header = h_flex().h(45).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg('mods/sulan/sulan.svg').size(15).text_color(t.accent))
      .child(div().text_size(13).font_semibold().child(this.project?.name || '项目速览'))
      .child(div().flex_1())
      .when(this.mode === 'demo', el => el.child(div().text_size(11).text_color(t.working).child('演示')))
      .child(action('sulan-update', this.busy() ? '整理中…' : '更新', t, cx => this.refresh(cx, { forceAi: true }), { disabled: this.busy() }))
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

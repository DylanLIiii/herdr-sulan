// Modified from Herdr App's Apache-2.0 defaults/mods/tabs/main.js for Sulan panel toggling.
// See vendor/LICENSE.herdr-app and the repository's THIRD-PARTY-NOTICES.md.
// Sulan 速览 for Herdr: a right-hand sidebar panel (like Files and Changes)
// and split-pane mod that catches you up on the active project Space in seconds.
// Also supports a tab-bar role (role: "tabs") that adds the "速览" toggle button
// right beside "Files" and "Changes" in the workspace tab bar, and an optional
// wide layout role.

import { View, div, svg, image } from 'gpui-kit'
import { v_flex, h_flex, InputState, Input } from 'gpui-base'
import {
  spaces,
  panes,
  focused,
  agents,
  terminals,
  exec,
  hc,
  run,
  openOverlay,
  theme,
  window as win,
  settings,
  layout,
  props,
  shared,
  setShared,
  nextCommand,
  watchFolder,
} from 'herdr'

import { parseSummary, inlineSpans, progressOf } from './summary.js'
import { flowNodes, flowLayers, renderFlow } from './diagram.js'
import { truncate } from './text.js'
import {
  MAX_QUESTION,
  MAX_ANSWER,
  MAX_TURNS,
  DEFAULT_MODELS,
  EFFORT_CHOICES,
  SUGGESTIONS,
  cleanTurns,
  replyFields,
  turnReply,
  durationText,
  summarySystemPrompt,
  summaryUserPrompt,
  sideChatPrompt,
} from './chat.js'
import {
  activeProject,
  gatherProjectSnapshot,
  buildInstantSummary,
} from './context.js'
import { completeModel, DEFAULT_ENDPOINT, DEFAULT_MODEL } from './llm.js'
import { DEMO_PROJECTS } from './demo.js'

const STORAGE_PREFIX = 'herdr.sulan.v1:'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const ICONS = {
  tldr: '◆',
  why: '◎',
  did: '✎',
  out: '✦',
  now: '◉',
  next: '➜',
  terms: '◈',
  flow: '❖',
  done: '✓',
  wip: '◐',
  fail: '✗',
  ask: '?',
  todo: '○',
}

const TITLES = {
  why: '目标',
  did: '做了什么',
  out: '结论',
  now: '现状',
  next: '需要你',
  terms: '名词与概念',
  flow: '进度',
}

const NODE_GLYPH = { done: '✓', wip: '◐', fail: '✗', todo: '○' }
const EMPTY_ITEM = /^(无|无待办|暂无|none|n\/a)[。.]?$/i

function findNode(node, id) {
  if (node?.id === id) return node
  for (const child of node?.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function clockText(at) {
  if (!at) return '暂无摘要'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '暂无摘要'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 更新`
}

function loadSaved(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveState(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {}
}

export default class Sulan extends View {
  init(initialProps, cx) {
    const p = initialProps ?? props() ?? {}
    // Default role is "sidebar" — a right-hand sidebar card just like Files and Changes
    this.role = p.role || 'sidebar'
    this.stack = p.stack || 'sulan-pages'
    this.pageId = p.page || 'sulan-page'
    this.endpoint = typeof p.endpoint === 'string' && p.endpoint.trim() ? p.endpoint.trim() : DEFAULT_ENDPOINT
    this.apiKey = typeof p.apiKey === 'string' && p.apiKey.trim() ? p.apiKey.trim() : 'magpie'
    this.summaryModel = typeof p.summaryModel === 'string' && p.summaryModel.trim() ? p.summaryModel.trim() : DEFAULT_MODEL

    // Tab-bar role state (when used as the workspace top tab bar with Files / Changes / 速览 buttons)
    this.pressedTab = null
    this.spacePanels = loadSaved('space.panels') ?? {}

    this.width = this.role === 'page' ? 1040 : 380
    this.closed = false
    this.mode = p.mode === 'demo' ? 'demo' : 'live'
    this.tab = 'summary' // 'summary' (速览) | 'pulse' (动态) | 'chat' (侧聊)

    // Active project state
    this.projectKey = ''
    this.snapshot = null
    this.summary = ''
    this.parsed = null
    this.summarySource = '' // 'ai' | 'instant' | 'demo'
    this.lastSignature = ''
    this.updatedAt = 0
    this.loadingContext = false
    this.summarizing = false
    this.queuedRefresh = false
    this.statusText = ''
    this.isError = false
    this.generation = 0
    this.watchedRoot = null

    // Side chat state
    this.turns = []
    this.draft = ''
    this.chatRunning = false
    this.chatPhase = 'idle'
    this.chatStatus = ''
    this.chatError = false
    this.chatDurationMs = null
    this.chatEpoch = 0
    this.confirmClear = false
    this.choosingModel = false
    this.choosingEffort = false
    this.expandedThinking = new Set()

    const savedPrefs = loadSaved('prefs') ?? {}
    this.chatModel = savedPrefs.chatModel || DEFAULT_MODEL
    this.chatEffort = savedPrefs.chatEffort || 'medium'
    this.autoAiSummary = savedPrefs.autoAiSummary !== false

    this.focus = cx.focus_handle()
    this.input = InputState.new({ placeholder: '结合当前项目速览与终端状态提问… (Enter 发送)' })
    this.input.on('change', (_e, cx) => {
      this.draft = this.input.value()
      cx.notify()
    })
    this.input.on('submit', (_e, cx) => this.submitChat(cx))
    this.input.on('focus', (_e, cx) => {
      this.typing = true
      cx.notify()
    })
    this.input.on('blur', (_e, cx) => {
      this.typing = false
      cx.notify()
    })

    cx.spawn(async (cx) => {
      for (;;) {
        const cmd = await nextCommand()
        if (this.closed) return
        if (cmd === 'focus') {
          this.focus.focus()
        } else if (cmd === 'refresh') {
          this.refresh(cx, { forceAi: true })
        } else if (cmd === 'rebuild') {
          this.rebuild(cx)
        } else if (cmd === 'demo') {
          this.switchMode(this.mode === 'live' ? 'demo' : 'live', cx)
        } else if (cmd === 'chat') {
          this.tab = 'chat'
          this.input.focus()
        }
        cx.notify()
      }
    })

    if (this.role !== 'nav' && this.role !== 'tabs') {
      cx.timer.every(6000, (cx) => {
        if (!this.closed && this.visible() && !this.loadingContext && !this.summarizing) {
          this.refresh(cx, { onlyIfChanged: true })
        }
      })
      this.refresh(cx, { forceAi: false })
    }
  }

  close() {
    this.closed = true
    this.generation++
    this.chatEpoch++
  }

  visible() {
    if (this.role === 'nav' || this.role === 'tabs') return true
    const root = layout()
    if (!root) return true
    // Check if docked inside the right-hand `panel` / `panel-body` stack
    const panel = findNode(root, 'panel')
    const panelBody = findNode(root, 'panel-body')
    if (panel && panelBody && findNode(panelBody, 'sulan')) {
      if (panel.hidden || panelBody.active !== 'sulan') return false
    }
    const stackNode = findNode(root, this.stack)
    if (stackNode && stackNode.active && stackNode.active !== this.pageId && findNode(stackNode, this.pageId)) {
      return false
    }
    return true
  }

  currentSpaceKey() {
    if (this.mode === 'demo') return 'demo:herdr-sulan'
    const proj = activeProject(spaces(), panes(), focused())
    if (!proj) return 'live:none'
    return `live:${proj.id}:${proj.folder || proj.name}`
  }

  syncSpaceStorage() {
    const key = this.currentSpaceKey()
    if (key === this.projectKey) return false
    this.projectKey = key
    this.chatEpoch++
    this.chatRunning = false
    this.chatPhase = 'idle'
    this.chatStatus = ''
    this.chatError = false
    this.confirmClear = false
    this.expandedThinking.clear()

    if (this.mode === 'demo') {
      const demo = DEMO_PROJECTS[0]
      this.snapshot = {
        project: demo.project,
        git: demo.git,
        agents: demo.agents,
        excerpts: [],
        contextText: '',
        signature: 'demo-sig',
        capturedAt: Date.now(),
      }
      this.setSummary(demo.summary, 'demo', Date.now())
      this.turns = cleanTurns(demo.turns)
      this.statusText = ''
      this.isError = false
      return true
    }

    const saved = loadSaved(key)
    this.snapshot = null
    this.lastSignature = saved?.signature || ''
    this.setSummary(saved?.summary || '', saved?.summarySource || '', saved?.updatedAt || 0)
    this.turns = cleanTurns(saved?.turns)
    this.statusText = ''
    this.isError = false
    return true
  }

  persistCurrentSpace() {
    if (!this.projectKey || this.mode === 'demo') return
    saveState(this.projectKey, {
      summary: this.summary,
      summarySource: this.summarySource,
      signature: this.lastSignature,
      updatedAt: this.updatedAt,
      turns: this.turns,
    })
  }

  persistPrefs() {
    saveState('prefs', {
      chatModel: this.chatModel,
      chatEffort: this.chatEffort,
      autoAiSummary: this.autoAiSummary,
    })
  }

  setSummary(text, source = 'instant', when = Date.now()) {
    this.summary = String(text ?? '').trim()
    this.parsed = parseSummary(this.summary)
    this.summarySource = source
    this.updatedAt = when
    if (this.parsed?.tldr) {
      try {
        setShared('sulan.tldr', {
          space: this.snapshot?.project?.name || '',
          tldr: this.parsed.tldr,
          updatedAt: this.updatedAt,
        })
      } catch {}
    }
  }

  watchRepo(root, cx) {
    if (!root || this.mode === 'demo' || this.watchedRoot === root || this.snapshot?.project?.machine) return
    this.watchedRoot = root
    cx.spawn(async (cx) => {
      try {
        while (!this.closed && this.watchedRoot === root) {
          await watchFolder(root)
          if (!this.closed && this.watchedRoot === root && this.visible()) {
            this.refresh(cx, { onlyIfChanged: true })
          }
        }
      } catch {
        if (this.watchedRoot === root) this.watchedRoot = null
      }
    })
  }

  refresh(cx, { onlyIfChanged = false, forceAi = false } = {}) {
    if (this.closed || this.role === 'nav' || this.role === 'tabs') return
    this.syncSpaceStorage()

    if (this.mode === 'demo') {
      const demo = DEMO_PROJECTS[0]
      this.snapshot = {
        project: demo.project,
        git: demo.git,
        agents: demo.agents,
        excerpts: [],
        contextText: '',
        signature: 'demo-sig',
        capturedAt: Date.now(),
      }
      this.setSummary(demo.summary, 'demo', Date.now())
      this.statusText = '演示已就绪'
      this.isError = false
      cx.notify()
      return
    }

    if (this.loadingContext || this.summarizing) {
      this.queuedRefresh = true
      return
    }

    const gen = ++this.generation
    const keyAtStart = this.projectKey
    this.loadingContext = true
    if (!onlyIfChanged) {
      this.statusText = '采集中…'
      this.isError = false
      cx.notify()
    }

    cx.spawn(async (cx) => {
      try {
        const snap = await gatherProjectSnapshot({
          spacesList: spaces(),
          panesList: panes(),
          focusedInfo: focused(),
          agentsList: agents(),
          terminalsList: terminals(),
          execFn: exec,
          hcFn: hc,
        })
        if (this.closed || gen !== this.generation || this.projectKey !== keyAtStart) return
        this.snapshot = snap
        if (snap?.git?.root) this.watchRepo(snap.git.root, cx)

        if (!snap) {
          this.statusText = '无活动空间'
          return
        }

        const changed = snap.signature !== this.lastSignature
        if (!this.summary || (changed && this.summarySource !== 'ai')) {
          const instant = buildInstantSummary(snap)
          this.setSummary(instant, 'instant', Date.now())
          this.lastSignature = snap.signature
          this.persistCurrentSpace()
          cx.notify()
        }

        const shouldRunAi = forceAi
        if (shouldRunAi) {
          this.summarizing = true
          this.statusText = '更新中…'
          this.isError = false
          cx.notify()
          try {
            const reply = await completeModel({
              endpoint: this.endpoint,
              apiKey: this.apiKey,
              model: this.summaryModel,
              system: summarySystemPrompt(),
              prompt: summaryUserPrompt({
                previousSummary: this.summarySource === 'ai' ? this.summary : '',
                contextText: snap.contextText,
              }),
              maxTokens: 2500,
            })
            if (this.closed || gen !== this.generation || this.projectKey !== keyAtStart) return
            const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
            if (parseSummary(cleaned)) {
              this.setSummary(cleaned.slice(0, 10_000), 'ai', Date.now())
              this.lastSignature = snap.signature
              this.statusText = ''
              this.isError = false
              this.persistCurrentSpace()
            } else {
              const instant = buildInstantSummary(snap)
              this.setSummary(instant, 'instant', Date.now())
              this.lastSignature = snap.signature
              this.statusText = ''
              this.persistCurrentSpace()
            }
          } catch {
            if (this.closed || gen !== this.generation || this.projectKey !== keyAtStart) return
            if (!this.summary || changed) {
              this.setSummary(buildInstantSummary(snap), 'instant', Date.now())
            }
            this.lastSignature = snap.signature
            this.statusText = ''
            this.isError = false
            this.persistCurrentSpace()
          } finally {
            if (gen === this.generation) this.summarizing = false
          }
        } else {
          this.statusText = ''
        }
      } catch (err) {
        if (!this.closed && gen === this.generation) {
          this.statusText = '更新失败：' + truncate(err?.message || String(err), 36)
          this.isError = true
        }
      } finally {
        if (!this.closed && gen === this.generation) {
          this.loadingContext = false
          this.summarizing = false
          cx.notify()
          if (this.queuedRefresh) {
            this.queuedRefresh = false
            this.refresh(cx, { onlyIfChanged: true })
          }
        }
      }
    })
  }

  rebuild(cx) {
    if (this.loadingContext || this.summarizing) return
    this.summary = ''
    this.parsed = null
    this.summarySource = ''
    this.lastSignature = ''
    this.refresh(cx, { onlyIfChanged: false, forceAi: true })
  }

  switchMode(nextMode, cx) {
    if (this.mode === nextMode) return
    this.mode = nextMode
    this.projectKey = ''
    this.syncSpaceStorage()
    if (nextMode === 'live') this.refresh(cx, { forceAi: false })
    cx.notify()
  }

  // Side chat actions
  submitChat(cx, presetQuestion = null) {
    if (this.chatRunning) return
    const question = String(presetQuestion ?? this.draft ?? '').trim()
    if (!question || question.length > MAX_QUESTION) {
      this.chatStatus = question ? `问题请控制在 ${MAX_QUESTION} 字符以内。` : '先输入一个问题。'
      this.chatError = true
      cx.notify()
      return
    }
    this.turns = [...this.turns, { question, answer: null }].slice(-MAX_TURNS)
    this.expandedThinking.clear()
    if (!presetQuestion) {
      this.draft = ''
      this.input.set_value('')
    }
    this.confirmClear = false
    this.runChatTurn(cx)
  }

  runChatTurn(cx) {
    const last = this.turns.at(-1)
    if (this.chatRunning || !last || last.answer !== null) return
    const epoch = ++this.chatEpoch
    const spaceKey = this.projectKey
    this.chatRunning = true
    this.choosingModel = false
    this.choosingEffort = false
    this.chatStatus = ''
    this.chatError = false
    this.chatPhase = 'preparing'
    this.chatDurationMs = null
    const startedAt = Date.now()
    cx.notify()

    cx.spawn(async (cx) => {
      try {
        if (this.mode === 'demo') {
          this.chatPhase = 'waiting'
          cx.notify()
          const q = last.question
          const demoAnswer =
            `<think>结合演示项目 herdr-sulan 的速览、3 个 Agent 状态与 4 个未提交文件回答问题：“${q}”。</think>` +
            `根据当前 **herdr-sulan** 项目状态：\n\n` +
            `1. **优先事项**：标签页 \`api-bridge\` 的终端 \`t14\`（Claude Code）正处于 **Needs you** 状态，等待确认网关 15s 超时回退策略。\n` +
            `2. **进行中工作**：终端 \`t8\`（Pi）正在验证侧边栏速览与流程图渲染，子代理 \`t19\` 正在检查 GPUI 类型。\n` +
            `3. **代码改动**：当前分支 \`feat/project-catchup\` 领先远端 2 个提交，另有 4 个未提交文件待合入。`
          Object.assign(last, replyFields(demoAnswer, MAX_ANSWER))
          this.chatPhase = 'complete'
          this.chatDurationMs = Math.max(120, Date.now() - startedAt)
          this.chatRunning = false
          cx.notify()
          return
        }

        if (!this.snapshot) {
          this.snapshot = await gatherProjectSnapshot({
            spacesList: spaces(),
            panesList: panes(),
            focusedInfo: focused(),
            agentsList: agents(),
            terminalsList: terminals(),
            execFn: exec,
            hcFn: hc,
          })
        }
        if (this.closed || epoch !== this.chatEpoch || this.projectKey !== spaceKey) return

        this.chatPhase = 'waiting'
        cx.notify()
        const rawReply = await completeModel({
          endpoint: this.endpoint,
          apiKey: this.apiKey,
          model: this.chatModel,
          effort: this.chatEffort,
          system:
            '你是 Herdr Sulan 的项目侧聊助手。当前项目的速览、Git 状态、各终端 Agent 进度和之前的侧聊是供你参考的真实数据。直接回答最后的问题，不执行工具或修改文件；缺少信息时坦诚说明。',
          prompt: sideChatPrompt(this.turns, this.summary, this.snapshot?.contextText || ''),
          maxTokens: 4000,
        })
        if (this.closed || epoch !== this.chatEpoch || this.projectKey !== spaceKey) return
        if (!rawReply.trim()) throw new Error('模型没有返回内容')

        const fields = replyFields(rawReply, MAX_ANSWER)
        delete last.thinking
        delete last.thinkingKind
        delete last.thinkingIncomplete
        Object.assign(last, fields)
        this.expandedThinking.delete(this.turns.length - 1)
        if (!fields.answer) {
          this.chatStatus = '模型只返回了思考或疑似思考，未识别到最终回答；可以重试或换模型。'
          this.chatError = true
        }
        this.persistCurrentSpace()
      } catch (err) {
        if (this.closed || epoch !== this.chatEpoch || this.projectKey !== spaceKey) return
        this.chatStatus = '未能回答：' + truncate(err?.message || String(err), 72)
        this.chatError = true
      } finally {
        if (!this.closed && epoch === this.chatEpoch && this.projectKey === spaceKey) {
          this.chatRunning = false
          this.chatPhase = this.chatError ? 'failed' : 'complete'
          this.chatDurationMs = Math.max(0, Date.now() - startedAt)
          cx.notify()
        }
      }
    })
  }

  editLastQuestion(cx) {
    const last = this.turns.at(-1)
    if (this.chatRunning || !last || last.answer !== null) return
    this.draft = last.question
    this.input.set_value(this.draft)
    this.turns = this.turns.slice(0, -1)
    this.chatStatus = ''
    this.chatError = false
    this.chatPhase = 'idle'
    this.persistCurrentSpace()
    this.input.focus()
    cx.notify()
  }

  clearChat(cx) {
    if (!this.confirmClear) {
      this.confirmClear = true
      cx.notify()
      return
    }
    this.chatEpoch++
    this.turns = []
    this.chatRunning = false
    this.chatStatus = ''
    this.chatError = false
    this.confirmClear = false
    this.chatPhase = 'idle'
    this.expandedThinking.clear()
    this.persistCurrentSpace()
    cx.notify()
  }

  copyLastAnswer(cx) {
    const lastAnswered = [...this.turns].reverse().find((t) => t.answer)
    if (!lastAnswered?.answer) return
    try {
      cx.write_to_clipboard(lastAnswered.answer)
      this.chatStatus = '回答已复制。'
      this.chatError = false
    } catch (err) {
      this.chatStatus = '复制失败：' + (err?.message || String(err))
      this.chatError = true
    }
    cx.notify()
  }

  jumpToAgent(agent) {
    if (!agent || this.mode === 'demo') return
    const root = layout()
    if (findNode(root, this.stack)) {
      run('layout.select', { stack: this.stack, child: 'sulan-workspace' })
    }
    if (agent.isSubagent && !agent.pane) {
      run('terminal.peek', { terminal: agent.address })
    } else if (agent.pane) {
      if (agent.tab) run('tab.select', { id: agent.tab })
      run('pane.focus', { pane: agent.pane })
    } else {
      run('pane.focus', { terminal: agent.address })
    }
  }

  handleKey(e, cx) {
    if (this.typing) {
      if (e.key === 'escape') {
        this.typing = false
        this.focus.focus()
        cx.stop_propagation()
        cx.notify()
      }
      return
    }
    const key = e.key?.toLowerCase()
    if (key === 'r') this.refresh(cx, { forceAi: true })
    else if (key === 'b') this.rebuild(cx)
    else if (key === 'd') this.switchMode(this.mode === 'live' ? 'demo' : 'live', cx)
    else if (key === '1') this.tab = 'summary'
    else if (key === '2') this.tab = 'pulse'
    else if (key === '3' || key === 'c') {
      this.tab = 'chat'
      this.input.focus()
    } else return
    cx.stop_propagation()
    cx.notify()
  }

  // Renders rich inline spans (`code` and **bold**) cleanly without awkward line breaks
  renderRichLine(text, t, extraStyle = {}) {
    const spans = inlineSpans(text)
    const baseColor = extraStyle.color || t.foreground
    // Lead bold term (`**词**：解释`) in `## terms`
    if (spans.length >= 2 && spans[0].bold) {
      const restText = spans
        .slice(1)
        .map((s) => s.text)
        .join('')
      return h_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .items_start()
        .child(
          div()
            .flex_1()
            .min_w(0)
            .text_color(baseColor)
            .child(`${spans[0].text}${restText}`),
        )
    }
    if (spans.length === 1 && !spans[0].code && !spans[0].bold) {
      const el = div().flex_1().min_w(0).text_color(baseColor)
      if (extraStyle.bold) el.font_semibold()
      return el.child(spans[0].text)
    }
    // Format inline code with subtle brackets/quotes or compact inline tokens so text wraps naturally as a paragraph
    const formatted = spans
      .map((s) => (s.code ? `\`${s.text}\`` : s.text))
      .join('')
    const el = div().flex_1().min_w(0).text_color(baseColor)
    if (extraStyle.bold) el.font_semibold()
    return el.child(formatted)
  }

  // Renders a summary section (`why`, `did`, `out`, `now`, `next`, `terms`) in Sulan's compact scannable style
  renderSectionCard(sec, t, compact = false) {
    const sectionColors = {
      why: t.ansi4 ?? t.accent,
      did: t.ansi5 ?? t.accent,
      out: t.working ?? t.ansi3,
      now: t.done ?? t.ansi2,
      next: t.ansi6 ?? t.accent,
      terms: t.ansi5 ?? t.muted,
    }
    const statusColors = {
      done: t.done ?? '#3fae6a',
      wip: t.working ?? '#e3814f',
      fail: t.blocked ?? '#d9649a',
      ask: t.ansi6 ?? t.accent,
      todo: t.dim,
    }
    const headColor = sectionColors[sec.id] || t.accent
    return v_flex()
      .gap(3)
      .when(!compact, (el) => el.p(10).rounded(8).bg(t.raised).border_1().border_color(t.border))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().text_size(12).text_color(headColor).child(ICONS[sec.id] || '•'))
          .child(div().text_size(12).font_semibold().text_color(headColor).child(TITLES[sec.id] || sec.id)),
      )
      .children(
        sec.items.map((item) => {
          const empty = EMPTY_ITEM.test(item.text.trim())
          const marker = item.status ? ICONS[item.status] : '•'
          const markerColor = item.status ? statusColors[item.status] : t.dim
          return h_flex()
            .gap(6)
            .items_start()
            .pl(8)
            .child(
              div()
                .w(12)
                .flex_none()
                .text_size(11.5)
                .font_semibold()
                .text_color(markerColor)
                .child(marker),
            )
            .child(
              this.renderRichLine(item.text, t, {
                color: empty ? t.dim : t.foreground,
                bold: item.status === 'ask',
              }),
            )
        }),
      )
  }

  // Renders the progress bar + native GPUI flow diagram (with fallback step list when narrow)
  renderFlowCard(parsed, t, columns = 42, compact = false) {
    const p = progressOf(parsed, flowNodes)
    const layers = parsed.flow ? flowLayers(parsed.flow) : []
    const drawn = parsed.flow ? renderFlow(parsed.flow, Math.max(22, columns - 4)) : null
    if (!p && !layers.length && !drawn && !parsed.caption?.length) return null

    const toneColors = {
      done: t.done ?? '#3fae6a',
      wip: t.working ?? '#e3814f',
      fail: t.blocked ?? '#d9649a',
      todo: t.dim,
      box: t.ansi4 ?? t.accent,
      edge: t.dim,
      label: t.muted,
      text: t.foreground,
    }

    const card = v_flex()
      .gap(6)
      .when(!compact, (el) => el.p(10).rounded(8).bg(t.raised).border_1().border_color(t.border))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().text_size(12).text_color(t.ansi4 ?? t.accent).child(ICONS.flow))
              .child(div().text_size(12).font_semibold().text_color(t.ansi4 ?? t.accent).child(TITLES.flow)),
          )
          .when(Boolean(p), (el) =>
            el.child(
              div()
                .text_size(11.5)
                .text_color(t.dim)
                .child(`${p.done}/${p.total} · ${p.pct}%`),
            ),
          ),
      )

    const inner = v_flex().gap(6).pl(8)

    if (p) {
      const donePct = `${Math.round((p.done / p.total) * 100)}%`
      const wipPct = `${Math.round((p.wip / p.total) * 100)}%`
      const failPct = `${Math.round((p.fail / p.total) * 100)}%`
      inner.child(
        h_flex()
          .w(Math.min(260, Math.max(140, columns * 6)))
          .h(5)
          .rounded(3)
          .overflow_hidden()
          .bg(t.raised)
          .when(p.done > 0, (el) => el.child(div().h_full().w(donePct).bg(toneColors.done)))
          .when(p.wip > 0, (el) => el.child(div().h_full().w(wipPct).bg(toneColors.wip)))
          .when(p.fail > 0, (el) => el.child(div().h_full().w(failPct).bg(toneColors.fail))),
      )
    }

    if (layers.length) {
      const flowBox = v_flex()
        .gap(0)
        .py(6)
        .px(8)
        .rounded(7)
        .bg(t.raised)
        .border_1()
        .border_color(t.border)
        .items_center()

      layers.forEach((layer, layerIdx) => {
        if (layerIdx > 0) {
          const singleEdgeLabel = layer.length === 1 ? layer[0].edgeLabel : ''
          flowBox.child(
            v_flex()
              .items_center()
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .child(div().text_size(10).text_color(t.dim).child('│'))
                  .when(Boolean(singleEdgeLabel), (el) =>
                    el.child(div().text_size(10).text_color(t.muted).child(singleEdgeLabel)),
                  ),
              )
              .child(div().mt(-4).text_size(9).text_color(t.dim).child('▼')),
          )
        }

        flowBox.child(
          h_flex()
            .gap(8)
            .flex_wrap()
            .justify_center()
            .children(
              layer.map((node) => {
                const st = node.status ?? 'todo'
                const col = toneColors[st] || t.border
                const nodeCard = h_flex()
                  .px(10)
                  .py(3)
                  .gap(6)
                  .items_center()
                  .rounded(6)
                  .bg(st === 'todo' ? t.background : col + '16')
                  .border_1()
                  .border_color(st === 'todo' ? t.border : col)
                  .child(div().text_size(11).font_bold().text_color(col).child(NODE_GLYPH[st] || '○'))
                  .child(div().text_size(11.5).font_medium().text_color(t.foreground).child(truncate(node.label, 26)))

                if (layer.length > 1 && node.edgeLabel) {
                  return v_flex()
                    .items_center()
                    .gap(2)
                    .child(div().text_size(9.5).text_color(t.muted).child(node.edgeLabel))
                    .child(nodeCard)
                }
                return nodeCard
              }),
            ),
        )
      })
      inner.child(flowBox)
    }

    if (parsed.caption?.length) {
      inner.child(
        v_flex()
          .gap(2)
          .children(
            parsed.caption.map((line) =>
              h_flex()
                .gap(5)
                .items_start()
                .child(div().text_color(t.dim).child('›'))
                .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).child(line)),
            ),
          ),
      )
    }

    return card.child(inner)
  }

  // Renders the Live Project Pulse section (agents, sub-agents, git changes & commits)
  renderPulseColumn(t) {
    const snap = this.snapshot
    const proj = snap?.project
    const git = snap?.git
    const agentList = snap?.agents ?? []

    const statusBadge = (st) => {
      const labels = { blocked: 'Needs you', working: 'Working', done: 'Done', idle: 'Idle' }
      const color = t[st] ?? t.dim
      return h_flex()
        .px(6)
        .py(2)
        .rounded(5)
        .bg(color + '24')
        .items_center()
        .gap(5)
        .when(st === 'working', (el) => el.child(div().text_color(color).frames(SPIN, 90).child(SPIN[0])))
        .when(st !== 'working', (el) => el.child(div().size(6).rounded_full().bg(color)))
        .child(div().text_size(10.5).font_semibold().text_color(color).child(labels[st] || st))
    }

    const out = v_flex().gap(9)

    const agentsCard = v_flex()
      .gap(7)
      .p(10)
      .rounded(8)
      .bg(t.raised)
      .border_1()
      .border_color(t.border)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(div().text_size(12).font_semibold().text_color(t.foreground).child('实时终端与 Agent'))
          .child(div().text_size(11).text_color(t.muted).child(`${agentList.length} 终端 · 点击跳转`)),
      )

    if (!agentList.length) {
      agentsCard.child(div().text_size(11.5).text_color(t.dim).child('当前项目空间暂无活跃终端。'))
    } else {
      for (const a of agentList) {
        agentsCard.child(
          v_flex()
            .id(`pulse-agent-${a.address}`)
            .gap(4)
            .p(8)
            .rounded(7)
            .bg(a.status === 'blocked' ? t.blocked + '14' : t.surface)
            .border_1()
            .border_color(a.status === 'blocked' ? t.blocked : a.focused ? t.accent : t.border)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(() => this.jumpToAgent(a))
            .child(
              h_flex()
                .justify_between()
                .items_center()
                .gap(6)
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .min_w(0)
                    .child(
                      div()
                        .px(5)
                        .py(1)
                        .rounded(4)
                        .bg(t.raised)
                        .font_family(settings().font_family ?? 'JetBrains Mono')
                        .text_size(10.5)
                        .text_color(t.accent)
                        .child(a.address),
                    )
                    .child(div().font_semibold().text_size(11.5).text_color(t.foreground).child(a.programName))
                    .child(div().text_size(11).text_color(t.dim).child(`· ${a.tabName}`)),
                )
                .child(statusBadge(a.status)),
            )
            .child(div().text_size(11).text_color(t.muted).truncate().child(a.name))
            .when(Boolean(a.subagents?.length), (el) =>
              el.child(
                v_flex()
                  .gap(3)
                  .pt(3)
                  .pl(8)
                  .border_l(2)
                  .border_color(t.border)
                  .children(
                    (a.subagents ?? []).map((sub) =>
                      h_flex()
                        .id(`pulse-sub-${sub.address}`)
                        .justify_between()
                        .items_center()
                        .py(2)
                        .px(6)
                        .rounded(5)
                        .hover((s) => s.bg(t.hover))
                        .on_click((_e, cx) => {
                          cx.stop_propagation()
                          this.jumpToAgent(sub)
                        })
                        .child(
                          h_flex()
                            .gap(6)
                            .items_center()
                            .child(div().text_size(10.5).text_color(t.dim).child(`└ ${sub.address}`))
                            .child(div().text_size(11).text_color(t.foreground).child(truncate(sub.name, 26))),
                        )
                        .child(div().text_size(10).text_color(t[sub.status] ?? t.muted).child(sub.status)),
                    ),
                  ),
              ),
            ),
        )
      }
    }
    out.child(agentsCard)

    const gitCard = v_flex()
      .gap(6)
      .p(10)
      .rounded(8)
      .bg(t.raised)
      .border_1()
      .border_color(t.border)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(div().text_size(12).font_semibold().text_color(t.foreground).child('Git 状态与改动'))
          .child(
            div()
              .text_size(11)
              .text_color(t.accent)
              .child(git ? `${git.branch}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}` : '非 Git 目录'),
          ),
      )

    if (!git) {
      gitCard.child(div().text_size(11).text_color(t.dim).child(proj?.folder || '未检测到 Git 仓库'))
    } else {
      if (git.files?.length) {
        gitCard.child(div().text_size(11).text_color(t.muted).child(`未提交文件 (${git.totalFiles})：`))
        gitCard.child(
          v_flex()
            .gap(3)
            .children(
              git.files.slice(0, 8).map((f) =>
                h_flex()
                  .gap(7)
                  .items_center()
                  .font_family(settings().font_family ?? 'JetBrains Mono')
                  .text_size(11)
                  .child(
                    div()
                      .w(12)
                      .font_semibold()
                      .text_color(f.status === 'A' ? t.done : f.status === 'D' ? t.blocked : t.working)
                      .child(f.status),
                  )
                  .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(f.path)),
              ),
            ),
        )
      } else {
        gitCard.child(div().text_size(11).text_color(t.done).child('✓ 工作区干净，无未提交改动'))
      }

      if (git.commits?.length) {
        gitCard.child(div().pt(3).text_size(11).text_color(t.muted).child('最近提交：'))
        gitCard.child(
          v_flex()
            .gap(3)
            .children(
              git.commits.slice(0, 4).map((c) =>
                h_flex()
                  .gap(6)
                  .items_center()
                  .text_size(11)
                  .child(
                    div()
                      .font_family(settings().font_family ?? 'JetBrains Mono')
                      .text_size(10.5)
                      .text_color(t.dim)
                      .child(c.hash),
                  )
                  .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.subject)),
              ),
            ),
        )
      }
    }
    out.child(gitCard)
    return out
  }

  // Renders the Side Chat pane/tab
  renderChatColumn(t) {
    const unanswered = this.turns.at(-1)?.answer === null
    const lastAnswer = [...this.turns].reverse().find((x) => x.answer)?.answer ?? ''
    const modelLabel = DEFAULT_MODELS.find((m) => m.value === this.chatModel)?.label ?? this.chatModel
    const effortLabel = EFFORT_CHOICES.find((e) => e.value === this.chatEffort)?.label ?? this.chatEffort

    const pill = (id, label, active, action) =>
      div()
        .id(id)
        .px(8)
        .py(4)
        .rounded(5)
        .text_size(11)
        .bg(active ? t.selected : t.surface)
        .border_1()
        .border_color(active ? t.accent : t.border)
        .text_color(active ? t.accent : t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => action(cx))
        .child(label)

    const card = v_flex()
      .gap(8)
      .p(10)
      .rounded(8)
      .bg(t.raised)
      .border_1()
      .border_color(t.border)
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().text_size(12.5).font_semibold().text_color(t.accent).child('✦ 侧聊'))
              .child(div().text_size(11).text_color(t.dim).child('独立提问，不打断任务')),
          )
          .when(this.chatRunning, (el) =>
            el.child(
              h_flex()
                .gap(5)
                .items_center()
                .child(div().text_color(t.working).frames(SPIN, 90).child(SPIN[0]))
                .child(div().text_size(11).text_color(t.working).child('等待回复…')),
            ),
          )
          .when(!this.chatRunning && (this.chatPhase === 'complete' || this.chatPhase === 'failed'), (el) => {
            const elapsed = durationText(this.chatDurationMs)
            const failed = this.chatPhase === 'failed'
            return el.child(
              div()
                .text_size(11)
                .text_color(failed ? t.blocked : t.done)
                .child(`${failed ? '✗ 未完成' : '✓ 已完成'}${elapsed ? ` · ${elapsed}` : ''}`),
            )
          }),
      )

    card.child(
      h_flex()
        .gap(5)
        .flex_wrap()
        .items_center()
        .child(
          pill('sulan-model-btn', `模型：${truncate(modelLabel, 22)} ▾`, this.choosingModel, (cx) => {
            this.choosingEffort = false
            this.choosingModel = !this.choosingModel
            cx.notify()
          }),
        )
        .child(
          pill('sulan-effort-btn', `思考：${effortLabel} ▾`, this.choosingEffort, (cx) => {
            this.choosingModel = false
            this.choosingEffort = !this.choosingEffort
            cx.notify()
          }),
        ),
    )

    if (this.choosingModel && !this.chatRunning) {
      card.child(
        v_flex()
          .gap(4)
          .p(6)
          .rounded(6)
          .bg(t.surface)
          .border_1()
          .border_color(t.border)
          .children(
            DEFAULT_MODELS.map((m, idx) =>
              h_flex()
                .id(`sulan-pick-model-${idx}`)
                .px(8)
                .py(4)
                .rounded(5)
                .justify_between()
                .cursor_pointer()
                .bg(m.value === this.chatModel ? t.selected : t.surface)
                .hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => {
                  this.chatModel = m.value
                  this.choosingModel = false
                  this.persistPrefs()
                  cx.notify()
                })
                .child(div().text_size(11).text_color(t.foreground).child(m.label))
                .child(div().text_size(10.5).text_color(t.dim).child(m.value)),
            ),
          ),
      )
    }

    if (this.choosingEffort && !this.chatRunning) {
      card.child(
        h_flex()
          .gap(5)
          .flex_wrap()
          .p(6)
          .rounded(6)
          .bg(t.surface)
          .border_1()
          .border_color(t.border)
          .children(
            EFFORT_CHOICES.map((ef) =>
              pill(`sulan-effort-${ef.value}`, ef.label, ef.value === this.chatEffort, (cx) => {
                this.chatEffort = ef.value
                this.choosingEffort = false
                this.persistPrefs()
                cx.notify()
              }),
            ),
          ),
      )
    }

    if (!this.chatRunning && unanswered) {
      card.child(
        h_flex()
          .gap(6)
          .child(pill('sulan-chat-retry', '↻ 重试', true, (cx) => this.runChatTurn(cx)))
          .child(pill('sulan-chat-edit', '✎ 编辑问题', false, (cx) => this.editLastQuestion(cx))),
      )
    } else {
      card.child(
        h_flex()
          .gap(6)
          .items_center()
          .child(
            div()
              .id('sulan-chat-input-box')
              .flex_1()
              .min_w(0)
              .h(32)
              .px(9)
              .flex()
              .items_center()
              .rounded(7)
              .bg(t.background)
              .border_1()
              .border_color(this.typing ? t.accent : t.input)
              .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
              .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)),
          )
          .child(
            div()
              .id('sulan-chat-send')
              .h(32)
              .px(11)
              .flex()
              .items_center()
              .rounded(7)
              .bg(this.draft.trim() && !this.chatRunning ? t.solid : t.surface)
              .text_color(this.draft.trim() && !this.chatRunning ? t.solid_foreground : t.dim)
              .text_size(11.5)
              .font_medium()
              .cursor_pointer()
              .hover((s) => s.opacity(0.9))
              .on_click((_e, cx) => this.submitChat(cx))
              .child('发送'),
          ),
      )
    }

    if (this.chatStatus) {
      card.child(
        div()
          .text_size(11)
          .text_color(this.chatError ? t.blocked : t.done)
          .child(this.chatStatus),
      )
    }

    if (!this.turns.length) {
      card.child(div().text_size(11).text_color(t.dim).child('从这里开始，或者试试：'))
      card.child(
        v_flex()
          .gap(4)
          .children(
            SUGGESTIONS.map(([label, q], idx) =>
              div()
                .id(`sulan-suggest-${idx}`)
                .px(8)
                .py(5)
                .rounded(6)
                .bg(t.surface)
                .border_1()
                .border_color(t.border)
                .text_size(11.5)
                .text_color(t.foreground)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover).border_color(t.accent))
                .on_click((_e, cx) => this.submitChat(cx, q))
                .child(`› ${label}`),
            ),
          ),
      )
    } else {
      card.child(
        h_flex()
          .gap(6)
          .items_center()
          .when(Boolean(lastAnswer && !this.confirmClear), (el) =>
            el.child(pill('sulan-chat-copy', '复制最近回答', false, (cx) => this.copyLastAnswer(cx))),
          )
          .when(!this.confirmClear, (el) =>
            el.child(pill('sulan-chat-clear', '清空侧聊', false, (cx) => this.clearChat(cx))),
          )
          .when(this.confirmClear, (el) =>
            el
              .child(pill('sulan-chat-clear-yes', '确认清空', true, (cx) => this.clearChat(cx)))
              .child(
                pill('sulan-chat-clear-no', '取消', false, (cx) => {
                  this.confirmClear = false
                  cx.notify()
                }),
              ),
          ),
      )

      card.child(
        v_flex()
          .gap(8)
          .pt(2)
          .children(
            [...this.turns].reverse().map((turn, revIdx) => {
              const idx = this.turns.length - 1 - revIdx
              const reply = turnReply(turn)
              const expanded = this.expandedThinking.has(idx)
              const box = v_flex()
                .gap(5)
                .p(9)
                .rounded(7)
                .bg(t.surface)
                .border_1()
                .border_color(t.border)
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(div().text_size(11).font_semibold().text_color(t.ansi6 ?? t.accent).child('你'))
                    .child(div().flex_1().min_w(0).text_size(11.5).font_medium().text_color(t.foreground).child(turn.question)),
                )

              if (reply.thinking) {
                const thinkTitle = reply.kind === 'suspected' ? '疑似 Thinking' : 'Thinking'
                box.child(
                  div()
                    .id(`sulan-think-toggle-${idx}`)
                    .px(7)
                    .py(3)
                    .rounded(4)
                    .bg(t.raised)
                    .text_size(11)
                    .text_color(t.muted)
                    .cursor_pointer()
                    .hover((s) => s.bg(t.hover))
                    .on_click((_e, cx) => {
                      if (expanded) this.expandedThinking.delete(idx)
                      else this.expandedThinking.add(idx)
                      cx.notify()
                    })
                    .child(`${expanded ? '▾' : '▸'} ${thinkTitle} · ${expanded ? '收起' : '展开'}`),
                )
                if (expanded) {
                  box.child(
                    div()
                      .p(7)
                      .rounded(5)
                      .bg(t.background)
                      .text_size(11)
                      .text_color(t.muted)
                      .child(reply.thinking),
                  )
                }
              }

              if (reply.answer) {
                box.child(
                  v_flex()
                    .gap(4)
                    .pt(2)
                    .children(reply.answer.split('\n').filter(Boolean).map((line) => this.renderRichLine(line, t))),
                )
              } else if (!this.chatRunning) {
                box.child(div().text_size(11).text_color(t.dim).child('这条提问尚未得到回答。'))
              }
              return box
            }),
          ),
      )
    }

    return card
  }

  // Workspace tab bar role (`props.role === "tabs"`): identical to Herdr's default
  // `tabs` mod, plus the "速览" toggle button right alongside "Files" and "Changes"
  // so clicking "速览" toggles the right-hand sidebar panel (`panel` / `panel-body`).
  syncTabPanel(space, panel, body, enabled) {
    if (!space || !panel) return
    const now = panel.hidden ? null : body?.active ?? null
    if (space.id !== this.activeSpaceId) {
      const first = this.activeSpaceId === undefined
      this.activeSpaceId = space.id
      this.pendingPanel = null
      if (!(first && !(space.id in this.spacePanels))) {
        const stored = this.spacePanels[space.id] ?? 'sulan'
        const want = enabled.includes(stored) ? stored : null
        if (want !== now) {
          this.pendingPanel = { want, until: Date.now() + 1000 }
          if (want) {
            run('layout.select', { stack: 'panel-body', child: want })
            run('layout.show', { id: 'panel' })
          } else {
            run('layout.hide', { id: 'panel' })
          }
          return
        }
      }
    }
    if (this.pendingPanel) {
      if (this.pendingPanel.want !== now && Date.now() < this.pendingPanel.until) return
      this.pendingPanel = null
    }
    if (this.spacePanels[space.id] === now) return
    this.spacePanels[space.id] = now
    saveState('space.panels', this.spacePanels)
  }

  renderWorkspaceTabs(t) {
    const space = spaces().find((p) => p.active)
    const shown = space?.tabs ?? []
    const stop = (_e, cx) => cx.stop_propagation()
    const button = (id, label, action) =>
      div()
        .id(id)
        .size(26)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(6)
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down('left', stop)
        .on_click(action)
        .child(label)

    const item = (c, i) => {
      const program =
        panes().find((p) => p.tab === c.id && p.program?.agent)?.program ??
        panes().find((p) => p.tab === c.id)?.program
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? 'Terminal' : c.name
      return h_flex()
        .id(`tab-${c.id}`)
        .h(29)
        .px(10)
        .gap(7)
        .rounded(7)
        .items_center()
        .flex_none()
        .text_size(12.8)
        .border(1)
        .border_color(c.active ? t.border : t.chrome)
        .bg(c.active ? t.raised : t.chrome)
        .text_color(c.active ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down('left', (e, cx) => {
          cx.stop_propagation()
          this.pressedTab = i
          if (e.click_count === 2) run('tab.rename', { id: c.id })
        })
        .on_mouse_up('left', () => {
          const from = this.pressedTab
          this.pressedTab = null
          if (from !== null && from !== i) {
            run('tab.move', { id: shown[from].id, index: space.tabs.findIndex((x) => x.id === c.id) + 1 })
          } else {
            run('tab.select', { id: c.id })
          }
        })
        .on_mouse_down('right', (_e, cx) => {
          cx.stop_propagation()
          openOverlay({ mod: 'menu', kind: 'popup', width: 200, props: { tab: 'tab', target: { id: c.id, space: space.id } } })
        })
        .when(Boolean(program?.icon), (el) =>
          el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)),
        )
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === 'working', (el) =>
          el.child(svg('mods/workspace-chrome/spinner.svg').size(12).flex_none().text_color(t.working).spin(900)),
        )
        .when(c.status === 'blocked' || c.status === 'done', (el) => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, (el) =>
          el.child(
            div()
              .id(`close-${c.id}`)
              .text_color(t.dim)
              .on_mouse_down('left', stop)
              .on_click((_e, cx) => {
                cx.stop_propagation()
                run('tab.close', { id: c.id })
              })
              .child(svg('mods/pane/close.svg').size(12)),
          ),
        )
    }

    const root = layout()
    const sidebar = findNode(root, 'sidebar')
    const w = win()
    const lightsPadding =
      w?.platform === 'macos' && w.titlebar === 'none' && !w.fullscreen && root?.traffic_lights
        ? Math.max(10, (root.traffic_lights[0] + 64) / (settings().zoom || 1) - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
        : 10
    const panel = findNode(root, 'panel')
    const body = findNode(root, 'panel-body')
    const baseEnabled = shared('workspace.panels') ?? ['files', 'changes']
    const enabled = baseEnabled.includes('sulan') ? baseEnabled : ['sulan', ...baseEnabled]
    this.syncTabPanel(space, panel, body, enabled)

    const panelButton = (id, label, iconPath, highlight = false) => {
      const on = panel && !panel.hidden && body?.active === id
      return h_flex()
        .id(`panel-${id}`)
        .h(26)
        .px(8)
        .gap(5)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? (highlight ? t.accent : t.foreground) : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down('left', stop)
        .on_click(() => {
          if (on) {
            run('layout.hide', { id: 'panel' })
          } else {
            run('layout.select', { stack: 'panel-body', child: id })
            run('layout.show', { id: 'panel' })
          }
        })
        .child(svg(iconPath).size(14))
        .child(label)
    }

    return h_flex()
      .size_full()
      .min_w(0)
      .px(10)
      .pl(lightsPadding)
      .gap(3)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .on_mouse_up('left', () => {
        this.pressedTab = null
      })
      .on_scroll_wheel((e) => {
        if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? 'tab.prev' : 'tab.next')
      })
      .child(h_flex().id('tab-scroll').flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button('tab-new', '+', () => openOverlay({ mod: 'new-menu', kind: 'popup', width: 250, height: 512 })))
      .child(panelButton('sulan', '速览', 'mods/sulan/sulan.svg', true))
      .when(enabled.includes('files'), (el) => el.child(panelButton('files', 'Files', 'mods/files/file.svg')))
      .when(enabled.includes('changes'), (el) => el.child(panelButton('changes', 'Changes', 'mods/changes/changes.svg')))
      .when(Boolean(w?.buttons), (el) =>
        el
          .child(
            button('minimize', w.platform === 'windows' ? svg('mods/tabs/win-min.svg').size(16) : '−', () =>
              run('window.minimize'),
            ),
          )
          .child(
            button(
              'maximize',
              w.platform === 'windows' ? svg(`mods/tabs/${w.maximized ? 'win-restore' : 'win-max'}.svg`).size(16) : '□',
              () => run('window.maximize'),
            ),
          )
          .child(
            button(
              'close-window',
              w.platform === 'windows' ? svg('mods/tabs/win-close.svg').size(16) : svg('mods/pane/close.svg').size(13),
              () => run('window.close'),
            ),
          ),
      )
  }

  // Top navigation bar when used in full-page stack mode (`props.role === "nav"`)
  renderNav(t) {
    const root = layout()
    const activePage = findNode(root, this.stack)?.active || 'sulan-page'
    const proj = activeProject(spaces(), panes(), focused())
    const allAgents = agents()
    const blockedCount = allAgents.filter((a) => a.status === 'blocked').length
    const workingCount = allAgents.filter((a) => a.status === 'working').length
    const sharedTldr = shared('sulan.tldr')

    const navItem = (id, label, badge = null) => {
      const on = activePage === id
      return h_flex()
        .id(`sulan-nav-${id}`)
        .px(12)
        .py(6)
        .gap(6)
        .items_center()
        .rounded(6)
        .text_size(12.5)
        .font_medium()
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
        .on_click(() => run('layout.select', { stack: this.stack, child: id }))
        .child(label)
        .when(Boolean(badge), (el) => el.child(badge))
    }

    return h_flex()
      .id('sulan-top-nav')
      .size_full()
      .px(14)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .child(navItem('sulan-workspace', 'Workspace'))
      .child(
        navItem(
          this.pageId,
          '◆ 速览 · Sulan',
          blockedCount > 0
            ? div()
                .px(5)
                .py(1)
                .rounded(4)
                .bg(t.blocked + '28')
                .text_size(10.5)
                .font_semibold()
                .text_color(t.blocked)
                .child(`${blockedCount} 待处理`)
            : workingCount > 0
              ? div().size(6).rounded_full().bg(t.working)
              : null,
        ),
      )
      .child(div().w(1).h(16).mx(4).bg(t.border))
      .when(Boolean(proj), (el) =>
        el.child(
          h_flex()
            .gap(6)
            .items_center()
            .text_size(12)
            .child(div().font_semibold().text_color(t.foreground).child(proj.name))
            .when(Boolean(proj.branch), (b) => b.child(div().text_color(t.dim).child(`(${proj.branch})`))),
        ),
      )
      .when(Boolean(sharedTldr?.tldr), (el) =>
        el.child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .text_size(11.5)
            .text_color(t.muted)
            .child(`· ${sharedTldr.tldr}`),
        ),
      )
      .when(!sharedTldr?.tldr, (el) => el.child(div().flex_1()))
      .child(div().text_size(11).text_color(t.dim).child('Sulan Sidebar & Catch-up'))
  }

  render(cx) {
    const t = theme()
    if (this.role === 'tabs') return this.renderWorkspaceTabs(t)
    if (this.role === 'nav') return this.renderNav(t)

    // Detect if the user switched to another Space in Herdr
    const prevKey = this.projectKey
    const switched = this.syncSpaceStorage()
    if (switched && prevKey && this.mode === 'live') {
      this.refresh(cx, { forceAi: false })
    }

    const isSidebar = this.role === 'sidebar' || this.width < 760
    const parsed = this.parsed
    const snap = this.snapshot
    const proj = snap?.project ?? activeProject(spaces(), panes(), focused())
    const p = progressOf(parsed, flowNodes)

    const tabBtn = (id, label, active, onClick) =>
      div()
        .id(id)
        .px(9)
        .py(4)
        .rounded(6)
        .text_size(11.5)
        .font_medium()
        .bg(active ? t.selected : t.raised)
        .border_1()
        .border_color(active ? t.accent : t.border)
        .text_color(active ? t.accent : t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          this.focus.focus()
          onClick(cx)
        })
        .child(label)

    // Top bar matching Herdr's `files` and `changes` right-hand sidebar card style
    const topBar = h_flex()
      .h(36)
      .flex_none()
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().text_color(t.accent).font_bold().child('◆'))
      .child(div().font_semibold().text_color(t.foreground).child('速览'))
      .when(Boolean(proj?.name), (el) =>
        el.child(
          div()
            .px(6)
            .py(1)
            .rounded(4)
            .border_1()
            .border_color(t.border)
            .text_size(10.5)
            .text_color(t.muted)
            .truncate()
            .max_w(140)
            .child(proj.name + (proj.branch ? ` · ${proj.branch}` : '')),
        ),
      )
      .child(div().flex_1())
      .child(
        div()
          .text_size(11)
          .text_color(this.isError ? t.blocked : this.loadingContext || this.summarizing ? t.working : t.dim)
          .child(this.statusText || clockText(this.updatedAt)),
      )

    // Sub-header with TL;DR headline + mode/tab controls
    const subHeader = v_flex()
      .px(12)
      .py(7)
      .gap(6)
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .child(
        div()
          .text_size(12.5)
          .font_semibold()
          .text_color(t.foreground)
          .child(parsed?.tldr || '正在汇总当前项目的目标、改动、Agent 状态与下一步…'),
      )
      .child(
        h_flex()
          .gap(5)
          .flex_wrap()
          .items_center()
          .when(isSidebar, (el) =>
            el
              .child(tabBtn('sulan-tab-summary', '速览', this.tab === 'summary', () => { this.tab = 'summary' }))
              .child(tabBtn('sulan-tab-chat', `侧聊${this.turns.length ? ` (${this.turns.length})` : ''}`, this.tab === 'chat', () => { this.tab = 'chat' }))
              .child(tabBtn('sulan-tab-pulse', `终端 (${snap?.agents?.length ?? 0})`, this.tab === 'pulse', () => { this.tab = 'pulse' })),
          )
          .child(div().flex_1())
          .child(
            tabBtn(
              'sulan-btn-refresh',
              this.loadingContext || this.summarizing ? '更新中…' : '刷新',
              false,
              (cx) => this.refresh(cx, { forceAi: true }),
            ),
          )
          .child(tabBtn('sulan-btn-rebuild', '重建', false, (cx) => this.rebuild(cx)))
          .child(
            tabBtn(
              'sulan-btn-mode',
              this.mode === 'demo' ? '实时' : '演示',
              this.mode === 'demo',
              (cx) => this.switchMode(this.mode === 'live' ? 'demo' : 'live', cx),
            ),
          ),
      )

    // Summary Column
    const flowCols = isSidebar ? Math.max(26, Math.floor(((this.width || 380) - 36) / 8)) : 50
    const summaryColumn = v_flex().gap(5).min_w(0)

    if (parsed) {
      for (const sec of parsed.sections) {
        summaryColumn.child(this.renderSectionCard(sec, t, isSidebar))
      }
      const flowCard = this.renderFlowCard(parsed, t, flowCols, isSidebar)
      if (flowCard) summaryColumn.child(flowCard)
    } else if (this.summary) {
      summaryColumn.child(
        v_flex()
          .p(10)
          .rounded(8)
          .bg(t.raised)
          .border_1()
          .border_color(t.border)
          .child(div().text_size(12).text_color(t.foreground).child(this.summary)),
      )
    } else {
      summaryColumn.child(
        v_flex()
          .p(12)
          .gap(5)
          .rounded(8)
          .bg(t.raised)
          .border_1()
          .border_color(t.border)
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child('还没有摘要'))
          .child(div().text_size(11.5).text_color(t.muted).child('自动读取当前 Space 的 Git 状态与终端进展，或按 r 立即生成。')),
      )
    }

    const rightColumn = v_flex()
      .gap(10)
      .min_w(0)
      .child(this.renderChatColumn(t))
      .child(this.renderPulseColumn(t))

    const body = v_flex()
      .id('sulan-scroll-body')
      .flex_1()
      .min_h(0)
      .min_w(0)
      .overflow_y_scrollbar()
      .px(isSidebar ? 10 : 18)
      .py(isSidebar ? 8 : 16)
      .gap(8)

    if (isSidebar) {
      if (this.tab === 'chat') body.child(this.renderChatColumn(t))
      else if (this.tab === 'pulse') body.child(this.renderPulseColumn(t))
      else body.child(summaryColumn)
    } else {
      body.child(
        h_flex()
          .gap(16)
          .items_start()
          .min_w(0)
          .child(summaryColumn.flex_1())
          .child(rightColumn.w(Math.min(440, Math.max(340, Math.floor(this.width * 0.42))))),
      )
    }

    const footer = h_flex()
      .px(12)
      .py(6)
      .justify_between()
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .text_size(10.5)
      .text_color(t.dim)
      .child(div().truncate().child(p ? `进度 ${p.done}/${p.total} · ${p.pct}%` : `◆ ${proj?.name || '速览'}`))
      .child(div().flex_none().child('r 刷新 · b 重建 · c 侧聊'))

    // Matches Herdr's native right-hand panel card container (`rounded(10).bg(t.background).border_1()`)
    return v_flex()
      .id('sulan-root')
      .size_full()
      .min_w(0)
      .min_h(0)
      .rounded(this.role === 'sidebar' ? 10 : 0)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(12.5)
      .track_focus(this.focus)
      .on_key_down((e, cx) => this.handleKey(e, cx))
      .on_mouse_down('left', () => this.focus.focus())
      .on_size_change((size, cx) => {
        if (Math.abs((this.width || 0) - size.width) >= 4) {
          this.width = size.width
          cx.notify()
        }
      })
      .child(topBar)
      .child(subHeader)
      .child(body)
      .child(footer)
  }
}

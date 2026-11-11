// Native reading surfaces. Build only the selected tab; Markdown stays in one
// TextView per document instead of a native element for every word and line.
import { div, svg } from 'gpui-kit'
import { h_flex, v_flex, TextView, Textarea, Button, Scrollbar } from 'gpui-base'
import { SUGGESTIONS, durationText, turnReply } from './chat.js'

const STARTER_ICONS = ['→', '?', '✦']
const TOOL_STATUS_LABEL = { running: '执行中', complete: '完成', error: '失败', cancelled: '停止' }

export function shortModelName(model) {
  const raw = String(model || '').trim()
  if (!raw) return '未设模型'
  const name = raw.includes('/') ? raw.split('/').pop() : raw
  return name.length > 20 ? name.slice(0, 19) + '…' : name
}

export function action(id, title, t, onClick, { active = false, disabled = false, primary = false, danger = false, subtle = false, icon = null } = {}) {
  const fg = disabled ? t.dim : primary ? t.solid_foreground : danger ? t.blocked : active ? t.foreground : subtle ? t.muted : t.foreground
  const bg = primary && !disabled ? t.solid : active ? t.selected : subtle ? t.background : t.surface
  const border = primary && !disabled ? t.solid : danger && !disabled ? t.blocked : active ? t.accent : t.border
  const btn = Button.new(id).accessibility_label(title).disabled(disabled)
    .px(subtle ? 8 : 10).h(subtle ? 26 : 28).rounded(7).text_size(12).font_medium()
    .text_color(fg).bg(bg).border_1().border_color(subtle && !active ? t.background : border)
    .when(primary && !disabled, el => el.shadow_xs())
    .when(!primary && !subtle && !disabled, el => el.shadow_2xs())
    .hover(s => s.bg(primary && !disabled ? t.solid : disabled ? bg : t.hover).border_color(primary && !disabled ? t.solid : active ? t.accent : t.border))
    .on_click((_e, cx) => { if (!disabled) onClick(cx) })
  return icon
    ? btn.child(h_flex().items_center().gap(5).child(svg(icon).size(12).text_color(fg)).child(title))
    : btn.child(title)
}

export function segmentTab(id, title, t, onClick, { active = false, disabled = false, busy = false } = {}) {
  const btn = Button.new(id).accessibility_label(title).disabled(disabled).selected(active)
    .px(11).h(26).rounded(6).text_size(12)
    .when(active, el => el.font_semibold().shadow_xs())
    .when(!active, el => el.font_medium())
    .text_color(disabled ? t.dim : active ? t.foreground : t.muted)
    .bg(active ? t.raised : t.surface)
    .border_1().border_color(active ? t.border : t.surface)
    .hover(s => s.bg(active ? t.raised : t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { if (!disabled) onClick(cx) })
  return busy
    ? btn.child(h_flex().items_center().gap(5).child(div().size(6).rounded_full().bg(t.working)).child(title))
    : btn.child(title)
}

export function segmentedTabs(id, t, children) {
  return h_flex().id(id).p(2).gap(2).rounded(8).bg(t.surface).border_1().border_color(t.border).items_center().children(children)
}

export function disclosureAction(id, title, t, onClick, { open = false, tone = null, badge = '' } = {}) {
  const row = h_flex().items_center().gap(6)
    .child(div().text_size(11).text_color(tone || t.muted).child(open ? '▾' : '▸'))
    .child(div().text_size(12).font_medium().text_color(tone || (open ? t.foreground : t.muted)).child(title))
  if (badge) row.child(div().px(6).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(badge))
  return Button.new(id).accessibility_label(title).px(9).h(26).rounded(6)
    .bg(open ? t.selected : t.surface).border_1().border_color(t.border).shadow_2xs()
    .hover(s => s.bg(t.hover))
    .on_click((_e, cx) => onClick(cx))
    .child(row)
}

export function surfaceCard(id, t) {
  return v_flex().id(id).p(14).gap(10).rounded(9).bg(t.surface).border_1().border_color(t.border).shadow_xs().min_w(0)
}

export function statusChip(view, label, t) {
  const dotColor = view.busy() || view.mode === 'demo'
    ? t.working
    : view.paused || view.autoFailures > 0 || view.isError
      ? t.blocked
      : view.autoUpdate
        ? t.done
        : t.muted
  return h_flex().id('sulan-status-chip').h(24).px(8).gap(6).items_center().rounded_full()
    .bg(t.surface).border_1().border_color(t.border)
    .child(div().size(6).rounded_full().bg(dotColor))
    .child(div().text_size(11).font_medium().text_color(t.muted).child(label))
}

export function toolStepSummary(tools, open) {
  const total = tools?.length || 0
  if (!total) return ''
  const running = tools.find(tool => tool.status === 'running')
  const failed = tools.filter(tool => tool.status === 'error').length
  if (open) return `收起工具步骤 (${total} 步)`
  if (running) return `正在执行 · ${running.label || running.name}`
  if (failed) return `工具步骤 · ${total} 步 (${failed} 失败)`
  return `已完成 ${total} 步工具调用`
}

export function markdown(id, text, t) {
  return TextView.markdown(id, text).w_full().min_w(0).font_normal().text_size(13)
    .line_height('21px').text_color(t.foreground).selectable(true).scrollable(false)
}

function scroller(id, content) {
  return div().flex_1().min_h(0).relative()
    .child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().px(18).py(18).gap(18).child(content))
    .child(Scrollbar.vertical(id).absolute().inset_0())
}

export function summaryView(view, t) {
  const content = v_flex().w_full().min_w(0).gap(18)
  const brief = view.brief
  if (!brief.headline) {
    content.child(v_flex().id('brief-empty-card').p(16).gap(10).rounded(9).bg(t.surface).border_1().border_color(t.border).shadow_xs()
      .child(div().text_size(17).font_semibold().child('回到项目，先抓重点'))
      .child(div().text_size(13).line_height('21px').text_color(t.muted).child('资料变化后会自动整理当前结论、工作进展，以及接下来最值得做的一件事。'))
      .child(h_flex().pt(2).child(action('summary-first-update', '整理项目重点', t, cx => view.refresh(cx, { forceAi: true }), { primary: true, disabled: view.busy() }))))
  } else {
    content.child(div().text_size(18).line_height('27px').font_semibold().child(brief.headline))
    if (brief.attention) {
      content.child(v_flex().id('brief-attention-card').p(12).pl(14).gap(8).rounded(8)
        .bg(t.raised).border_1().border_color(t.border).border_l_3().shadow_xs()
        .child(h_flex().items_center().justify_between().gap(8)
          .child(h_flex().items_center().gap(6)
            .child(div().size(7).rounded_full().bg(t.working))
            .child(div().text_size(12.5).font_semibold().text_color(t.working).child('需要你关注')))
          .child(div().px(6).py(1).rounded(4).bg(t.surface).text_size(10.5).text_color(t.muted).child('待决策 / 阻塞')))
        .child(markdown('brief-attention', brief.attention, t)))
    }
    if (brief.markdown) content.child(markdown('brief-document', brief.markdown, t))
    if (brief.details) {
      content.child(div().h(1).w_full().bg(t.border))
        .child(disclosureAction('summary-details', view.detailsOpen ? '收起完整内容' : '展开背景与完整内容', t, cx => {
          view.detailsOpen = !view.detailsOpen; cx.notify()
        }, { open: view.detailsOpen }))
      if (view.detailsOpen) content.child(markdown('brief-details', brief.details, t))
    }
  }
  if (view.note) {
    content.child(h_flex().id('brief-note-banner').px(10).py(7).gap(6).items_center().rounded(7)
      .bg(t.surface).border_1().border_color(view.isError ? t.blocked : t.border)
      .child(div().size(6).rounded_full().bg(view.isError ? t.blocked : t.muted))
      .child(div().flex_1().min_w(0).text_size(12).line_height('18px').text_color(view.isError ? t.blocked : t.muted).child(view.note)))
  }
  return scroller('sulan-summary-scroll', content)
}

function exchange(view, turn, index, t) {
  const reply = turnReply(turn)
  const isLast = index === view.turns.length - 1
  const isRunning = view.chatRunning && isLast
  const nowMs = Date.now()
  const elapsedMs = isRunning
    ? Math.max(0, nowMs - (turn.startedAt || view.chatStartedAt || nowMs))
    : turn.durationMs
  const elapsedLabel = durationText(elapsedMs)
  const item = v_flex().gap(12).min_w(0)

  item.child(v_flex().ml(20).p(12).gap(4).rounded(9).bg(t.raised).border_1().border_color(t.border).shadow_2xs()
    .child(div().text_size(11).font_medium().text_color(t.muted).child('你'))
    .child(div().text_size(13).font_medium().line_height('21px').child(turn.question)))

  const responderHeader = h_flex().items_center().justify_between().gap(8)
    .child(h_flex().items_center().gap(6)
      .child(div().size(6).rounded_full().bg(isRunning ? t.working : turn.incomplete ? t.blocked : t.done))
      .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(turn.agent ? '项目 Agent' : 'Sulan')))
  if (elapsedLabel) {
    responderHeader.child(div().id(`chat-elapsed-${index}`).px(6).py(1).rounded(4).bg(t.surface).border_1().border_color(t.border)
      .text_size(10.5).text_color(isRunning ? t.working : t.muted).child(isRunning ? `耗时 ${elapsedLabel}` : elapsedLabel))
  }
  item.child(responderHeader)

  if (turn.tools?.length || reply.thinking) {
    const trace = v_flex().id(`chat-trace-${index}`).gap(6).min_w(0)
    if (turn.tools?.length) {
      const open = view.expandedTools.has(index)
      const runningTool = turn.tools.find(tool => tool.status === 'running')
      const hasError = turn.tools.some(tool => tool.status === 'error')
      const tone = runningTool ? t.working : hasError ? t.blocked : null
      trace.child(disclosureAction(`chat-tools-${index}`, toolStepSummary(turn.tools, open), t, cx => {
        if (open) view.expandedTools.delete(index); else view.expandedTools.add(index)
        cx.notify()
      }, { open, tone, badge: open ? '' : `${turn.tools.length} 步` }))
      if (open) {
        const trail = v_flex().id(`chat-step-trail-${index}`).p(10).pl(12).gap(6).rounded(8)
          .bg(t.surface).border_1().border_color(t.border).border_l_2()
        for (const tool of turn.tools) {
          const dotColor = tool.status === 'running' ? t.working : tool.status === 'error' ? t.blocked : tool.status === 'cancelled' ? t.muted : t.done
          trail.child(h_flex().gap(8).items_center().px(6).py(3).rounded(5).bg(tool.status === 'running' ? t.raised : t.surface)
            .child(div().size(6).rounded_full().bg(dotColor))
            .child(div().flex_1().min_w(0).text_size(12).text_color(tool.status === 'running' ? t.foreground : t.muted).truncate().child(tool.label || tool.name))
            .child(div().px(5).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(tool.status === 'error' ? t.blocked : tool.status === 'running' ? t.working : t.muted)
              .child(TOOL_STATUS_LABEL[tool.status] || '完成')))
        }
        trace.child(trail)
      }
    }
    if (reply.thinking) {
      const open = view.expandedThinking.has(index)
      trace.child(disclosureAction(`chat-thinking-${index}`, open ? '收起 Thinking 推理过程' : (reply.incomplete ? '正在思考 · 查看 Thinking' : '查看 Thinking 推理过程'), t, cx => {
        if (open) view.expandedThinking.delete(index); else view.expandedThinking.add(index)
        cx.notify()
      }, { open, tone: reply.incomplete ? t.working : null }))
      if (open) {
        trace.child(v_flex().id(`chat-thinking-card-${index}`).p(10).pl(12).rounded(8)
          .bg(t.surface).border_1().border_color(t.border).border_l_2()
          .child(markdown(`chat-thinking-body-${index}`, reply.thinking, t)))
      }
    }
    item.child(trace)
  }

  if (reply.answer) {
    item.child(markdown(`chat-answer-${index}`, reply.answer, t))
  } else if (isRunning) {
    const activeTool = turn.tools?.findLast?.(tool => tool.status === 'running') || turn.tools?.find?.(tool => tool.status === 'running')
    const stepText = view.chatStatus || (activeTool ? `正在执行：${activeTool.label || activeTool.name}` : 'Agent 正在处理…')
    item.child(h_flex().id('chat-running-indicator').px(10).py(8).gap(8).items_center().rounded(8)
      .bg(t.surface).border_1().border_color(t.border)
      .child(div().size(7).rounded_full().bg(t.working))
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(stepText))
      .child(div().text_size(11).text_color(t.working).child(elapsedLabel || '<1 秒')))
  } else {
    item.child(div().text_size(13).text_color(t.muted).child('尚未收到回答。可以重试，或编辑这个问题。'))
  }
  return item
}

export function chatView(view, t) {
  const content = v_flex().min_w(0).gap(16)
  const isRemote = Boolean(view.project?.machine && view.project.machine !== 'local')
  if (isRemote) {
    content.child(h_flex().id('chat-remote-banner').px(10).py(8).gap(8).items_center().rounded(8)
      .bg(t.surface).border_1().border_color(t.border)
      .child(div().size(6).rounded_full().bg(t.working))
      .child(div().flex_1().min_w(0).text_size(12).line_height('18px').text_color(t.muted)
        .child('远程观察模式：可通过 HC 读取窗口资料；不会在本机执行远程项目的编码操作。')))
  }
  if (!view.turns.length) {
    content.child(v_flex().gap(6)
      .child(div().text_size(18).font_semibold().child('围绕重点，继续追问'))
      .child(div().text_size(13).line_height('21px').text_color(t.muted).child('项目 Agent 可以按需读取窗口与会话历史，先给结论，再解释证据。')))
    const starters = v_flex().id('chat-starter-cards').gap(8)
    for (const [index, [title, question]] of SUGGESTIONS.entries()) {
      starters.child(Button.new(`chat-suggestion-${index}`).accessibility_label(title)
        .w_full().p(11).rounded(8).bg(t.surface).border_1().border_color(t.border).shadow_2xs()
        .hover(s => s.bg(t.raised).border_color(t.accent))
        .on_click((_e, cx) => view.submitChat(cx, question))
        .child(h_flex().items_center().gap(10).w_full().min_w(0)
          .child(div().size(24).rounded(6).bg(t.raised).border_1().border_color(t.border).flex().items_center().justify_center()
            .text_size(12).font_semibold().text_color(t.accent).child(STARTER_ICONS[index] || '→'))
          .child(v_flex().flex_1().min_w(0).gap(2). items_start()
            .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(title))
            .child(div().w_full().text_size(11.5).text_color(t.muted).truncate().child(question)))
          .child(div().text_size(12).text_color(t.muted).child('→'))))
    }
    content.child(starters)
  } else {
    if (view.turns.length > 1) {
      content.child(disclosureAction('chat-history', view.historyOpen ? '收起之前的对话' : `展开之前 ${view.turns.length - 1} 次对话`, t, cx => {
        view.historyOpen = !view.historyOpen; cx.notify()
      }, { open: view.historyOpen }))
    }
    const start = view.historyOpen ? 0 : view.turns.length - 1
    for (let index = start; index < view.turns.length; index++) {
      if (index > start) content.child(div().w_full().h(1).bg(t.border))
      content.child(exchange(view, view.turns[index], index, t))
    }
  }
  if (view.chatStatus && (!view.chatRunning || view.chatError)) {
    content.child(div().text_size(12).line_height('19px').text_color(view.chatError ? t.blocked : t.muted).child(view.chatStatus))
  }

  const root = v_flex().flex_1().min_h(0).child(scroller('sulan-chat-scroll', content))
  const composer = v_flex().id('chat-composer-panel').flex_none().px(14).pt(10).pb(10).gap(8).bg(t.background).border_t(1).border_color(t.border)

  if (view.turns.length && !view.chatRunning && (view.turns.at(-1)?.answer === null || view.turns.at(-1)?.incomplete)) {
    composer.child(h_flex().gap(6).items_center()
      .child(action('chat-retry', view.agentJob ? '重连' : '重试', t, cx => view.runChatTurn(cx), { primary: true }))
      .child(action('chat-edit', '编辑问题', t, cx => view.editLastQuestion(cx), { disabled: Boolean(view.agentJob) })))
  }

  const modelPillLabel = `${shortModelName(view.chatModel)} · ${view.chatEffort || 'medium'}`
  const composerBorder = view.chatRunning ? t.working : view.typing ? t.accent : t.input
  const inputCard = v_flex().id('chat-composer-card').p(10).gap(8).rounded(9)
    .bg(t.surface).border_1().border_color(composerBorder).shadow_xs()
    .on_mouse_down('left', (_e, cx) => { view.input.focus(); cx.stop_propagation() })
    .child(Textarea.new(view.input).w_full().h(58).text_size(13).font_normal().text_color(t.foreground))
    .child(h_flex().items_center().justify_between().gap(6).pt(4).border_t(1).border_color(t.border)
      .child(Button.new('chat-settings').accessibility_label('模型设置').px(8).h(24).rounded(6)
        .bg(t.raised).border_1().border_color(t.border)
        .text_size(11).font_medium().text_color(t.muted)
        .hover(s => s.bg(t.hover).text_color(t.foreground).border_color(t.accent))
        .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => view.openSettings(cx))
        .child(h_flex().items_center().gap(5)
          .child(div().size(5).rounded_full().bg(t.accent))
          .child(modelPillLabel)))
      .child(h_flex().items_center().gap(6)
        .child(h_flex().id('chat-kbd-badge').px(6).h(22).items_center().rounded(5)
          .bg(t.raised).border_1().border_color(t.border)
          .text_size(10.5).text_color(t.muted).child('⌘↵'))
        .when(Boolean(view.chatRunning || view.agentJob), el => el.child(action('chat-stop', '停止', t, cx => view.stopChat(cx), { danger: true, disabled: Boolean(view.chatStopping) })))
        .child(action('chat-send', view.chatRunning ? '处理中…' : '发送', t, cx => view.submitChat(cx), {
          primary: true,
          disabled: view.chatRunning || Boolean(view.agentJob || view.agentResumePending || view.chatResetting) || !view.draft.trim(),
        }))))
  composer.child(inputCard)

  const modeDot = isRemote ? t.working : view.mode === 'demo' || view.agentToken ? t.done : t.blocked
  const modeText = isRemote
    ? '远程只读观察'
    : view.mode === 'demo'
      ? '演示模式'
      : view.agentToken
        ? '本机编码会话'
        : 'Agent 待配置'
  const statusStrip = h_flex().id('chat-status-strip').items_center().justify_between().gap(6)
    .child(h_flex().id('chat-mode-pill').h(22).px(8).gap(5).items_center().rounded_full()
      .bg(t.surface).border_1().border_color(t.border)
      .child(div().size(5).rounded_full().bg(modeDot))
      .child(div().text_size(11).text_color(t.muted).child(modeText)))
    .child(h_flex().items_center().gap(4)
      .when(Boolean(view.turns.length), el => el
        .child(action('chat-copy', '复制', t, cx => view.copyLastAnswer(cx), { subtle: true, disabled: !view.turns.some(turn => turn.answer) }))
        .child(action('chat-clear', view.chatResetting ? '清空中…' : view.confirmClear ? '确认清空' : '清空', t, cx => view.clearChat(cx), {
          danger: view.confirmClear,
          subtle: !view.confirmClear,
          disabled: Boolean(view.chatResetting),
        })))
      .when(view.confirmClear, el => el.child(action('chat-clear-cancel', '取消', t, cx => { view.confirmClear = false; cx.notify() }, { subtle: true }))))
  composer.child(statusStrip)

  return root.child(composer)
}

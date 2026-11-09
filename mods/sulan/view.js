// Native reading surfaces. Build only the selected tab; Markdown stays in one
// TextView per document instead of a native element for every word and line.
import { div } from 'gpui-kit'
import { h_flex, v_flex, TextView, Textarea, Button, Scrollbar } from 'gpui-base'
import { SUGGESTIONS, turnReply } from './chat.js'

export function action(id, title, t, onClick, { active = false, disabled = false, primary = false } = {}) {
  return Button.new(id).accessibility_label(title).disabled(disabled).px(10).h(30).rounded(6)
    .text_size(12).font_medium().text_color(disabled ? t.dim : primary ? t.solid_foreground : active ? t.foreground : t.muted)
    .bg(primary && !disabled ? t.solid : active ? t.selected : t.background)
    .hover(s => s.bg(primary && !disabled ? t.solid : t.hover))
    .on_click((_e, cx) => { if (!disabled) onClick(cx) }).child(title)
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
  const content = v_flex().w_full().min_w(0).gap(20)
  const brief = view.brief
  if (!brief.headline) {
    content.child(div().text_size(17).font_semibold().child('回到项目，先抓重点'))
      .child(div().text_size(13).line_height('21px').text_color(t.muted).child('更新速览，了解当前结论、工作进展，以及接下来最值得做的一件事。'))
      .child(action('summary-first-update', '整理项目重点', t, cx => view.refresh(cx, { forceAi: true }), { primary: true, disabled: view.busy() }))
  } else {
    content.child(div().text_size(18).line_height('27px').font_semibold().child(brief.headline))
    if (brief.attention) content.child(v_flex().p(12).gap(8).rounded(7).bg(t.raised)
      .child(div().text_size(13).font_semibold().text_color(t.working).child('需要你关注'))
      .child(markdown('brief-attention', brief.attention, t)))
    if (brief.markdown) content.child(markdown('brief-document', brief.markdown, t))
    if (brief.details) {
      content.child(div().h(1).w_full().bg(t.border))
        .child(action('summary-details', view.detailsOpen ? '收起完整内容' : '展开背景与完整内容', t, cx => { view.detailsOpen = !view.detailsOpen; cx.notify() }))
      if (view.detailsOpen) content.child(markdown('brief-details', brief.details, t))
    }
  }
  if (view.note) content.child(div().text_size(12).line_height('19px').text_color(view.isError ? t.blocked : t.muted).child(view.note))
  return scroller('sulan-summary-scroll', content)
}

function exchange(view, turn, index, t) {
  const reply = turnReply(turn)
  const item = v_flex().gap(14).min_w(0)
  item.child(v_flex().ml(24).p(12).gap(5).rounded(8).bg(t.raised)
    .child(div().text_size(11).text_color(t.muted).child('你'))
    .child(div().text_size(13).font_medium().line_height('21px').child(turn.question)))
  item.child(div().text_size(11).font_medium().text_color(t.muted).child('Sulan'))
  if (reply.answer) item.child(markdown(`chat-answer-${index}`, reply.answer, t))
  else if (view.chatRunning && index === view.turns.length - 1) item.child(div().text_size(13).text_color(t.muted).child('正在结合项目重点回答…'))
  else item.child(div().text_size(13).text_color(t.muted).child('尚未收到回答。可以重试，或编辑这个问题。'))
  if (reply.thinking) {
    const open = view.expandedThinking.has(index)
    item.child(action(`chat-thinking-${index}`, open ? '收起 Thinking' : '查看 Thinking', t, cx => {
      if (open) view.expandedThinking.delete(index); else view.expandedThinking.add(index)
      cx.notify()
    }))
    if (open) item.child(markdown(`chat-thinking-body-${index}`, reply.thinking, t))
  }
  return item
}

export function chatView(view, t) {
  const content = v_flex().min_w(0).gap(18)
  if (!view.turns.length) {
    content.child(div().text_size(18).font_semibold().child('围绕重点，继续追问'))
      .child(div().text_size(13).line_height('21px').text_color(t.muted).child('带着项目上下文回答，先给结论，再解释原因。'))
    for (const [index, [title, question]] of SUGGESTIONS.entries()) {
      content.child(action(`chat-suggestion-${index}`, title, t, cx => view.submitChat(cx, question)))
    }
  } else {
    if (view.turns.length > 1) content.child(action('chat-history', view.historyOpen ? '收起之前的对话' : `展开之前 ${view.turns.length - 1} 次对话`, t, cx => { view.historyOpen = !view.historyOpen; cx.notify() }))
    const start = view.historyOpen ? 0 : view.turns.length - 1
    for (let index = start; index < view.turns.length; index++) {
      if (index > start) content.child(div().w_full().h(1).bg(t.border))
      content.child(exchange(view, view.turns[index], index, t))
    }
  }
  if (view.chatStatus) content.child(div().text_size(12).line_height('19px').text_color(view.chatError ? t.blocked : t.muted).child(view.chatStatus))
  const root = v_flex().flex_1().min_h(0).child(scroller('sulan-chat-scroll', content))
  const composer = v_flex().flex_none().px(14).pt(10).pb(12).gap(8).border_t(1).border_color(t.border)
  if (view.turns.at(-1)?.answer === null && !view.chatRunning) composer.child(h_flex().gap(6)
    .child(action('chat-retry', '重试', t, cx => view.runChatTurn(cx)))
    .child(action('chat-edit', '编辑问题', t, cx => view.editLastQuestion(cx))))
  const input = v_flex().p(10).gap(6).rounded(8).bg(t.surface).border_1().border_color(view.typing ? t.accent : t.input)
    .on_mouse_down('left', (_e, cx) => { view.input.focus(); cx.stop_propagation() })
    .child(Textarea.new(view.input).w_full().h(58).text_size(13).font_normal().text_color(t.foreground))
    .child(h_flex().items_center().justify_between()
      .child(div().text_size(11).text_color(t.muted).child('Ctrl / ⌘ + Enter 发送'))
      .child(action('chat-send', view.chatRunning ? '回答中…' : '发送', t, cx => view.submitChat(cx), { primary: true, disabled: view.chatRunning || !view.draft.trim() })))
  composer.child(input)
  composer.child(h_flex().items_center().gap(5)
    .child(action('chat-settings', '模型设置', t, cx => view.openSettings(cx)))
    .child(div().flex_1())
    .when(Boolean(view.turns.length), el => el.child(action('chat-copy', '复制', t, cx => view.copyLastAnswer(cx), { disabled: !view.turns.some(turn => turn.answer) }))
      .child(action('chat-clear', view.confirmClear ? '确认清空' : '清空', t, cx => view.clearChat(cx))))
    .when(view.confirmClear, el => el.child(action('chat-clear-cancel', '取消', t, cx => { view.confirmClear = false; cx.notify() }))))
  return root.child(composer)
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './native-host.js'
import { prepareBrief } from '../mods/sulan/brief.js'
import { parseSummary } from '../mods/sulan/summary.js'
import { activeProject, gatherProjectSnapshot } from '../mods/sulan/context.js'
import { summarySystemPrompt, sideChatPrompt } from '../mods/sulan/chat.js'

for (const [key, tab] of [['1', 'summary'], ['3', 'chat']]) {
  test(`switching to ${tab} builds only its visible content`, async () => {
    const { mod, cx, metrics } = await createHost()
    const built = { summary: 0, chat: 0, pulse: 0 }
    for (const [name, method] of [['summary', 'renderSectionCard'], ['summary', 'renderSummaryContent'], ['chat', 'renderChatColumn'], ['chat', 'renderChatContent'], ['pulse', 'renderPulseColumn']]) {
      if (!mod[method]) continue
      const original = mod[method].bind(mod)
      mod[method] = (...args) => { built[name]++; return original(...args) }
    }
    metrics.elements = 0
    mod.handleKey({ key }, cx)
    mod.render(cx)
    console.log(`${tab}: ${metrics.elements} native elements; content builds: ${JSON.stringify(built)}`)
    assert.equal(built.pulse, 0, 'switching must not build the removed terminal/Git panel')
    assert.ok(built[tab] > 0, 'the selected tab must actually build its content')
    if (tab === 'summary') assert.equal(built.chat, 0, 'summary must not build the hidden chat')
    else assert.equal(built.summary, 0, 'chat must not rebuild hidden summary sections and diagrams')
    assert.equal(metrics.exec, 0, 'tab switching must not start programs')
    mod.close()
  })
}

const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.nodes ?? []).flatMap(walk)]

test('sidebar has two tabs; rich answers and a composer outside the scrolling transcript', async () => {
  const { mod, cx } = await createHost()
  mod.selectTab('chat', cx)
  const root = mod.render(cx), nodes = walk(root)
  assert.ok(nodes.some(n => n.id === 'sulan-tab-summary'))
  assert.ok(nodes.some(n => n.id === 'sulan-tab-chat'))
  assert.ok(!nodes.some(n => n.id === 'sulan-tab-pulse'))
  assert.ok(nodes.some(n => n.kind === 'markdown' && n.markdown.includes('**先验证')))
  const transcript = nodes.find(n => n.styles.id?.[0] === 'sulan-chat-scroll')
  assert.ok(transcript)
  assert.ok(!walk(transcript).some(n => n.kind === 'textarea'), 'composer must not scroll away with long answers')
  assert.ok(nodes.some(n => n.kind === 'textarea'))
  mod.close()
})

test('switching preserves draft and hides history until explicitly opened', async () => {
  const { mod, cx, input } = await createHost()
  mod.draft = '保留这条尚未发送的追问'
  input.set_value(mod.draft)
  mod.turns.unshift({ question: 'OLDER QUESTION', answer: 'OLDER ANSWER' })
  mod.selectTab('chat', cx)
  assert.ok(!walk(mod.render(cx)).some(n => n.markdown === 'OLDER ANSWER'))
  mod.selectTab('summary', cx); mod.render(cx)
  mod.selectTab('chat', cx)
  assert.equal(input.value(), '保留这条尚未发送的追问')
  mod.historyOpen = true
  assert.ok(walk(mod.render(cx)).some(n => n.markdown === 'OLDER ANSWER'))
  mod.close()
})

test('brief promotes decisions, renders bold/code, and bounds old verbose summaries', () => {
  const parsed = parseSummary('TLDR: 核心功能已完成\n## now\n- [done] **已完成**：支持 `TextView`\n- [fail] 尚未验证\n## out\n- **结论**：先抓重点\n## next\n- [ask] 默认采用短回答吗？\n- 验证窄栏\n## terms\n- **旧术语**：完整背景')
  const brief = prepareBrief(parsed)
  assert.match(brief.attention, /默认采用短回答吗/)
  assert.match(brief.markdown, /\*\*已完成\*\*.*`TextView`/)
  assert.match(brief.markdown, /### 关键结论/)
  assert.doesNotMatch(brief.markdown, /旧术语/)
  assert.match(brief.details, /旧术语/)
})

test('terminal excerpts are read concurrently, no Git process is invoked', async () => {
  const spacesList = [{ id: 's', active: true, name: 'Project', folder: '/project', tabs: [{ id: 'tab' }] }]
  const agentsList = ['a', 'b', 'c'].map(address => ({ address, space: 's', tab: 'tab', title: '当前工作', status: 'working' }))
  let called = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const request = gatherProjectSnapshot({ spacesList, panesList: [], agentsList, hcFn: async () => {
    called++; await gate; return { code: 0, stdout: '任务进展' }
  }, execFn() { assert.fail('Git/process execution is forbidden') } })
  assert.equal(called, 3, 'all independent reads must start before any is released')
  release()
  const snapshot = await request
  assert.equal(snapshot.excerpts.length, 3)
  assert.equal(snapshot.git, undefined)
  assert.doesNotMatch(snapshot.contextText, /Git Repository|Changed files/)
  assert.match(summarySystemPrompt(), /全文控制在 350 到 550/)
  assert.match(sideChatPrompt([{ question: '进展如何？', answer: null }], '', ''), /Markdown/)
})

test('an expired summary request releases the UI and cannot overwrite a later view', async () => {
  let release
  const delayed = new Promise(resolve => { release = resolve })
  const { mod, cx, timers } = await createHost({ props: { mode: 'live' },
    spaces: [{ id: 's', active: true, name: 'Project', folder: '/project', tabs: [] }],
    completeModel: async () => delayed })
  await new Promise(setImmediate)
  mod.refresh(cx, { forceAi: true })
  await new Promise(setImmediate)
  assert.equal(mod.summarizing, true)
  const deadline = timers.filter(timer => timer.kind === 'after' && timer.ms === 60000).at(-1)
  deadline.callback(cx)
  assert.equal(mod.busy(), false)
  assert.equal(mod.paused, true)
  const preserved = mod.summary
  release('TLDR: LATE ANSWER\n## now\n- This result must be ignored')
  await new Promise(setImmediate)
  assert.equal(mod.summary, preserved)
  assert.doesNotMatch(mod.summary, /LATE ANSWER/)
  mod.close()
})

test('chat typing cannot trigger global sidebar shortcuts even before focus notification', async () => {
  const { mod, cx } = await createHost()
  mod.selectTab('chat', cx)
  mod.typing = false
  const originalMode = mod.mode, generation = mod.generation
  for (const key of ['d', 'r', 'b', '1', '2']) mod.handleKey({ key, modifiers: {} }, cx)
  assert.equal(mod.mode, originalMode)
  assert.equal(mod.tab, 'chat')
  assert.equal(mod.generation, generation)
  mod.close()
})

test('ordinary typing does not reconstruct the outer sidebar for every character', async () => {
  const { mod, cx, input } = await createHost()
  let invalidations = 0
  cx.notify = () => { invalidations++ }
  for (const value of ['先', '先看', '先看什么']) {
    input.set_value(value)
    input.callbacks.change({}, cx)
  }
  assert.equal(mod.draft, '先看什么')
  assert.equal(invalidations, 1, 'only the Send button empty/nonempty transition needs an outer render')
  mod.close()
})

test('project identity stays stable when sidebar focus moves between terminal folders', () => {
  const spacesList = [{ id: 's', name: 'Project', active: true, folder: '/project', tabs: [{ id: 't' }] }]
  const panesList = [{ pane: 'a', tab: 't', cwd: '/project/one' }, { pane: 'b', tab: 't', cwd: '/project/two' }]
  assert.equal(activeProject(spacesList, panesList, { pane: 'a' }).folder, '/project')
  assert.equal(activeProject(spacesList, panesList, { pane: 'b' }).folder, '/project')
})

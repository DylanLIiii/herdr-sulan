import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cells, truncate, width } from '../mods/sulan/text.js'
import { inlineSpans, parseSummary, progressOf } from '../mods/sulan/summary.js'
import { flowNodes, renderFlow } from '../mods/sulan/diagram.js'
import {
  cleanTurns,
  replyFields,
  splitReply,
  sideChatPrompt,
  summarySystemPrompt,
  summaryUserPrompt,
} from '../mods/sulan/chat.js'
import {
  activeProject,
  projectAgents,
  gatherProjectSnapshot,
  buildInstantSummary,
} from '../mods/sulan/context.js'
import { completeModel } from '../mods/sulan/llm.js'
import { DEMO_PROJECTS } from '../mods/sulan/demo.js'
import { installSulan } from '../scripts/install-layout.js'

const FLOW = `flowchart TD
  a["✓ 读原仓库"] --> b["✓ 定方案"]
  b --> c["◐ 写代码"]
  c --> d["○ 验证"]
  c -->|失败| e["✗ 回退"]`

test('width and cells align wide CJK characters properly', () => {
  assert.equal(width('ab'), 2)
  assert.equal(width('速览'), 4)
  assert.deepEqual(cells('a速'), ['a', '速', ''])
  assert.equal(truncate('速览项目状态汇总测试', 7), '速览项…')
  assert.ok(width(truncate('速览项目状态汇总测试', 7)) <= 7)
})

test('parseSummary parses all 6 sections, status tags, and flow diagram', () => {
  const sample = `TLDR: Sulan 右侧边栏已就绪
## why
- 项目目标
## did
- 已完成的工作
## out
- 关键结论
## now
- [done] 已完成
- [wip] 进行中
- [fail] 待关注
## next
- [ask] 需要决定的事？
## terms
- **速览**：项目重点
## flow
${FLOW}`
  const parsed = parseSummary(sample)
  assert.ok(parsed)
  assert.match(parsed.tldr, /Sulan 右侧边栏已就绪/)
  assert.deepEqual(
    parsed.sections.map((s) => s.id),
    ['why', 'did', 'out', 'now', 'next', 'terms'],
  )
  const nowItems = parsed.sections.find((s) => s.id === 'now').items
  assert.equal(nowItems[0].status, 'done')
  assert.equal(nowItems[1].status, 'wip')
  assert.equal(nowItems[2].status, 'fail')

  const nextItems = parsed.sections.find((s) => s.id === 'next').items
  assert.equal(nextItems[0].status, 'ask')

  const p = progressOf(parsed, flowNodes)
  assert.deepEqual(p, { total: 5, done: 2, wip: 1, fail: 1, todo: 1, pct: 40 })
  assert.deepEqual(inlineSpans('修改 `mods/sulan/main.js` 的 **核心视图**'), [
    { text: '修改 ' },
    { text: 'mods/sulan/main.js', code: true },
    { text: ' 的 ' },
    { text: '核心视图', bold: true },
  ])
})

test('renderFlow draws aligned CJK box art and falls back to list when narrow', () => {
  const drawn = renderFlow(FLOW, 44)
  assert.equal(drawn.kind, 'art')
  const lines = drawn.art.split('\n')
  for (let r = 0; r < lines.length; r++) {
    if (!lines[r].startsWith('╭')) continue
    const right = cells(lines[r]).indexOf('╮')
    const label = cells(lines[r + 1])
    assert.match(label[right], /[│├┤]/, lines[r + 1])
  }
  const tones = new Set(drawn.rows.flat().map((r) => r.tone))
  for (const t of ['done', 'wip', 'todo', 'fail', 'edge', 'text']) {
    assert.ok(tones.has(t), `missing tone ${t}`)
  }
  assert.equal(renderFlow(FLOW, 14).kind, 'list')
})

test('splitReply and replyFields separate <think> tags without counting thinking against answer cap', () => {
  const raw = '<think>First check agent t14 status and git diff.</think>\n\n先处理 `t14` 的网关超时确认。'
  const parts = splitReply(raw)
  assert.equal(parts.kind, 'tagged')
  assert.match(parts.thinking, /First check agent t14/)
  assert.equal(parts.answer, '先处理 `t14` 的网关超时确认。')

  // Inline code mentioning <think> is not split
  const inlineCode = '代码里的 `<think>` 标签不会被误折叠。'
  assert.equal(splitReply(inlineCode).thinking, '')
  assert.equal(splitReply(inlineCode).answer, inlineCode)

  const fields = replyFields(raw, 100)
  assert.equal(fields.answer, '先处理 `t14` 的网关超时确认。')
  assert.match(fields.thinking, /First check/)
})

test('project context uses terminal evidence without Git or process execution', async () => {
  const spacesList = [
    {
      id: 'sp-1',
      name: 'sulan',
      named: true,
      folder: '/mnt/workspace/heng.li/projects/sulan',
      machine: null,
      branch: 'main',
      active: true,
      status: 'working',
      tabs: [
        { id: 'tb-1', name: 'main', active: true, status: 'working' },
        { id: 'tb-2', name: 'review', active: false, status: 'blocked' },
      ],
    },
  ]
  const panesList = [
    {
      pane: 'p1',
      terminal: 't8',
      tab: 'tb-1',
      title: 'Implementing flow diagram',
      cwd: '/mnt/workspace/heng.li/projects/sulan',
      branch: 'main',
      status: 'working',
      program: { name: 'Pi', agent: true },
      focused: true,
    },
    {
      pane: 'p2',
      terminal: 't14',
      tab: 'tb-2',
      title: 'Waiting for user confirmation',
      cwd: '/mnt/workspace/heng.li/projects/sulan',
      branch: 'main',
      status: 'blocked',
      program: { name: 'Claude Code', agent: true },
      focused: false,
    },
  ]
  const agentsList = [
    {
      address: 't8',
      pane: 'p1',
      space: 'sp-1',
      tab: 'tb-1',
      tab_name: 'main',
      status: 'working',
      title: 'Implementing flow diagram',
      program: { name: 'Pi', agent: true },
      pinned: false,
      focused: true,
    },
    {
      address: 't14',
      pane: 'p2',
      space: 'sp-1',
      tab: 'tb-2',
      tab_name: 'review',
      status: 'blocked',
      title: 'Waiting for user confirmation',
      program: { name: 'Claude Code', agent: true },
      pinned: false,
      focused: false,
    },
  ]
  const terminalsList = [
    { address: 't8', state: 'live', turn: 12, cwd: '/mnt/workspace/heng.li/projects/sulan' },
    { address: 't14', state: 'live', turn: 4, cwd: '/mnt/workspace/heng.li/projects/sulan' },
    { address: 't19', state: 'live', parent: 't8', name: 'unit-runner', status: 'working', turn: 2 },
  ]

  const execFn = async (_cmd, args) => {
    const joined = args.join(' ')
    if (joined.includes('rev-parse --show-toplevel')) {
      return { code: 0, stdout: '/mnt/workspace/heng.li/projects/sulan\n', stderr: '' }
    }
    if (joined.includes('status --porcelain=v2')) {
      return {
        code: 0,
        stdout: '# branch.head main\n# branch.ab +1 -0\n1 .M N... 100644 100644 100644 abc def hooks/register.js\n',
        stderr: '',
      }
    }
    if (joined.includes('log --oneline')) {
      return { code: 0, stdout: 'ab89f32 feat: fold side chat thinking\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }

  const hcFn = async (args) => {
    if (args[0] === 'read') return { code: 0, stdout: 'Running unit tests...\nAll 6 tests passed.\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }

  const snap = await gatherProjectSnapshot({
    spacesList,
    panesList,
    focusedInfo: { space: 'sp-1', tab: 'tb-1', pane: 'p1', terminal: 't8' },
    agentsList,
    terminalsList,
    execFn,
    hcFn,
  })

  assert.equal(snap.project.name, 'sulan')
  assert.equal(snap.git, undefined)
  assert.doesNotMatch(snap.contextText, /Git Repository|Changed files|Recent commits/)
  // Blocked agent t14 is sorted first
  assert.equal(snap.agents[0].address, 't14')
  assert.equal(snap.agents[1].address, 't8')
  assert.equal(snap.agents[1].subagents.length, 1)
  assert.equal(snap.agents[1].subagents[0].address, 't19')

  const instant = buildInstantSummary(snap)
  const parsed = parseSummary(instant)
  assert.ok(parsed)
  assert.match(parsed.tldr, /Implementing flow diagram/)
  assert.ok(parsed.sections.some((s) => s.id === 'now'))
  assert.ok(parsed.sections.some((s) => s.id === 'next'))
  assert.equal(parsed.flow, null)
  assert.doesNotMatch(instant, /Git|未提交|分支|diff/)
  assert.ok(!parsed.sections.some(s => s.items.some(i => i.status === 'ask')), 'blocked alone must not invent a decision')
})

test('completeModel supports both Anthropic /v1/messages and OpenAI /v1/chat/completions shapes', async () => {
  const anthropicReply = await completeModel({
    endpoint: 'http://127.0.0.1:3425/v1/messages',
    fetchFn: async (_url, opts) => {
      const body = JSON.parse(opts.body)
      assert.equal(opts.headers['x-api-key'], 'magpie')
      assert.equal(body.model, 'auto/deepseek-v4.1-flash')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: 'Checking git state' },
            { type: 'text', text: 'TLDR: 已完成验证\n## why\n- 测试' },
          ],
        }),
      }
    },
    prompt: summaryUserPrompt({ previousSummary: '', contextText: 'ctx' }),
    system: summarySystemPrompt(),
  })
  assert.match(anthropicReply, /<think>Checking git state<\/think>/)
  assert.match(anthropicReply, /TLDR: 已完成验证/)

  const openaiReply = await completeModel({
    endpoint: 'http://127.0.0.1:3425/v1/chat/completions',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { reasoning: 'Plan step', content: '最终回答内容' } }],
      }),
    }),
    prompt: sideChatPrompt([{ question: '进度如何？', answer: null }], 'TLDR: ok', 'ctx'),
  })
  assert.match(openaiReply, /<think>Plan step<\/think>/)
  assert.match(openaiReply, /最终回答内容/)
})

test('installSulan writes layouts and mods without overwriting existing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-sulan-install-'))
  try {
    const res = await installSulan({ home: dir, name: 'sulan-custom', endpoint: 'http://127.0.0.1:3425/v1/messages' })
    const layoutJson = JSON.parse(await readFile(res.layoutPath, 'utf8'))
    assert.equal(layoutJson.preview, 'layouts/sulan-custom.svg')
    const workNode = layoutJson.children.find((n) => n.id === 'work')
    const tabsNode = workNode.children.find((n) => n.id === 'tabs')
    assert.equal(tabsNode.content.mod, 'sulan-custom')
    assert.equal(tabsNode.content.props.role, 'tabs')
    await assert.rejects(() => installSulan({ home: dir, name: 'sulan-custom' }), /Already exists/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Explicit demo snapshots and summaries for previewing Herdr Sulan without
// touching real project state. Clearly labeled as synthetic preview data.

export const DEMO_PROJECTS = [
  {
    id: 'demo-sulan',
    project: {
      id: 'demo-sulan',
      name: 'herdr-sulan',
      named: true,
      folder: '/root/projects/herdr-sulan',
      machine: null,
      branch: 'feat/project-catchup',
      status: 'working',
      tabs: [
        { id: 'tb-1', name: 'sulan-mod', active: true, status: 'working' },
        { id: 'tb-2', name: 'layout-verify', active: false, status: 'done' },
        { id: 'tb-3', name: 'api-bridge', active: false, status: 'blocked' },
      ],
    },
    git: {
      root: '/root/projects/herdr-sulan',
      name: 'herdr-sulan',
      branch: 'feat/project-catchup',
      head: 'ab89f32',
      ahead: 2,
      behind: 0,
      totalFiles: 4,
      files: [
        { status: 'M', path: 'mods/sulan/main.js' },
        { status: 'M', path: 'mods/sulan/diagram.js' },
        { status: 'A', path: 'layouts/sulan.json' },
        { status: 'M', path: 'test/sulan.test.js' },
      ],
      commits: [
        { hash: 'ab89f32', subject: 'feat: fold side chat thinking and show accurate request states' },
        { hash: '41edad9', subject: 'feat: add terms section for concepts, acronyms and shorthand' },
        { hash: '77446d9', subject: 'sulan 速览: live session summary pane with icons and flow diagram' },
      ],
      worktrees: [
        { branch: 'feat/project-catchup', path: '/root/projects/herdr-sulan' },
        { branch: 'main', path: '/mnt/workspace/heng.li/projects/sulan' },
      ],
    },
    agents: [
      {
        address: 't14',
        pane: 'p3',
        tab: 'tb-3',
        tabName: 'api-bridge',
        name: 'Confirm Magpie endpoint fallback behavior',
        programName: 'Claude Code',
        status: 'blocked',
        cwd: '/root/projects/herdr-sulan',
        branch: 'feat/project-catchup',
        turn: 9,
        pinned: true,
        focused: false,
        subagents: [],
      },
      {
        address: 't8',
        pane: 'p1',
        tab: 'tb-1',
        tabName: 'sulan-mod',
        name: 'Rendering GPUI flow diagram & dual-column catch-up page',
        programName: 'Pi',
        status: 'working',
        cwd: '/root/projects/herdr-sulan',
        branch: 'feat/project-catchup',
        turn: 14,
        pinned: false,
        focused: true,
        subagents: [
          {
            address: 't19',
            name: 'check-gpui-types',
            programName: 'Pi',
            status: 'working',
            turn: 3,
            isSubagent: true,
          },
        ],
      },
      {
        address: 't11',
        pane: 'p2',
        tab: 'tb-2',
        tabName: 'layout-verify',
        name: 'herdr-app check passed on mods/sulan',
        programName: 'Codex',
        status: 'done',
        cwd: '/root/projects/herdr-sulan',
        branch: 'feat/project-catchup',
        turn: 6,
        pinned: false,
        focused: false,
        subagents: [],
      },
    ],
    summary: `TLDR: Sulan 右侧边栏已就绪，正验证流程图并等待网关确认
## why
- 将 \`sulan\` 扩展为 Herdr 右侧常驻速览与侧聊栏
## did
- 汇总 Space 的 \`git\`、\`agents()\` 与 \`hc read\`
- 实现 \`panel-body\` 右侧栏停靠、流程图与侧聊
## out
- 双层速览：秒出实时快照，后台滚动融合 AI 摘要
## now
- [done] \`t11\`（Codex）已通过 \`herdr-app check\`
- [wip] \`t8\`（Pi）完善侧栏布局，含子代理 \`t19\`
- [fail] \`t14\`（Claude Code）待确认网关超时策略
## next
- [ask] \`t14\`：网关 15s 超时是否自动锁定本地快照？
## terms
- **双层速览**：先秒出 Git/终端快照，再异步提炼结论
- **Space 归档**：按项目独立保存速览与侧聊，互不串台
## flow
flowchart TD
  a["✓ 采集项目状态"] --> b["◐ 右侧栏与侧聊"]
  b -->|t14 待确认| c["✗ 网关超时策略"]
  b --> d["○ 单测与真机验收"]
- 点击“终端”标签中的 Agent 卡片可直接跳回终端`,
    turns: [
      {
        question: '现在哪个终端最需要我先处理？',
        answer:
          '<think>先检查当前 Space 中各终端的 status：t14 处于 blocked，t8 处于 working，t11 处于 done。</think>最需要先处理的是标签页 `api-bridge` 中的终端 **`t14`（Claude Code）**，它目前处于 **Needs you (`blocked`)** 状态。\n\n它正在等你确认：当本地 `127.0.0.1:3425` 网关超过 15 秒未响应时，是否自动切换为仅使用本地 Git + Agent 实时快照。你可以直接点击右侧脉冲区的 `t14` 卡片跳过去回复。',
        thinking: '先检查当前 Space 中各终端的 status：t14 处于 blocked，t8 处于 working，t11 处于 done。',
        thinkingKind: 'tagged',
      },
      {
        question: '当前未提交的 4 个文件主要改了什么？',
        answer:
          '当前分支 `feat/project-catchup` 有 4 个未提交文件：\n- `mods/sulan/main.js`：GPUI 视图主入口，含顶栏导航、全屏双栏模式、窄侧栏模式和侧聊交互\n- `mods/sulan/diagram.js`：Mermaid 彩色字符画流程图渲染与窄屏列表回退\n- `layouts/sulan.json`：包含 `Workspace` 与 `速览 · Sulan` 切换栈的完整窗口布局\n- `test/sulan.test.js`：覆盖摘要解析、宽字符对齐、上下文汇总与 GPUI 生命周期的测试',
      },
    ],
  },
]

// Gathers live project context from Herdr's space/tab/agent/terminal model and git,
// and builds a deterministic fallback summary when no LLM endpoint is configured.

const GIT_READ = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'diff.autoRefreshIndex=false']
const STATUS_RANK = { blocked: 4, done: 3, working: 2, idle: 1 }

// Resolves the active space and its primary folder/machine
export function activeProject(spacesList = [], panesList = [], focusedInfo = null) {
  const space = spacesList.find((s) => s.active) ?? spacesList[0] ?? null
  if (!space) return null
  const tabIds = new Set((space.tabs ?? []).map((t) => t.id))
  const spacePanes = panesList.filter((p) => tabIds.has(p.tab))
  const focusedPane = focusedInfo?.pane ? spacePanes.find((p) => p.pane === focusedInfo.pane) : null
  const firstTermPane = spacePanes.find((p) => p.terminal && p.cwd)
  const cwd = focusedPane?.cwd || firstTermPane?.cwd || focusedInfo?.cwd || space.folder || ''
  const on = space.machine ?? null
  const branch = focusedPane?.branch || firstTermPane?.branch || space.branch || null
  return {
    id: space.id,
    name: space.name || (cwd ? cwd.split('/').pop() : 'Project'),
    named: Boolean(space.named),
    folder: cwd,
    machine: on,
    branch,
    status: space.status ?? null,
    tabs: space.tabs ?? [],
    panes: spacePanes,
  }
}

// Collects all agents and sub-agents belonging to the space
export function projectAgents(project, agentsList = [], terminalsList = []) {
  if (!project) return []
  const tabIds = new Set(project.tabs.map((t) => t.id))
  const tabNames = new Map(project.tabs.map((t) => [t.id, t.name]))
  const mainAgents = agentsList.filter((a) => a.space === project.id || tabIds.has(a.tab))
  const liveTerms = new Map(terminalsList.filter((t) => t.state === 'live').map((t) => [t.address, t]))

  const items = []
  const seen = new Set()

  const collectKids = (parentAddr, depth = 1) => {
    const kids = terminalsList.filter((t) => t.parent === parentAddr && t.state === 'live')
    const out = []
    for (const k of kids) {
      if (seen.has(k.address)) continue
      seen.add(k.address)
      const rawStatus = typeof k.status === 'string' ? k.status : k.status?.state ?? 'idle'
      const status = rawStatus === 'error' ? 'blocked' : rawStatus === 'done' ? 'idle' : rawStatus
      out.push({
        address: k.address,
        pane: null,
        tab: null,
        tabName: 'sub-agent',
        name: k.name || k.template || k.program?.name || k.address,
        programName: k.program?.name || k.agent || 'agent',
        status,
        cwd: k.cwd || project.folder,
        turn: k.turn ?? 0,
        parent: parentAddr,
        depth,
        isSubagent: true,
      })
      out.push(...collectKids(k.address, depth + 1))
    }
    return out
  }

  for (const a of mainAgents) {
    if (seen.has(a.address)) continue
    seen.add(a.address)
    const term = liveTerms.get(a.address)
    const pane = project.panes.find((p) => p.pane === a.pane || p.terminal === a.address)
    items.push({
      address: a.address,
      pane: a.pane || pane?.pane || null,
      tab: a.tab,
      tabName: a.tab_name || tabNames.get(a.tab) || '1',
      name: a.title || a.program?.name || a.app || a.address,
      programName: a.program?.name || a.app || 'agent',
      status: a.status || 'idle',
      cwd: pane?.cwd || term?.cwd || project.folder,
      branch: pane?.branch || project.branch,
      turn: term?.turn ?? 0,
      pinned: Boolean(a.pinned),
      focused: Boolean(a.focused),
      parent: null,
      depth: 0,
      isSubagent: false,
      subagents: collectKids(a.address, 1),
    })
  }

  // Also include non-agent terminal panes so shell tabs are visible
  for (const p of project.panes) {
    if (!p.terminal || seen.has(p.terminal)) continue
    seen.add(p.terminal)
    const term = liveTerms.get(p.terminal)
    items.push({
      address: p.terminal,
      pane: p.pane,
      tab: p.tab,
      tabName: tabNames.get(p.tab) || '1',
      name: p.title || p.program?.name || p.terminal,
      programName: p.program?.name || 'shell',
      status: p.status || 'idle',
      cwd: p.cwd || term?.cwd || project.folder,
      branch: p.branch || project.branch,
      turn: term?.turn ?? 0,
      pinned: false,
      focused: Boolean(p.focused),
      parent: null,
      depth: 0,
      isSubagent: false,
      isShell: Boolean(p.program?.shell || !p.program?.agent),
      subagents: collectKids(p.terminal, 1),
    })
  }

  return items.sort((x, y) => {
    if (x.pinned !== y.pinned) return x.pinned ? -1 : 1
    const rx = STATUS_RANK[x.status] ?? 0
    const ry = STATUS_RANK[y.status] ?? 0
    return ry - rx
  })
}

// Fingerprint of current project state so we only re-summarize when meaningful work happens
export function contextSignature(snapshot) {
  if (!snapshot?.project) return ''
  const p = snapshot.project
  const g = snapshot.git
  const agentSig = (snapshot.agents ?? [])
    .map((a) => `${a.address}:${a.status}:${a.turn}:${(a.subagents ?? []).map((s) => `${s.address}:${s.status}`).join(',')}`)
    .join('|')
  const gitSig = g
    ? `${g.branch}:${g.head}:${g.ahead}:${g.behind}:${(g.files ?? []).map((f) => `${f.status}:${f.path}`).join(',')}`
    : 'nogit'
  return `${p.id}::${p.folder}::${gitSig}::${agentSig}`
}

// Gathers git state and recent terminal screen excerpts
export async function gatherProjectSnapshot({ spacesList, panesList, focusedInfo, agentsList, terminalsList, execFn, hcFn }) {
  const project = activeProject(spacesList, panesList, focusedInfo)
  if (!project) return null
  const agents = projectAgents(project, agentsList, terminalsList)
  const git = await readGitInfo(project.folder, project.machine, execFn)
  if (git?.branch && !project.branch) project.branch = git.branch

  // Read tail excerpts of up to 4 most active terminals in this space
  const excerpts = []
  if (hcFn) {
    const candidates = agents
      .filter((a) => !a.isShell || agents.length <= 2)
      .slice(0, 4)
    for (const a of candidates) {
      try {
        const r = await hcFn(['read', a.address, '--lines', '28'])
        if (r && r.code === 0 && r.stdout && r.stdout.trim()) {
          const cleaned = cleanScreenExcerpt(r.stdout)
          if (cleaned) excerpts.push({ address: a.address, name: a.name, tabName: a.tabName, status: a.status, text: cleaned })
        }
      } catch {
        // Ignore individual terminal read failures
      }
    }
  }

  const contextText = formatSnapshotForPrompt({ project, git, agents, excerpts })
  const signature = contextSignature({ project, git, agents })
  return {
    project,
    git,
    agents,
    excerpts,
    contextText,
    signature,
    capturedAt: Date.now(),
  }
}

export function cleanScreenExcerpt(raw) {
  const lines = String(raw ?? '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^\[hc\] only its screen:/i.test(l.trim()))
  return lines.slice(-22).join('\n').slice(-1800)
}

export async function readGitInfo(cwd, on, execFn) {
  if (!cwd || !execFn) return null
  try {
    const top = await execFn('git', ['rev-parse', '--show-toplevel'], { cwd, on })
    if (!top || top.code !== 0) return null
    const root = top.stdout.trim()
    const runGit = (args) => execFn('git', [...GIT_READ, ...args], { cwd: root, on })

    const [statusRes, logRes, statRes, worktreeRes] = await Promise.all([
      runGit(['status', '--porcelain=v2', '--branch']),
      runGit(['log', '--oneline', '-n', '6']),
      runGit(['diff', '--stat', 'HEAD']).catch(() => ({ code: 1, stdout: '' })),
      runGit(['worktree', 'list', '--porcelain']).catch(() => ({ code: 1, stdout: '' })),
    ])

    let branch = null
    let head = null
    let ahead = 0
    let behind = 0
    const files = []

    if (statusRes?.code === 0) {
      for (const line of statusRes.stdout.split('\n')) {
        if (!line) continue
        if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
        else if (line.startsWith('# branch.oid ')) head = line.slice(13, 20).trim()
        else if (line.startsWith('# branch.ab ')) {
          const [a, b] = line.slice(12).trim().split(/\s+/)
          ahead = Math.abs(parseInt(a, 10)) || 0
          behind = Math.abs(parseInt(b, 10)) || 0
        } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
          const parts = line.split(' ')
          const xy = parts[1] || 'M.'
          const path = parts.slice(8).join(' ').split('\t')[0]
          const st = xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : 'M'
          files.push({ status: st, path })
        } else if (line.startsWith('u ')) {
          const path = line.split(' ').slice(10).join(' ')
          files.push({ status: 'U', path })
        } else if (line.startsWith('? ')) {
          files.push({ status: 'A', path: line.slice(2).trim() })
        }
      }
    }

    const commits = logRes?.code === 0
      ? logRes.stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const sp = l.indexOf(' ')
            return sp > 0 ? { hash: l.slice(0, sp), subject: l.slice(sp + 1).trim() } : { hash: '', subject: l }
          })
      : []

    const worktrees = []
    if (worktreeRes?.code === 0) {
      for (const block of worktreeRes.stdout.split(/\n\n+/)) {
        const lines = block.split('\n')
        const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice(9)?.trim()
        if (!wtPath) continue
        const wtBranch = lines.find((l) => l.startsWith('branch '))?.slice(7)?.replace(/^refs\/heads\//, '')?.trim() || 'detached'
        worktrees.push({ path: wtPath, branch: wtBranch })
      }
    }

    return {
      root,
      name: root.split('/').pop() || root,
      branch: branch || 'HEAD',
      head: head || commits[0]?.hash || '',
      ahead,
      behind,
      files: files.slice(0, 40),
      totalFiles: files.length,
      commits,
      diffStat: statRes?.code === 0 ? statRes.stdout.trim().slice(0, 1500) : '',
      worktrees: worktrees.slice(0, 12),
    }
  } catch {
    return null
  }
}

export function formatSnapshotForPrompt({ project, git, agents, excerpts }) {
  const sections = []
  sections.push(
    `Project Space: ${project.name}` +
      (project.machine ? ` (machine: ${project.machine})` : ' (local machine)') +
      `\nFolder: ${project.folder || '(unknown)'}` +
      `\nTabs (${project.tabs.length}): ${project.tabs.map((t) => `${t.name}${t.active ? '*' : ''}${t.status ? ` [${t.status}]` : ''}`).join(', ') || 'none'}`,
  )

  if (git) {
    const fileLines = git.files.slice(0, 20).map((f) => `  ${f.status} ${f.path}`).join('\n') || '  (working tree clean)'
    const commitLines = git.commits.map((c) => `  ${c.hash} ${c.subject}`).join('\n') || '  (no commits)'
    const wtLines = git.worktrees.length > 1
      ? '\nWorktrees:\n' + git.worktrees.map((w) => `  ${w.branch} -> ${w.path}`).join('\n')
      : ''
    sections.push(
      `Git Repository: ${git.name} (branch: ${git.branch}, ahead ${git.ahead}, behind ${git.behind})\n` +
        `Changed files (${git.totalFiles}):\n${fileLines}\n` +
        (git.diffStat ? `Diff stat:\n${git.diffStat}\n` : '') +
        `Recent commits:\n${commitLines}` +
        wtLines,
    )
  } else {
    sections.push('Git Repository: (not in a git repository or git unavailable)')
  }

  if (agents?.length) {
    const agentLines = agents.map((a) => {
      const sub = a.subagents?.length
        ? ` | sub-agents: ${a.subagents.map((s) => `${s.address}(${s.name}:${s.status})`).join(', ')}`
        : ''
      return `  - [${a.status.toUpperCase()}] ${a.address} (${a.programName}) in tab "${a.tabName}" — title: "${a.name}" (turn ${a.turn})${sub}`
    })
    sections.push(`Terminals & Agents (${agents.length}):\n${agentLines.join('\n')}`)
  } else {
    sections.push('Terminals & Agents: (no active terminals in this space)')
  }

  if (excerpts?.length) {
    const exLines = excerpts.map(
      (ex) => `--- Terminal ${ex.address} (${ex.name} · tab "${ex.tabName}" · ${ex.status}) ---\n${ex.text}`,
    )
    sections.push(`Recent Terminal Output Excerpts:\n${exLines.join('\n\n')}`)
  }

  return sections.join('\n\n')
}

// Builds a structured Sulan summary directly from live Git + Agent facts
// so the user gets an instant, accurate catch-up even before/without an LLM call.
export function buildInstantSummary(snapshot) {
  if (!snapshot?.project) return ''
  const { project, git, agents = [] } = snapshot
  const blocked = agents.filter((a) => a.status === 'blocked')
  const working = agents.filter((a) => a.status === 'working')
  const done = agents.filter((a) => a.status === 'done')

  const branchLabel = git?.branch || project.branch || '当前目录'
  const changeCount = git?.totalFiles ?? 0
  const statusPhrase = blocked.length
    ? `${blocked.length} 个 Agent 等待处理`
    : working.length
      ? `${working.length} 个 Agent 正在执行`
      : changeCount
        ? `${changeCount} 个文件待提交`
        : '工作区干净，随时可开始'

  const tldr = `${project.name} (${branchLabel})：${statusPhrase}`

  const why = [
    `- 当前位于项目空间 \`${project.name}\`，工作目录 \`${project.folder || '~'}\`${git ? `，分支 \`${git.branch}\`` : ''}`,
  ]
  if (project.tabs.length > 1) {
    why.push(`- 开启了 ${project.tabs.length} 个工作标签页：${project.tabs.map((t) => `\`${t.name}\``).join('、')}`)
  }

  const did = []
  if (git?.commits?.length) {
    for (const c of git.commits.slice(0, 3)) {
      did.push(`- 最近提交 \`${c.hash}\`：${c.subject}`)
    }
  }
  if (git?.files?.length) {
    const sample = git.files.slice(0, 4).map((f) => `\`${f.path}\``).join('、')
    did.push(`- 当前工作区改动 ${git.totalFiles} 个文件：${sample}${git.totalFiles > 4 ? ' 等' : ''}`)
  }
  if (!did.length) did.push('- 暂无新的代码提交记录')

  const out = []
  if (git) {
    const sync = git.ahead || git.behind ? `（领先远端 ${git.ahead}，落后 ${git.behind}）` : '（与远端同步或本地分支）'
    out.push(`- Git 仓库 \`${git.name}\` 位于分支 \`${git.branch}\`${sync}`)
    if (git.worktrees?.length > 1) {
      out.push(`- 共有 ${git.worktrees.length} 个活跃 worktree：${git.worktrees.map((w) => `\`${w.branch}\``).join('、')}`)
    }
  } else {
    out.push('- 当前目录未检测到 Git 仓库，仅展示终端与 Agent 状态')
  }

  const now = []
  if (done.length) {
    for (const a of done.slice(0, 2)) {
      now.push(`- [done] 终端 \`${a.address}\`（${a.programName} · ${a.tabName}）已完成后台任务：${a.name}`)
    }
  } else if (git?.commits?.[0]) {
    now.push(`- [done] 基线提交 \`${git.commits[0].hash}\` 已落盘：${git.commits[0].subject}`)
  }

  if (working.length) {
    for (const a of working.slice(0, 3)) {
      const subs = a.subagents?.length ? `（含 ${a.subagents.length} 个子代理）` : ''
      now.push(`- [wip] 终端 \`${a.address}\`（${a.programName} · ${a.tabName}）正在运行：${a.name}${subs}`)
    }
  }
  if (changeCount > 0) {
    now.push(`- [wip] 工作区有 ${changeCount} 个未提交文件等待验证或提交`)
  }

  if (blocked.length) {
    for (const a of blocked) {
      now.push(`- [fail] 终端 \`${a.address}\`（${a.programName} · ${a.tabName}）需要人工介入：${a.name}`)
    }
  }
  if (!now.length) {
    now.push(`- [done] 当前空间内 ${agents.length || 1} 个终端处于空闲就绪状态`)
  }

  const next = []
  if (blocked.length) {
    for (const a of blocked) {
      next.push(`- [ask] 请前往终端 \`${a.address}\`（标签页 \`${a.tabName}\`）查看并处理 \`${a.programName}\` 的阻塞请求？`)
    }
  }
  if (changeCount > 0) {
    next.push(`- 检查这 ${changeCount} 个未提交文件的 diff 并运行测试`)
  } else if (working.length > 0) {
    next.push(`- 等待运行中的 Agent（${working.map((a) => `\`${a.address}\``).join('、')}）完成当前轮次`)
  } else {
    next.push('- 无待办')
  }

  const terms = []
  for (const a of agents.slice(0, 4)) {
    if (!a.isShell) {
      terms.push(`- **${a.address} (${a.programName})**：位于标签页 \`${a.tabName}\` 的 Agent 终端，当前标题为“${a.name}”`)
    }
  }

  const step1 = git?.commits?.length ? '✓ 拉取基线' : '✓ 打开空间'
  const step2 = working.length ? `◐ ${working.length} Agent 运行` : changeCount > 0 ? `◐ 改动 ${changeCount} 文件` : '✓ 代码就绪'
  const step3 = blocked.length ? `✗ ${blocked.length} 处待确认` : changeCount > 0 ? '○ 验证与提交' : '○ 下一任务'

  const lines = [
    `TLDR: ${tldr.slice(0, 48)}`,
    '## why',
    ...why,
    '## did',
    ...did,
    '## out',
    ...out,
    '## now',
    ...now,
    '## next',
    ...next,
  ]
  if (terms.length) {
    lines.push('## terms', ...terms)
  }
  lines.push(
    '## flow',
    'flowchart TD',
    `  a["${step1}"] --> b["${step2}"]`,
    `  b --> c["${step3}"]`,
    `- 实时汇总自 ${project.tabs.length} 个标签页、${agents.length} 个终端${git ? ` 与分支 ${git.branch}` : ''}`,
  )
  return lines.join('\n')
}

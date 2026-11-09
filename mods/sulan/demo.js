// Demo fixtures are synthetic and contain no real project transcripts.
export const DEMO_PROJECTS = [{
  project: { id: 'demo-sulan', name: 'herdr-sulan', folder: '/workspace/herdr-sulan', machine: null,
    tabs: [{ id: 'demo-work', name: '侧栏优化', active: true }], panes: [] },
  agents: [
    { address: 'demo-a', name: '优化项目速览的阅读层次', status: 'working', tabName: '侧栏优化', programName: 'Agent' },
  ],
  summary: `TLDR: 侧栏已收敛为重点速览，正在打磨阅读与追问体验
## now
- [done] **已去掉 Git 明细**：只保留任务进展与关键结论，回到项目时能迅速接上主线。
- [wip] **正在优化侧聊**：让回答有清楚的段落和重点，输入区始终留在底部。
## out
- **先看结论，再看背景**：速览不再逐个复述终端日志，完整记录放到可展开的详情中。
## next
- [ask] **回复长度**：侧聊默认简短回答，只有追问时再展开，这个方向是否合适？
- **验证实际体验**：检查窄栏阅读、标签切换与连续追问是否顺畅。`,
  turns: [{ question: '接下来最值得先做什么？', answer: `**先验证侧聊在真实窄栏中的阅读和追问体验。**

目前信息层次已经收敛，接下来优先检查三件事：

- **看得清**：标题、正文和行内代码能否一眼区分。
- **切得快**：在速览与侧聊之间来回切换，输入和阅读位置都保留。
- **接得上**：问一个后续问题，确认回答沿着当前项目主线继续。

确认这些之后，再考虑补充更多功能。` }],
}]

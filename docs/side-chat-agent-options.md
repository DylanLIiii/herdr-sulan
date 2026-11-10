# Side Chat Agent：Pi SDK + billion-context

当前实现采用 **Pi Coding Agent SDK 1.5.0 + billion-context 0.1.213**。原生侧聊通过认证的本机服务运行 Agent，工作区会话与工具循环由 SDK 管理。启动方式见 [README](../README.md#安装与启动)。

## 选型依据

| 候选 | 适合本项目的能力 | 取舍 |
| --- | --- | --- |
| **Pi SDK** | JS/TS 嵌入、持久会话、编码工具、自定义工具、skills 和压缩扩展 | 已采用，便于控制工作区、HC 接口和原生界面 |
| **OpenCode SDK** | 后台服务、会话与消息 API、工具、自动 compaction | 可作为后续适配候选，需要匹配 SDK 与服务版本 |
| **Vercel AI SDK / ToolLoopAgent** | 灵活的工具循环、模型接入与流式输出 | 会话持久化、编码工具与上下文策略需额外组合 |
| **Claude Agent SDK** | Claude Code 的代码理解、编辑与命令能力 | Claude 生态为主时合适，多模型网关兼容性需验证 |

这是功能与接入成本的判断，未对各 Agent 的实际任务效果做排名。

## 实现结构

```text
Sulan GPUI 侧栏
  └─ 认证的本机任务 RPC
       └─ Pi Session（按工作区隔离）
            ├─ 编码工具：读取、搜索、命令、编辑
            ├─ HC 工具：工作区、窗口、有限终端资料
            ├─ 历史工具：Pi JSONL 检索与字节游标回读
            └─ billion-context 进程内扩展 → 配置的模型网关
```

- [原生客户端](../mods/sulan/agent-client.js) 使用开始、观察、停止、清空接口；一个 500ms 定时器读取活动任务状态。
- [HTTP 服务](../agent/server.js) 仅监听 loopback，使用私有 Bearer 令牌和来源检查。
- [任务管理](../agent/service.js) 记录稳定请求 ID 与恢复日志，完成请求在重启后恢复时不会再次执行工具。状态不明的旧任务需要手动重试。
- [SDK 运行时](../agent/runtime.js) 把工作区目录、所选模型和工具绑定到独立的持久会话。

工作区隔离键包括 Space ID 与规范化目录。不同工作区保存各自的对话；同一个目录同时只运行一个侧聊任务，避免多个写入者。切换界面不终止已接受的后台任务，返回后继续观察。清空会创建新会话，旧档案保留用于回读。

## HC Skill 与会话证据

[hc-project-context Skill](../agent/skills/hc-project-context/SKILL.md) 配合以下结构化工具：

| 工具 | 用途 |
| --- | --- |
| `hc_workspaces` | 列出应用登记的工作区 |
| `hc_windows` | 列出指定工作区的窗口、终端地址和状态 |
| `hc_read` | 用固定 CLI 参数读取允许的终端，保留 HC 的不完整标记 |
| `agent_sessions` | 列出登记目录中的 Pi 持久会话 |
| `agent_history_search` | 搜索限定范围并返回来源、游标与覆盖范围 |
| `agent_history` | 按字节游标回读记录，并给出下一页位置 |

HC 在终端 working、blocked 或 error 时可能只提供当前屏幕。完整历史适配器目前覆盖本机 **Pi JSONL**；Claude、OpenCode 等其他 Agent 当前只提供 HC 可见的终端资料。远程工作区直接进入只读观察模式：HC 地址带机器前缀，会话存储在服务的私有观察目录，仅开放 HC、历史和上下文工具。远程项目与本机同名的目录不会用于执行或读取历史；远程工作区的历史列表只包含其侧聊观察记录，原 Agent 的证据来自 HC。

[历史读取器](../agent/session-history.js) 只读取有限文件头来建立目录，并流式读取所需记录。搜索默认覆盖最近 50 个相关会话、每个最近 4MB，可继续向前分页。结果保留截断信息；一个有限范围没有匹配，不代表整个历史没有相应事实。

## billion-context

服务显式加载包内的 `dist/agent/pi-native.js`，采用进程内模式。包根入口属于其他客户端，不能作为 Pi 扩展直接导入。扩展状态按 Pi 持久会话 ID 管理，提供 `compress`、`decompress`、`search_context`、`acp_status` 等工具。

Pi 保留内建压缩机制；billion-context 确认当前会话已由其承载时，通过 ownership hook 抑制重复的自动压缩。`--native-context` 可显式切回 Pi 内建模式。服务只加载指定扩展和 HC Skill，不改当前用户的全局 Pi 配置；bili 内置子代理功能关闭。

压缩摘要应保留目标、用户决定、尚未解决的问题、已执行操作，以及工作区、终端、会话和字节游标。需要精确细节时使用上下文搜索、解压或原始 Pi 历史回读。

每轮完成或中断后，服务通过公开的 checkpoint API 确认内存中的压缩状态已写入，再删除这次临时 checkpoint。这个确认步骤处理了 inline 模式下 500ms 延迟写盘与快速进程退出的竞争；不会积累快照。确认失败时保留已完成的编码结果并提示，不自动重放工具操作。

模型 ID 列表不等于上下文能力声明。当前使用保守的 32,768-token 默认值，可通过 `SULAN_AGENT_CONTEXT_WINDOW` 根据实际模型配置。`billion-context.json` 位于服务自己的数据目录，独立保存压缩参数。

## 验证范围

[服务与历史回归](../test/agent.test.js) 覆盖认证、恢复不重放、停止、清空、目录范围、终端参数和流式历史游标。

原生验证使用真实 Herdr 窗口、实际 Pi SDK / billion-context，以及本地确定性 SSE 模型端点：完成工具调用，在任务处理中重启窗口，重启服务后继续同一 SDK 会话。

[跨进程集成回归](../test/sdk-context.test.js) 确认旧 HC 工具输出被折叠、关键摘要保留、退出后全新进程继续使用该压缩状态、解压恢复原始细节，以及两个并行工作区之间不混入彼此的记忆。固定模拟模型驱动实际 SDK 和扩展，存储参数仅在测试中缩小以触发有限规模的压缩。

[真实 HTTP 回归](../test/fixtures/sdk-http.js) 同时覆盖 Anthropic 与 OpenAI 兼容接口：保留代理路径前缀、应用选定思考参数、允许 API Key 留空，并验证匿名请求不会继承环境中的凭据。认证头由对应协议客户端构造，匿名模式通过 SDK 请求钩子显式省略。

这些测试不会调用付费模型，也不构成真实月级会话、数十亿 token 或固定节省倍数的质量基准。

## 资料

- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 与 [Compaction Reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)
- [billion-context](https://github.com/ranxianglei/billion-context) 与 [Pi 客户端文档](https://github.com/ranxianglei/billion-context/blob/master/docs/clients.md#pi-pidev-coding-agent)
- [OpenCode SDK](https://opencode.ai/docs/sdk/) 与 [Compaction](https://opencode.ai/docs/compaction/)
- [Vercel AI SDK Agents Overview](https://ai-sdk.dev/docs/agents/overview)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- HC 行为以目标机器的 `hc --skill` 与子命令帮助为准。

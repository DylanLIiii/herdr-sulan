# Side Chat Agent 候选与接入建议

状态：架构建议。当前版本已实现独立模型设置和 `/v1/models` 列表；侧聊仍是有限历史的模型调用，尚未接入下述 Agent 服务。

目标是让侧聊具备 Coding Agent 的工具循环、多个工作区的上下文、HC 窗口观察、持久对话与自动上下文压缩。

## 候选

| 候选 | 与本项目相关的能力 | 接入取舍 |
| --- | --- | --- |
| **Pi SDK** | TypeScript 嵌入；持久 SessionManager；自定义工具、skills、模型；自动与手动 compaction；旧会话条目仍保留 | 首选。适合由 Sulan 控制工作区、HC 工具和流式原生界面，需要一个同机 Node/Bun 服务承载 SDK |
| **OpenCode SDK** | TypeScript 客户端与后台服务；工作目录、会话、消息、工具；自动 compaction | 次选。服务接口现成；接入需锁定 SDK 与后台服务的匹配版本，并配置 HC 工具或插件 |
| **Vercel AI SDK / ToolLoopAgent** | 灵活的 JS/TS 工具调用循环、模型适配与流式输出 | 适合希望自行组织 Agent 的项目。文件与终端工具、持久会话、上下文压缩策略需要组合设计；本项目接入工作更多 |
| **Claude Agent SDK** | 将 Claude Code 的代码库理解、文件编辑、命令执行等能力用于应用 | Claude 生态为主时值得考虑。项目需要多模型网关，因此模型与端点兼容性要单独验证 |

这是基于已核对的 SDK 与官方文档的接入判断，并非不同 Agent 的实测效果排名。

## 建议结构

```text
Sulan 原生侧栏
  └─ 同机 Agent 服务：Pi SDK
       ├─ 工作区 / 持久会话注册表
       ├─ HC 工具：窗口列表、状态、有限读屏
       ├─ 历史适配器：按 Agent 类型读取持久会话与工具输出
       ├─ 模型网关：设置页选择的模型与服务配置
       └─ Compaction：结构化摘要 + 近期对话 + 历史引用
```

完整 Node/Bun Agent SDK 应由服务运行。Herdr Mod 保持 GPUI 界面，通过事件流显示回答、工具执行、压缩和错误状态。

一个工作区绑定明确的默认 `cwd` 和独立会话，切换工作区恢复其对应的会话。跨工作区调查通过显式工具参数读取其他工作区的资料，并保留来源；不把所有项目的完整历史预先塞入当前对话。

## HC Skill 与历史读取

建议给 Agent 注册结构化工具，并配一份说明 HC 地址、工作区归属、输出局限和证据引用方式的 Skill：

- `list_workspaces`：列出可访问的工作区。
- `list_windows(workspaceId)`：列出窗口、终端地址、Agent 类型和状态。
- `read_window(workspaceId, terminalId, lines)`：读取有限终端输出，返回完整性标记。
- `search_agent_history(workspaceId, query)`：查找相关历史片段及来源。
- `read_agent_history(sessionId, cursor, limit)`：按需回读完整会话中的相应范围。
- 文件读取、搜索、运行命令等 Coding 工具使用明确的目标工作区；观察其他 Agent 与执行新任务是不同的操作。

HC 当前手册说明：`hc read` 可读屏幕和历史；当终端状态为 working、blocked 或 error 时，历史读取只返回屏幕，并标记不完整。因此完整对话应由各 Agent 的持久化会话适配器提供，终端可见历史和会话记录分别保留来源。

第一阶段可以只实现 Pi 会话适配器，再扩展 OpenCode、Claude 等格式。找不到会话记录时，回答应说明资料仅来自终端输出。

## Auto Compaction

Pi 内置压缩会追加摘要条目、保留近期消息，并保留原始持久记录。本项目需要在这个机制上定义适合跨窗口调查的摘要内容：

- 当前目标、用户决策、约束和下一步。
- 每个工作区与 Agent 的进展、尚未解决的问题。
- 已执行的工具操作及已验证与待验证的结论。
- 工作区 ID、终端地址、Agent session ID、历史游标或文件位置，供以后回读。

压缩前应给后续工具结果和回答预留空间。模型配置需读取或补齐实际 `contextWindow`、最大输出与工具能力；`/v1/models` 返回的 ID 列表不能单独决定这些阈值。压缩失败或中断应保留原记录并可重试，界面显示当前状态。

验收需要一个超过上下文阈值的真实长会话：经历压缩、应用重启和工作区切换后，仍能找回先前决策与引用，并区分终端输出和完整 Agent 历史。现阶段尚未执行这个 Agent 级验收。

## 资料

- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 与 [Compaction Reference](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)。实现机制同时核对了本机安装的 Pi 1.5.0 文档。
- [OpenCode SDK](https://opencode.ai/docs/sdk/) 与 [Compaction](https://opencode.ai/docs/compaction/)。
- [Vercel AI SDK Agents Overview](https://ai-sdk.dev/docs/agents/overview)。
- [Claude Agent SDK 官方 TypeScript 仓库](https://github.com/anthropics/claude-agent-sdk-typescript)。
- HC 的行为依据当前安装版本的 `hc --skill` 手册；实现时继续以目标机器的 CLI 帮助为准。

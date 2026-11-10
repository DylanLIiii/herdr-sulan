# Herdr · 速览 Sulan

Herdr 原生项目侧边栏。回到项目时，先看清**当前结论、工作进展、需要你决定的事和下一步**，再交给侧聊 Agent 继续调查或处理任务。

![Sulan 原生侧栏：重点速览与 Markdown 阅读](preview.png)

预览来自隔离的 Herdr 原生窗口，内容为合成数据或本地模拟模型回复。[自动刷新侧栏局部](docs/preview-auto-update.png) · [远程观察模式](docs/preview-remote-observe.png) · [侧聊工具步骤](docs/preview-chat.png) · [任务处理中恢复窗口与草稿](docs/preview-agent-working.png)。

## 侧栏体验

- **速览 / 侧聊**两个标签。切换只构建当前内容，隐藏的摘要和回答不参与渲染。
- **自动速览**：打开项目后自动整理已有 Agent 资料；检测到新进展后自动更新结论与下一步，保留手动刷新。
- **Pi Coding Agent 侧聊**：保留工作区会话，按需调用 HC、历史检索和编码工具。多行输入框固定在底部，支持工具步骤、Thinking 折叠、停止、重连与复制。
- **billion-context**：通过 Pi 原生扩展提供上下文压缩、解压、搜索和状态查询，保留可回读的原始会话。
- **独立模型设置页**：从网关 `/v1/models` 获取可搜索列表，分别选择 Sulan 总结模型与 Side Chat Agent 模型，支持手填路由。
- **轻量速览采集**：自动采集不执行 Git 命令，不扫描仓库统计；资料来自任务线索和有限终端片段。编码工具由侧聊提问按需使用。
- 草稿与阅读状态在标签切换时保留。Herdr 原有终端、Files 和 Changes 保持可用。

## 安装与启动

需要 Herdr App、herdr-core (`hc`) 和 **Node.js 22.19+**。Agent 服务使用 npm 运行依赖。

```sh
git clone https://github.com/DylanLIiii/herdr-sulan.git
cd herdr-sulan
npm ci
npm run agent
```

保持这个服务终端运行。服务默认监听 `http://127.0.0.1:3426`，使用 Pi SDK 与 billion-context，并生成当前用户私有的连接令牌。

在**同一仓库的另一个终端**安装原生界面：

```sh
node scripts/install-layout.js --name sulan-agent
herdr-app check ~/.config/herdr-app/mods/sulan-agent
herdr-app do layout.switch --name sulan-agent
```

安装器自动读取服务的 `connection.json`，把地址与令牌写入权限为 `0600` 的个人布局。令牌不会打印在安装输出中。右栏默认 396px；已有同名文件时拒绝覆盖。更新后可换一个新名称安装，并切换至新布局。新 Mod 副本的模型偏好需单独配置。

设置 `HERDR_APP_HOME` 可更改界面安装位置。使用自定义 Agent 数据目录时，服务与安装器需使用同一个 `SULAN_AGENT_HOME`；也可通过 `--agent-connection /path/to/connection.json` 指定连接文件。设置页支持手动修改 Agent 地址和遮罩显示的令牌。

## 模型设置

侧栏右上角 **「设置」** 与侧聊底部 **「模型设置」** 打开同一个页面：

- **Sulan · 速览**：项目重点总结使用的模型。
- **Side Chat · 侧聊**：Pi Agent 使用的模型与思考深度；模型需支持工具调用和流式输出。
- **Pi Agent 服务**：本机服务地址与独立的连接令牌。
- **共用模型服务**：两种模型使用的完整接口地址和 API Key，密钥遮罩显示，也可留空。

默认模型网关为 `http://127.0.0.1:3425/v1/messages`，模型为 `auto/deepseek-v4.1-flash`，认证使用本地网关的占位值 `magpie`。网关与 Agent 服务是两个不同地址。程序不自动继承 Pi/Claude 的全局模型配置。

首次进入设置页时，用当前网关地址与 API Key 发送 `GET /v1/models`。从 `/v1/messages` 或 `/v1/chat/completions` 推导列表地址时保留反向代理前缀，并跟随分页。Anthropic 使用 `x-api-key`，OpenAI 兼容接口使用 Bearer 认证。

「从列表选择」支持按名称或完整 ID 搜索，每次最多呈现前 40 条匹配结果。「刷新列表」重新获取；修改地址或 API Key 会清除旧列表，并可用尚未保存的服务配置刷新。列表失败、为空或超时时仍可手填 ID，现有选择不会自动改写。

[原生设置页](docs/preview-settings.png) · [可搜索模型列表](docs/preview-model-list.png)。列表截图使用本地合成数据，数量和名称不代表你的网关。

「保存并返回」将偏好保存在当前 Mod 副本，优先于布局默认值，重启后恢复。保存不发起生成请求；运行中的任务沿用原配置，下一次请求使用新配置。「返回 / 取消」丢弃未保存的设置。

## 工作区、工具与历史

每个本机工作区使用独立的 Pi 会话和默认工作目录。切换工作区后恢复对应的对话；已接受的后台任务可以继续运行。窗口重启会重新观察原任务，完成请求的恢复不会再次执行工具。

内置 [HC Skill](agent/skills/hc-project-context/SKILL.md) 配合结构化工具：

- `hc_workspaces` / `hc_windows`：列出应用登记的工作区和终端。
- `hc_read`：读取指定工作区终端的有限屏幕或历史，保留完整性标记；支持 HC 提供的远程终端地址。
- `agent_sessions` / `agent_history_search` / `agent_history`：检索和分页读取本机 Pi JSONL 会话，包括侧聊自己的历史。
- Pi 的文件读取、搜索、命令执行和编辑工具：用于用户提出的编码任务。

完整历史适配器目前覆盖 **Pi**；其他 Agent 提供 HC 可见的终端资料。HC 在终端 working、blocked 或 error 时可能只返回当前屏幕。回答会区分终端输出与持久会话来源。

远程工作区可以直接进入**只读观察模式**，通过 HC 查询窗口、阅读输出、解释进展与提供建议。它使用私有观察目录保存侧聊记录，只开放 HC、历史和上下文工具，不开放本机的文件、命令或编辑工具。远程目录即使与本机路径同名，也不会被当作本机项目使用。远程 Agent 的完整记录仍需由目标机器提供；当前历史接口仅能检索本机可访问的 Pi 记录及该远程工作区的侧聊档案。

历史检索按字节游标读取，避免把整个长会话一次载入。搜索默认检查最近 50 个相关会话、每个最近 4MB，可继续向前分页；未命中的有限范围不代表从未发生。过大的单条记录会标记省略并保留原始位置。

## 上下文与会话恢复

服务固定加载 `billion-context` 的 **Pi 原生入口**，采用进程内模式。压缩状态按持久会话 ID 管理。Pi 原生自动压缩保留为兜底；只有 billion-context 确认已承载当前会话时，插件才接管自动压缩，避免重复处理。服务不加载当前用户的其他 Pi 扩展，也不修改全局 Pi 设置。

数据默认位于 `~/.local/share/herdr-sulan`（设置 `XDG_DATA_HOME` 时跟随该目录），可用 `SULAN_AGENT_HOME` 指定。这里保存私有连接文件、Pi 会话、billion-context 状态和请求恢复记录。模型 API Key 不写入 Agent 请求恢复记录。每轮结束时服务确认压缩状态已写入，快速重启也能继续使用已有摘要。若确认失败，界面会显示提示，已完成的编码操作保持成功状态，避免因存储问题重复执行。

「停止」向 SDK 发送中断；连接未确认时界面保留重连入口。「清空」会开始新的 Agent 会话，旧会话仍保留为可检索档案。服务中断时不会自动重放状态不明的编码任务，需要手动重试；Agent 会先检查先前的执行结果。

模型 ID 列表不能单独确定实际上下文窗口。服务默认使用保守的 32,768-token 配置，可通过 `SULAN_AGENT_CONTEXT_WINDOW` 按实际模型能力配置。billion-context 自身参数保存在服务数据目录的 `billion-context.json`；其压缩效果与真实长会话质量需要结合所用模型观察，项目不承诺固定压缩倍数。

## 速览的数据与更新

打开项目先恢复缓存和任务线索；有 Agent 资料时会自动生成首版 AI 速览。之后每 10 秒检测资料，变化后自动整理，不必点击「更新」。自动生成至少间隔 30 秒，合并连续变化；资料未变、只有空项目或正在编辑设置时不会重复调用模型。已成功整理的资料签名会随速览保存，重启也不会无故重新生成。

生成期间保留上一版内容；完成后自动替换，并保留标签、草稿与展开状态。网络错误和超时会自动退避重试，间隔从 30 秒逐步增加至最多 5 分钟。手动「更新」仍可立即刷新，「更多 → 重新整理」可忽略旧摘要重新提炼。布局属性 `autoUpdate: false` 可关闭自动模型生成。

速览会把有限终端片段发往配置的网关。侧聊会把问题与简短速览发给 Agent，由其按需读取资料并请求模型。终端和历史中的文字作为资料，不作为执行指令。

列表获取 20 秒后释放加载状态；速览生成请求 60 秒后释放 UI，忽略迟到回复。Agent 使用独立任务状态，没有 60 秒的生成时长限制；短状态请求超时后可重连。原生界面的 fetch 无法取消底层网络请求，Agent 的停止通过服务与 SDK 执行。

## 开发

```sh
npm ci
npm run check
npm test
herdr-app check mods/sulan
```

回归覆盖活动标签渲染、Markdown、固定输入区、草稿、模型列表、独立偏好、Agent 认证、任务恢复与去重、停止、工作区范围和流式历史读取。原生链路在隔离窗口中以实际 Pi SDK / billion-context 和本地模拟模型验证；模拟模型不会产生付费调用。测试不等同于真实月级会话或数十亿 token 的质量基准。

构建配方见 [RECIPE.md](mods/sulan/RECIPE.md)，Agent 选型与结构见 [Agent 文档](docs/side-chat-agent-options.md)。项目自有部分采用 [MIT](LICENSE)；来源说明与依赖许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

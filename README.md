# Herdr · 速览 Sulan

Herdr 原生项目侧边栏。回到项目时，先看清**当前结论、工作进展、需要你决定的事和下一步**，再围绕这些重点继续提问。

![Sulan 原生侧栏：重点速览与 Markdown 阅读](preview.png)

预览来自隔离的 Herdr 原生窗口，内容为合成演示数据。[查看侧聊原生截图](docs/preview-chat.png)。

## 侧栏体验

- **速览 / 侧聊**两个标签。切换只构建当前内容，不重建隐藏的回答、摘要或终端列表。
- **重点速览**：一句话结论置顶，需要关注的问题单独突出；正文使用原生 Markdown 渲染粗体、行内代码、段落和列表。长摘要的背景与完整内容默认收起。
- **独立侧聊**：先回答问题，再给简短解释。多行输入框固定在底部；历史对话按需展开，模型设置默认收起，支持复制、重试与 Thinking 折叠。
- **独立模型设置页**：侧栏右上角「设置」或侧聊底部「模型设置」进入，分别配置 Sulan 总结模型和 Side Chat 模型，支持常用选项与任意模型路由，保存后重启保留。
- **不采集 Git 明细**：不执行 Git 命令，不显示分支、提交、diff 或文件数量。信息来自当前项目的任务线索与有限终端片段。
- 按 Space 保存速览和对话，标签切换保留未发送的草稿。Herdr 标签栏仍支持「速览 / Files / Changes」开关。

## 安装

需要 Herdr App、herdr-core (`hc`) 和 Node.js 22+。没有 npm 运行依赖。

```sh
git clone https://github.com/DylanLIiii/herdr-sulan.git
cd herdr-sulan
npm run install-layout
herdr-app check ~/.config/herdr-app/mods/sulan
herdr-app do layout.switch --name sulan
```

安装器创建独立个人布局，右栏默认 396px；已有同名文件时拒绝覆盖。更新时可使用新名称预览：

```sh
git pull
node scripts/install-layout.js --name sulan-v2
herdr-app check ~/.config/herdr-app/mods/sulan-v2
herdr-app do layout.switch --name sulan-v2
```

也可把 `mods/sulan` 复制到不存在的目标目录，再作为右侧分屏打开：

```sh
herdr-app do pane.split '{"direction":"right","mod":"sulan"}'
```

部分 Herdr 版本不会自动将新 Mod 停靠到自带布局，个人布局或上面的分屏命令可以直接使用。

## 模型与资料

默认网关为 `http://127.0.0.1:3425/v1/messages`，模型为 `auto/deepseek-v4.1-flash`，请求头使用本地网关约定的占位值 `magpie`。

在侧栏右上角点击 **「设置」**，或在侧聊底部点击 **「模型设置」**，进入同一个原生设置页：

- **Sulan · 速览**：单独设置总结项目重点的模型。
- **Side Chat · 侧聊**：单独设置回答问题的模型与思考深度。
- **共用模型服务**：配置完整接口地址与 API Key；密钥在输入框中遮罩显示，也可留空。

模型可以从「常用模型」中选择，也可以直接输入网关支持的完整模型或路由名，无需编辑源码或布局文件。[查看原生设置页截图](docs/preview-settings.png)。

点击「保存并返回」后，配置保存在当前 Mod 副本的本地存储中，重启后恢复；已保存的值优先于布局提供的初始默认值。保存不触发请求，正在运行的请求继续使用原配置，下一次更新或提问使用新配置。「返回 / 取消」丢弃未保存的修改，并保留侧聊草稿。新建另一个名称的 Mod 副本时需在其设置页单独配置。

程序不自动继承 Pi/Claude 的模型。Anthropic 请求暂不传递 Effort；非默认 OpenAI 兼容请求会发送 `reasoning_effort`。

初始加载只恢复已有速览和任务线索，不自动请求模型。点击「更新」时收集终端片段并请求 AI 提炼重点；「更多 → 重新整理」从当前资料重新总结。定时检查每 10 秒采集一次线索，不调用模型。任务有新变化时提示手动更新，不自动改写你正在阅读的 AI 摘要。

AI 摘要和侧聊会把速览、任务线索与终端片段发送到配置的模型端点。资料不是完整会话历史；没有证据时不能确认任务已验证或代码已落盘。侧聊只做解答，不执行工具。

每个 Mod 副本使用自己的 localStorage。独立的分屏副本不保证同步。请求 60 秒后会释放 UI 并忽略迟到回复；底层原生 fetch 不支持取消，端点仍应设置自己的超时。请求超时后暂停自动采集，可手动重试。

## 开发

```sh
npm run check
npm test
herdr-app check mods/sulan
```

测试包含真实 View 的模拟宿主回归：仅渲染活动标签、Markdown 文档、固定输入区、草稿保留、按需历史、无 Git 采集、终端读取并发，以及模型设置的独立保存、重载、校验和下一次请求生效。模拟宿主的元素数量不等同于实际帧耗时；原生截图与交互仍需在目标版本核验。

构建配方见 [RECIPE.md](mods/sulan/RECIPE.md)。项目自有部分采用 [MIT](LICENSE)；来源说明及 Herdr Apache-2.0 适配许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

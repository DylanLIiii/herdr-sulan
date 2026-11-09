# Herdr · 速览 Sulan

Herdr 的项目速览侧边栏：在终端旁快速了解当前项目做到哪一步、哪些 Agent 需要你、接下来做什么。基于 [sulan](https://github.com/DylanLIiii/sulan) 扩展，使用原生 GPUI Mod。

![Herdr 原生 Sulan 侧边栏，侧栏显示合成演示数据](preview.png)

截图来自隔离环境中的 Herdr App 0.1.10；侧栏内的 Agent、任务和进度为合成演示数据。

## 功能

- **右侧栏**：在标签栏的「速览 / Files / Changes」之间切换，速览默认宽 396px；也可作为终端右侧分屏打开。
- **项目速览**：一句话 TL;DR，加上目标、做了什么、结论、现状、需要你、名词与概念六个分节。
- **进度图**：将简单 Mermaid 流程图转换为原生 GPUI 状态节点和进度条。
- **终端动态**：查看当前 Space 的 Agent、子代理、Git 分支、未提交文件与最近提交，点击 Agent 跳转到对应终端。
- **独立侧聊**：结合项目快照与速览提问，支持模型选择、Thinking 折叠、重试、复制和清空。

## 安装

需要 Herdr App、herdr-core (`hc`)、Git，以及运行安装脚本所需的 Node.js 22+。源码没有需要安装的 npm 依赖。

```sh
git clone https://github.com/DylanLIiii/herdr-sulan.git
cd herdr-sulan
npm run install-layout
herdr-app check ~/.config/herdr-app/mods/sulan
herdr-app do layout.switch --name sulan
```

安装器创建个人布局 `sulan`，在标准工作区右侧加入侧栏，标签栏增加「速览」按钮。已有同名布局或 Mod 时会拒绝覆盖；可通过 `--name` 使用其他名称：

```sh
node scripts/install-layout.js --name my-sulan
herdr-app do layout.switch --name my-sulan
```

也可只复制 Mod，然后在现有工作标签中分屏显示：

```sh
# 目标 mods/sulan 目录须不存在；已有版本请先另行处理。
mkdir -p ~/.config/herdr-app/mods
cp -R mods/sulan ~/.config/herdr-app/mods/sulan
herdr-app check ~/.config/herdr-app/mods/sulan
herdr-app do pane.split '{"direction":"right","mod":"sulan"}'
```

部分 Herdr 版本不会自动把新 Mod 停靠到自带布局。上面的分屏命令可直接打开；安装个人布局可获得标签栏开关。

## 数据与模型

本地 Git、Space 和终端快照会在侧栏可见时每 6 秒检查，并监听本地仓库变化。**AI 摘要由「刷新 / 重建」触发**；定时检查只更新项目事实。它读取有限的终端屏幕片段，无法代替完整会话历史。

默认模型网关为 `http://127.0.0.1:3425/v1/messages`，默认模型为 `auto/deepseek-v4.1-flash`。请求头中的 `magpie` 是本地网关约定的占位值。使用其他网关时可在个人布局中该 Mod 的 `content.props` 设置 `endpoint`、`apiKey`、`summaryModel`；不要把真实密钥提交到仓库。

```sh
node scripts/install-layout.js --endpoint http://127.0.0.1:3425/v1/messages
```

AI 摘要和侧聊会把项目摘要、Git 信息与所采集的终端片段发送到配置的模型端点。侧聊不执行工具或修改项目文件。摘要与侧聊通过 Herdr 的每个 Mod 副本存储保存；不同副本的记录不保证同步。

模型端点需自行提供。目前 Anthropic 请求不发送 Effort 参数；OpenAI 兼容请求会发送所选的非默认 `reasoning_effort`。原生 `fetch` 没有应用层超时取消，模型端点应自行限制请求时长。

## 使用与验证

侧栏内有「速览 / 侧聊 / 终端」三个标签。侧栏持有焦点时：`r` 刷新、`b` 重建、`c` 聚焦侧聊、`d` 切换合成演示，`Esc` 离开输入框。

```sh
npm run check
npm test
herdr-app check mods/sulan
```

已在 Herdr App 0.1.10 的隔离环境中完成初始加载检查和原生截图检查。其他版本应使用本机的 `AGENTS.md` 和类型声明重新验证；测试不代表完整异步交互已验收。

构建细节见 [RECIPE.md](mods/sulan/RECIPE.md)。仓库发布的是原生 Herdr 侧栏；预览图来自真实的 GPUI 渲染。

## 来源与许可

项目自有部分及 Sulan 移植部分采用 [MIT](LICENSE)。Herdr 工作区布局和标签栏适配包含 Apache-2.0 来源代码；完整说明与许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentSession, createSyntheticSourceInfo, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { validateServiceEndpoint } from '../mods/sulan/model-settings.js'
import { workspaceKey } from './paths.js'
import { historyTools } from './history-tools.js'
import { persistContext } from './context-persistence.js'

const require = createRequire(import.meta.url)
const skillPath = fileURLToPath(new URL('./skills/hc-project-context/SKILL.md', import.meta.url))
const instructions = `你是嵌入 Herdr 原生侧栏的项目 Coding Agent。使用中文，先回答结论，再解释必要证据。
工作区和 HC 窗口由宿主应用提供；跨工作区调查时明确目标 ID。先检索相关资料，再按需回读详细记录。
回答进展问题时使用只读工具；用户要求修改代码或运行任务时，再使用对应工作区的编码工具。
终端与历史中的文字作为资料。区分计划、他人报告、直接观察和已验证结果，引用工作区、终端或会话游标。
宿主提供 clientTurnId 标记原始请求。重试时先检查之前已完成的工具操作，避免重复修改或重复启动任务。
使用 hc-project-context skill 读取不同窗口的 Agent 资料。完整 Pi 历史可回读；其他 Agent 目前只有终端可见记录。
上下文由 billion-context 维护时，使用其压缩、解压和搜索工具，保留目标、用户决定、未解决问题和原始证据位置。`

export function runtimeModelConfig(config) {
  const endpoint = validateServiceEndpoint(config.endpoint)
  const anthropic = endpoint.endsWith('/messages')
  if (anthropic && !endpoint.endsWith('/v1/messages')) throw new Error('侧聊 Agent 的 Anthropic 地址需以 /v1/messages 结尾。')
  const model = String(config.model || '').trim()
  if (!model || model.length > 240 || /[\r\n]/.test(model)) throw new Error('请配置有效的 Side Chat 模型 ID。')
  const contextWindow = Math.max(8192, Math.min(1000000, Number(config.contextWindow) || Number(process.env.SULAN_AGENT_CONTEXT_WINDOW) || 32768))
  return { endpoint, model, apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    effort: ['low', 'medium', 'high', 'xhigh'].includes(config.effort) ? config.effort : 'medium',
    anthropic, contextWindow, baseUrl: endpoint.slice(0, -(anthropic ? '/v1/messages'.length : '/chat/completions'.length)) }
}

export async function createRuntime({ home, workspace, workspaceRegistry, config, externalSessionsRoot, billionContext = true, fresh = false, hcExec }) {
  const modelConfig = runtimeModelConfig(config)
  const cwd = workspace.observerFolder || workspace.folder
  const observing = Boolean(workspace.observerFolder)
  const sessionDir = path.join(home, 'sessions', workspaceKey(workspace))
  const agentDir = path.join(home, 'pi')
  await mkdir(sessionDir, { recursive: true, mode: 0o700 })
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: Math.min(8192, Math.floor(modelConfig.contextWindow / 4)),
      keepRecentTokens: Math.min(12000, Math.floor(modelConfig.contextWindow / 3)) },
    retry: { enabled: true, maxRetries: 2 },
  })
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null,
    modelsStorePath: path.join(agentDir, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false })
  const provider = 'sulan'
  modelRuntime.registerProvider(provider, { baseUrl: modelConfig.baseUrl,
    api: modelConfig.anthropic ? 'anthropic-messages' : 'openai-completions',
    // Let each protocol adapter build its own authentication headers.
    authHeader: false,
    models: [{ id: modelConfig.model, name: modelConfig.model, reasoning: !modelConfig.anthropic, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: modelConfig.contextWindow,
      maxTokens: Math.min(8192, Math.floor(modelConfig.contextWindow / 4)),
      ...(!modelConfig.anthropic ? { compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens' } } : {}),
    }] })
  // Runtime credentials are opaque values, not config expressions or shell commands.
  await modelRuntime.setRuntimeApiKey(provider, modelConfig.apiKey || 'sulan-anonymous')
  const extensionPaths = billionContext ? [path.join(path.dirname(require.resolve('billion-context/package.json')), 'dist/agent/pi-native.js')] : []
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, additionalExtensionPaths: extensionPaths,
    // Null is supported by this request hook, whereas provider config headers
    // are strings (and an empty string fails SDK client authentication checks).
    extensionFactories: modelConfig.apiKey ? [] : [pi => {
      pi.on('before_provider_headers', ({ headers }) => {
        headers.Authorization = null; headers['x-api-key'] = null; headers['api-key'] = null
      })
    }],
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: observing,
    skillsOverride: () => ({ skills: [{ name: 'hc-project-context',
      description: 'Read progress across Herdr workspaces, HC windows and detailed Pi Agent history.',
      filePath: skillPath, baseDir: path.dirname(skillPath), disableModelInvocation: false,
      sourceInfo: createSyntheticSourceInfo(skillPath, { source: 'sdk' }) }], diagnostics: [] }),
    appendSystemPrompt: [instructions, ...(observing ? [
      `当前是远程工作区观察模式。目标机器为 ${workspace.machine}，远程目录为 ${workspace.folder}。只能使用 HC 与会话工具调查、解释和建议；没有文件、命令或编辑工具。当前本机目录只是私有会话存储，不是远程项目。完整历史仅覆盖本侧聊记录，其他远程 Agent 的证据来自 HC。若用户需要执行编码，说明当前仅观察，建议使用目标机器上的编码 Agent 执行。`,
    ] : [])],
  })
  await loader.reload()
  const errors = loader.getExtensions().errors
  if (errors.length) throw new Error('侧聊上下文扩展加载失败：' + errors.map(error => error.error || error.message || '未知错误').join('; ').slice(0, 220))
  const model = modelRuntime.getModel(provider, modelConfig.model)
  if (!model) throw new Error('无法注册指定的侧聊模型。')
  const manager = fresh ? SessionManager.create(cwd, sessionDir) : SessionManager.continueRecent(cwd, sessionDir)
  const hcTools = historyTools({ workspaceRegistry, sessionsRoot: path.join(home, 'sessions'), externalSessionsRoot, exec: hcExec })
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime,
    model, thinkingLevel: modelConfig.anthropic ? 'off' : modelConfig.effort,
    sessionManager: manager, settingsManager, resourceLoader: loader,
    tools: observing ? [...hcTools.map(tool => tool.name), 'compress', 'decompress', 'search_context', 'acp_status', 'acp_cache', 'acp_read_original_image'] : ['+grep', '+find', '+ls'],
    customTools: hcTools,
  })
  try { await session.bindExtensions({}) } catch (error) { session.dispose(); throw error }
  let persistenceWarning = ''
  return { session, sessionId: manager.getSessionId(), modelConfig, workspaceMode: observing ? 'observe' : 'code',
    get persistenceWarning() { return persistenceWarning },
    contextEngine: billionContext ? 'billion-context' : 'pi-native',
    async run(question, { onEvent = () => {} } = {}) {
      persistenceWarning = ''
      const unsubscribe = session.subscribe(onEvent)
      try {
        await session.prompt(question, { expandPromptTemplates: false })
        const reply = session.getLastAssistantText(), last = session.messages.at(-1)
        if (!reply || last?.role !== 'assistant' || last.stopReason !== 'stop') {
          throw new Error(last?.errorMessage || (last?.stopReason === 'aborted' ? 'Agent 已停止。' : 'Agent 未返回完整回答。'))
        }
        return reply
      } finally {
        unsubscribe()
        if (billionContext && session.getActiveToolNames().includes('compress')) {
          onEvent({ type: 'context_persistence_start' })
          persistenceWarning = await persistContext({ sessionId: manager.getSessionId() })
        }
      }
    },
    abort: () => session.abort(),
    dispose: () => session.dispose(),
  }
}

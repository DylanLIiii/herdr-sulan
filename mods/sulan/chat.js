// Pure helpers for splitting <think>/<thinking> blocks, managing side-chat
// turns, and formatting project catch-up prompts.

export const MAX_TURNS = 8
export const MAX_QUESTION = 2000
export const MAX_ANSWER = 4000
export const MAX_THINKING = 4000
const HISTORY_CHARS = 24_000

export const DEFAULT_MODELS = [
  { value: 'auto/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (快速)' },
  { value: 'auto/claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { value: 'auto/claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'auto/gemini-4-argon', label: 'Gemini 4 Argon' },
  { value: 'auto/gpt-6-astra', label: 'GPT-6 Astra' },
]

export const EFFORT_CHOICES = [
  { value: 'low', label: '较快 (low)' },
  { value: 'medium', label: '适中 (medium)' },
  { value: 'high', label: '深入 (high)' },
  { value: 'xhigh', label: '深度推理 (xhigh)' },
]

export const SUGGESTIONS = [
  ['解释当前改动', '请结合当前项目的 git 改动与 Agent 进展，解释已经完成的改动及其原因。'],
  ['梳理下一步', '根据当前项目的速览、Agent 状态与未提交改动，接下来最值得先做什么？'],
  ['检查潜在风险', '请根据当前项目状态，指出尚未解决的阻塞、失败项或需要优先验证的地方。'],
]

export const INSTRUCTIONS = `读者：离开一段时间或刚切换到当前项目 Space 的人。只看这份速览，就能立刻搞清项目做到哪一步、哪些 Agent 在跑或卡住、接下来该干什么。

## 规则
- 只写当前项目（Space）真实发生的事。以 git 状态与终端屏幕输出为准：说做了但磁盘上没落盘的，要明确写清
- 代号、缩写、工作树分支或内部简称不要裸用：一句话能顺带点明的当场写清；需要展开讲清“具体指什么 / 怎么运作”的收进 \`## terms\`
- 写结果，不写过程：“网关超时已加 15s 看门狗”好过“排查了半天网络问题”
- 失败、阻塞、等待用户确认的要直说，不要美化；有 Agent 处于 \`blocked\` 或报错时重点标出
- 文件路径、分支、终端地址（如 \`t8\`）、命令、代码用 \`反引号\`
- 每节 1 到 4 条（\`terms\` 可到 6 条），每条一行左右；没有内容就写 "- 无"（\`terms\` 没有内容可整节省略）

## 输出格式（严格遵守，不要多写别的）

TLDR: 一句话说清当前项目在干什么、到哪一步（30 字内）
## why
- 当前项目 / 分支的核心目标；如果有多个并行 Tab 或目标演进，写清主线
## did
- 具体动作，带文件路径、命令或负责的终端
## out
- 已验证的结论、架构决定、或证实走不通的路
## now
- [done] 已完成且已在 git 或测试中确认的事项
- [wip] 正在进行中、Agent 正在跑或未提交的改动
- [fail] 报错、测试失败或阻塞的事项
## next
- [ask] 需要用户拍板、回答或处理的阻塞项，写成明确问题
- 显而易见的下一步行动；什么都没有就写 "- 无待办"
## terms
- **词 / 缩写 / 分支代号**：一句大白话讲清在当前项目里具体指什么、解决什么问题
## flow
flowchart TD
  a["✓ 第一步"] --> b["◐ 第二步"]
  b --> c["○ 第三步"]
- 一两行说明图里看不出的关键上下文`

function codeRanges(text) {
  const ranges = []
  const fences = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n/g
  let match
  while ((match = fences.exec(text))) {
    const start = match.index
    const close = new RegExp('(?:^|\\n)[ \\t]{0,3}' + match[2][0] + '{' + match[2].length + ',}[ \\t]*(?:\\n|$)', 'g')
    close.lastIndex = fences.lastIndex
    const end = close.exec(text)
    const until = end ? close.lastIndex : text.length
    ranges.push([start, until])
    fences.lastIndex = until
  }
  const inline = /(`+)[^\n]*?\1/g
  while ((match = inline.exec(text))) ranges.push([match.index, inline.lastIndex])
  return ranges
}

export function splitReply(value) {
  const text = String(value ?? '').trim()
  const ranges = codeRanges(text)
  const tags = /<\/?(think|thinking|analysis|reasoning)\s*>/gi
  const answers = []
  const thoughts = []
  let position = 0
  let start = -1
  let depth = 0
  let match
  while ((match = tags.exec(text))) {
    if (ranges.some(([a, b]) => match.index >= a && match.index < b)) continue
    const closing = match[0][1] === '/'
    if (!closing) {
      if (depth++ === 0) {
        answers.push(text.slice(position, match.index))
        start = tags.lastIndex
      }
    } else if (depth > 0) {
      if (--depth === 0) {
        thoughts.push(text.slice(start, match.index))
        position = tags.lastIndex
      }
    } else if (!thoughts.length && !answers.length) {
      thoughts.push(text.slice(0, match.index))
      position = tags.lastIndex
    }
  }
  if (depth > 0) thoughts.push(text.slice(start))
  else answers.push(text.slice(position))
  if (thoughts.length) {
    return { answer: answers.join('\n').trim(), thinking: thoughts.join('\n\n').trim(), kind: 'tagged', incomplete: depth > 0 }
  }

  const planningOpening = /^(?:The user (?:asks|is asking|wants)|We need to (?:answer|respond)|I need to (?:answer|respond))\b/i
  const selfInstruction = /\b(?:I should|I must|Let me|We should|So (?:the )?answer|Structure:|Key considerations)\b/i
  if (planningOpening.test(text) && selfInstruction.test(text) && text.includes('\n\n')) {
    const boundary = /^(?:#{1,3}\s*)?(?:Final answer|Final response|最终回答|最终答案|正式回答|最终回复)\s*[:：]\s*/im.exec(text)
    return {
      answer: boundary ? text.slice(boundary.index + boundary[0].length).trim() : '',
      thinking: boundary ? text.slice(0, boundary.index).trim() : text,
      kind: 'suspected',
      incomplete: !boundary,
    }
  }
  return { answer: text, thinking: '', kind: '', incomplete: false }
}

const clipped = (text, max, note) => (text.length > max ? text.slice(0, max) + '\n\n…（' + note + '已截断）' : text)

export function replyFields(text, answerLimit = MAX_ANSWER) {
  const parts = splitReply(text)
  if (!parts.thinking) return { answer: clipped(parts.answer, answerLimit, '回答过长，') }
  return {
    answer: parts.answer ? clipped(parts.answer, answerLimit, '回答过长，') : null,
    thinking: clipped(parts.thinking, MAX_THINKING, '思考过长，'),
    thinkingKind: parts.kind,
    ...(parts.incomplete ? { thinkingIncomplete: true } : {}),
  }
}

export function turnReply(turn) {
  const parts = splitReply(turn?.answer ?? '')
  return {
    answer: parts.answer,
    thinking: turn?.thinking || parts.thinking,
    kind: turn?.thinkingKind || parts.kind,
    incomplete: Boolean(turn?.thinkingIncomplete || parts.incomplete),
  }
}

export function cleanTurns(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((turn) => turn && typeof turn.question === 'string' && (turn.answer === null || typeof turn.answer === 'string'))
    .slice(-MAX_TURNS)
    .map((turn) => ({
      question: turn.question.slice(0, MAX_QUESTION),
      ...(turn.answer === null ? { answer: null } : replyFields(turn.answer, MAX_ANSWER)),
      ...(typeof turn.thinking === 'string' && turn.thinking
        ? {
            thinking: turn.thinking.slice(0, MAX_THINKING + 30),
            thinkingKind: turn.thinkingKind === 'suspected' ? 'suspected' : 'tagged',
            ...(turn.thinkingIncomplete ? { thinkingIncomplete: true } : {}),
          }
        : {}),
    }))
}

export function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  return ms < 1000 ? '<1 秒' : Math.round(ms / 1000) + ' 秒'
}

export function summarySystemPrompt(customInstructions = INSTRUCTIONS) {
  return [
    '你维护一个 Herdr 项目空间（Space）的实时速览（Sulan 速览），帮助开发者切换回该项目时在几秒内掌握全局。',
    '你拿到的是：上一版速览、当前项目的 Git 状态（分支、未提交文件、最近提交）、以及该项目下各个终端与 Coding Agent 的实时状态和屏幕尾部摘要。',
    '写出完整的新速览：保留仍然成立的事实（包括仍在速览中出现的名词解释），改写有进展的部分，删掉已过时的内容。如果上一版速览为空，则直接根据当前项目证据构建第一版速览。',
    '重点放在项目目标、已完成改动、关键结论、当前各任务的真实状态（已完成/进行中/失败阻塞）、需要用户拍板的问题、关键术语消歧和主线流程图。全部用中文，路径、命令、分支名和终端地址（如 `t8`）保持原样。只输出速览本身，从 TLDR 行开始，严格遵守以下格式。',
    '<instructions>\n' + customInstructions + '\n</instructions>',
  ].join('\n\n')
}

export function summaryUserPrompt({ previousSummary, contextText }) {
  return [
    '<previous_summary>',
    String(previousSummary || '(还没有上一版速览)').slice(0, 10_000),
    '</previous_summary>',
    '',
    '<project_context>',
    String(contextText || '(暂无项目上下文)').slice(0, 60_000),
    '</project_context>',
  ].join('\n')
}

export function sideChatPrompt(turns, summary, contextText) {
  const current = turns.at(-1)
  const previous = []
  let remaining = HISTORY_CHARS
  for (const turn of turns.slice(0, -1).reverse()) {
    if (turn.answer === null) continue
    const size = turn.question.length + turn.answer.length
    if (size > remaining) break
    previous.unshift({ question: turn.question, answer: turn.answer })
    remaining -= size
  }
  return [
    '这是与当前 Herdr 项目并行的独立侧聊（Sulan 侧聊）。请结合项目的实时速览、Git 状态、各终端 Agent 屏幕摘要以及之前的侧聊记录，回答最后的问题。',
    '请使用提问者的语言，直接输出最终回答，不要把英文自述或推理草稿混入正文；如需思考，必须包裹在 <think>...</think> 中。信息不足时明确说明。你在此侧聊中只做分析与解答，不直接修改文件或声称已执行命令。',
    '当前项目速览：',
    String(summary || '(暂无速览)').slice(0, 10_000),
    '当前项目实时上下文（Git / Agents / 终端摘要）：',
    String(contextText || '(暂无实时上下文)').slice(0, 40_000),
    '之前的侧聊记录（JSON，按时间顺序）：',
    JSON.stringify(previous),
    '当前问题（JSON 字符串）：',
    JSON.stringify(current?.question ?? ''),
  ].join('\n')
}

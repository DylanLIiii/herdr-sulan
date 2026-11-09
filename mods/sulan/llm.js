// Calls an OpenAI-compatible or Anthropic-compatible LLM endpoint using
// Herdr's native global fetch (e.g. local Magpie gateway at 127.0.0.1:3425).

export const DEFAULT_ENDPOINT = 'http://127.0.0.1:3425/v1/messages'
export const DEFAULT_MODEL = 'auto/deepseek-v4.1-flash'

export async function completeModel({
  fetchFn = globalThis.fetch,
  endpoint = DEFAULT_ENDPOINT,
  apiKey = 'magpie',
  model = DEFAULT_MODEL,
  effort = 'medium',
  system = '',
  prompt = '',
  maxTokens = 2500,
}) {
  if (typeof fetchFn !== 'function') {
    throw new Error('当前运行环境不支持 fetch')
  }
  const url = String(endpoint || DEFAULT_ENDPOINT).trim()
  const isAnthropic = url.endsWith('/v1/messages') || url.endsWith('/messages')

  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) {
    if (isAnthropic) {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
  }

  let body
  if (isAnthropic) {
    const payload = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }
    if (system) payload.system = system
    body = JSON.stringify(payload)
  } else {
    const messages = []
    if (system) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: prompt })
    const payload = {
      model,
      max_tokens: maxTokens,
      messages,
    }
    if (effort && effort !== 'medium') payload.reasoning_effort = effort
    body = JSON.stringify(payload)
  }

  const response = await fetchFn(url, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const errJson = await response.json()
      detail = errJson?.error?.message || errJson?.error || errJson?.message || ''
    } catch {
      try {
        detail = await response.text()
      } catch {}
    }
    throw new Error(`HTTP ${response.status}${detail ? ': ' + String(detail).slice(0, 120) : ''}`)
  }

  const data = await response.json()
  if (isAnthropic) {
    const blocks = Array.isArray(data?.content) ? data.content : []
    const thoughts = blocks
      .filter((b) => b?.type === 'thinking' && b.thinking)
      .map((b) => b.thinking.trim())
      .filter(Boolean)
    const texts = blocks
      .filter((b) => b?.type === 'text' && b.text)
      .map((b) => b.text.trim())
      .filter(Boolean)
    const prefix = thoughts.length ? `<think>${thoughts.join('\n\n')}</think>\n\n` : ''
    return (prefix + texts.join('\n\n')).trim()
  }

  const choice = data?.choices?.[0]?.message
  if (!choice) throw new Error('模型响应格式无效')
  const reasoning = choice.reasoning_content || choice.reasoning || ''
  const content = typeof choice.content === 'string' ? choice.content : ''
  const prefix = reasoning ? `<think>${String(reasoning).trim()}</think>\n\n` : ''
  return (prefix + content).trim()
}

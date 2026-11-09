import { DEFAULT_ENDPOINT } from './llm.js'
import { validateServiceEndpoint } from './model-settings.js'

export function modelsUrl(endpoint = DEFAULT_ENDPOINT) {
  return validateServiceEndpoint(endpoint).replace(/\/(?:messages|chat\/completions)$/, '/models')
}

export async function fetchModels({ endpoint = DEFAULT_ENDPOINT, apiKey = '', fetchFn = globalThis.fetch, isCurrent = () => true } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('当前运行环境不支持获取模型列表。')
  const base = modelsUrl(endpoint)
  const anthropic = endpoint.trim().endsWith('/messages')
  const headers = { Accept: 'application/json' }
  if (anthropic) headers['anthropic-version'] = '2023-06-01'
  if (apiKey) headers[anthropic ? 'x-api-key' : 'Authorization'] = anthropic ? apiKey : `Bearer ${apiKey}`
  const models = new Map(), cursors = new Set()
  let url = base
  for (let page = 0; page < 20; page++) {
    if (!isCurrent()) throw new Error('已取消获取模型列表。')
    let response
    try { response = await fetchFn(url, { method: 'GET', headers }) }
    catch { throw new Error('无法连接模型服务，请检查地址后重试。') }
    if (!response.ok) throw new Error(`模型列表获取失败（HTTP ${response.status}），请检查接口地址和 API Key。`)
    let data
    try { data = await response.json() } catch { throw new Error('服务返回的模型列表不是有效 JSON。') }
    if (!Array.isArray(data?.data)) throw new Error('服务返回的模型列表格式无效，预期为 data 数组。')
    for (const model of data.data) {
      const id = typeof model?.id === 'string' ? model.id.trim() : ''
      if (!id || id.length > 240 || /[\u0000-\u001f\u007f]/.test(id)) continue
      const label = typeof model.display_name === 'string' ? model.display_name.trim().replace(/\s+/g, ' ').slice(0, 240) : ''
      if (!models.has(id)) models.set(id, { id, label: label || id })
    }
    if (data.has_more !== true) return [...models.values()]
    const cursor = data.last_id || data.data.at(-1)?.id
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new Error('模型列表分页无效，请刷新后重试。')
    cursors.add(cursor)
    url = `${base}?after_id=${encodeURIComponent(cursor)}`
  }
  throw new Error('模型列表分页过多，暂时无法读取完整列表。仍可手动填写模型。')
}

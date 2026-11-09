// Settings are per Mod copy and override layout-provided installation defaults.
import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from './llm.js'
import { EFFORT_CHOICES } from './chat.js'

const text = value => typeof value === 'string' ? value.trim() : ''
export function resolveModelSettings(props = {}, saved = {}) {
  return {
    summaryModel: text(saved.summaryModel) || text(props.summaryModel) || DEFAULT_MODEL,
    chatModel: text(saved.chatModel) || text(props.chatModel) || DEFAULT_MODEL,
    chatEffort: EFFORT_CHOICES.some(e => e.value === saved.chatEffort) ? saved.chatEffort : 'medium',
    endpoint: text(saved.endpoint) || text(props.endpoint) || DEFAULT_ENDPOINT,
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : typeof props.apiKey === 'string' ? props.apiKey : 'magpie',
  }
}

export function validateServiceEndpoint(value) {
  const endpoint = text(value)
  // Native QuickJS does not provide the browser URL global.
  const address = /^(https?):\/\/([^\s/?#]+)(\/[^\s?#]*)$/.exec(endpoint)
  if (!address || address[2].includes('@')) throw new Error('请填写完整的 HTTP(S) 接口地址，认证信息请放在 API Key 中。')
  if (!/(?:\/messages|\/chat\/completions)$/.test(address[3])) {
    throw new Error('接口地址需以 /messages 或 /chat/completions 结尾。')
  }
  return endpoint
}

export function validateModelSettings(values) {
  const summaryModel = text(values.summaryModel), chatModel = text(values.chatModel)
  if (!summaryModel) throw new Error('请填写 Sulan 速览使用的模型。')
  if (!chatModel) throw new Error('请填写 Side Chat 使用的模型。')
  if (summaryModel.length > 240 || chatModel.length > 240 || /[\r\n]/.test(summaryModel + chatModel)) {
    throw new Error('模型名称请使用单行标识，长度不超过 240 个字符。')
  }
  const endpoint = validateServiceEndpoint(values.endpoint)
  if (!EFFORT_CHOICES.some(e => e.value === values.chatEffort)) throw new Error('请选择有效的 Side Chat 思考深度。')
  return { summaryModel, chatModel, endpoint, apiKey: typeof values.apiKey === 'string' ? values.apiKey.trim() : '', chatEffort: values.chatEffort }
}

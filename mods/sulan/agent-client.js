import { activeProject, projectAgents } from './context.js'

export const DEFAULT_AGENT_ENDPOINT = 'http://127.0.0.1:3426'
export function validateAgentConnection(values) {
  const agentEndpoint = String(values.agentEndpoint || DEFAULT_AGENT_ENDPOINT).trim().replace(/\/$/, '')
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/.test(agentEndpoint)) {
    throw new Error('Pi Agent 服务需使用本机 HTTP 地址，例如 http://127.0.0.1:3426。')
  }
  const port = /:(\d+)$/.exec(agentEndpoint)?.[1]
  if (port && (Number(port) < 1 || Number(port) > 65535)) throw new Error('Agent 服务端口需在 1 到 65535 之间。')
  return { agentEndpoint, agentToken: typeof values.agentToken === 'string' ? values.agentToken.trim() : '' }
}

export function agentWorkspaces(spacesList = [], panesList = [], agentsList = [], terminalsList = []) {
  const flatten = list => list.flatMap(item => [{ address: item.address, name: item.name, status: item.status, programName: item.programName || '' }, ...flatten(item.subagents || [])])
  return spacesList.slice(0, 100).map(space => {
    const project = activeProject([space], panesList)
    return { id: String(project.id), name: project.name, folder: project.folder, machine: project.machine,
      windows: flatten(projectAgents(project, agentsList, terminalsList)).filter(item => item.address).slice(0, 200) }
  }).filter(item => item.folder)
}

async function request(connection, route, method = 'GET', body, fetchFn = globalThis.fetch) {
  const config = validateAgentConnection(connection)
  if (!config.agentToken) throw new Error('请先运行 npm run agent，再安装新版布局以自动配置 Agent 连接令牌。')
  if (typeof fetchFn !== 'function') throw new Error('当前环境不支持连接 Agent 服务。')
  let response
  try {
    response = await fetchFn(config.agentEndpoint + route, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.agentToken}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  } catch { throw new Error('无法连接 Pi Agent。请先在仓库运行 npm run agent，并检查 Agent 服务地址。') }
  let data
  try { data = await response.json() } catch { throw new Error('Agent 服务返回格式无效，请检查地址是否指向 Sulan Agent。') }
  if (!response.ok) {
    let message = String(data?.error || `Agent HTTP ${response.status}`).slice(0, 400)
    for (const key of [config.agentToken, body?.config?.apiKey]) if (key) message = message.split(key).join('[hidden]')
    throw Object.assign(new Error(message), { status: response.status })
  }
  return data
}
export const startAgentTurn = (connection, body, fetchFn) => request(connection, '/turns', 'POST', body, fetchFn)
export const readAgentJob = (connection, id, fetchFn) => request(connection, `/jobs/${encodeURIComponent(id)}`, 'GET', undefined, fetchFn)
export const stopAgentTurn = (connection, id, fetchFn) => request(connection, `/jobs/${encodeURIComponent(id)}/cancel`, 'POST', {}, fetchFn)
export const resetAgentSession = (connection, body, fetchFn) => request(connection, '/reset', 'POST', body, fetchFn)

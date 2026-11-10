import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentService } from './service.js'
import { agentHome, configureBillionContext, DEFAULT_AGENT_PORT, prepareAgentHome } from './paths.js'

const send = (response, status, value) => {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}
function authenticated(request, token) {
  const supplied = String(request.headers.authorization || '').replace(/^Bearer /, '')
  const expected = Buffer.from(token), actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], rejected = false
    request.on('data', chunk => {
      if (rejected) return
      size += chunk.length
      if (size > 256 * 1024) {
        rejected = true; chunks = []; reject(Object.assign(new Error('工作区资料过大，请减少本次提供的窗口。'), { status: 413 })); return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (rejected) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('请求不是有效 JSON。'), { status: 400 })) }
    })
    request.on('error', reject)
    request.on('aborted', () => reject(new Error('请求已中断。')))
  })
}

export async function startAgentServer({ home = agentHome(), port = DEFAULT_AGENT_PORT, billionContext = true, runtimeFactory } = {}) {
  const externalSessionsRoot = process.env.SULAN_PI_HISTORY_DIR || path.join(process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi/agent'), 'sessions')
  let handler = (_request, response) => send(response, 503, { error: 'Agent 服务正在启动。' })
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  let connection, service
  try {
    connection = await prepareAgentHome(home, `http://127.0.0.1:${server.address().port}`)
    if (billionContext) await configureBillionContext(home)
    service = new AgentService({ home, externalSessionsRoot, billionContext, runtimeFactory })
    await service.ready
  } catch (error) { await new Promise(resolve => server.close(resolve)); throw error }
  handler = async (request, response) => {
    try {
      if (request.headers.origin && request.headers.origin !== connection.endpoint) return send(response, 403, { error: '不接受来自其他网页的 Agent 请求。' })
      if (!authenticated(request, connection.token)) return send(response, 401, { error: 'Agent 连接令牌不匹配，请更新已安装布局或设置页中的 Agent 令牌。' })
      const url = new URL(request.url, connection.endpoint)
      if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true, agent: 'pi', contextEngine: billionContext ? 'billion-context' : 'pi-native' })
      if (request.method === 'GET' && /^\/jobs\/[a-f0-9-]+$/.test(url.pathname)) return send(response, 200, await service.get(url.pathname.split('/')[2]))
      if (request.method !== 'POST') return send(response, 404, { error: '接口不存在。' })
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) return send(response, 415, { error: 'Agent 请求需要 application/json。' })
      const body = await readBody(request)
      if (url.pathname === '/turns') return send(response, 202, await service.start(body))
      if (url.pathname === '/reset') return send(response, 200, await service.reset(body))
      const cancel = /^\/jobs\/([a-f0-9-]+)\/cancel$/.exec(url.pathname)
      if (cancel) return send(response, 200, await service.cancel(cancel[1]))
      send(response, 404, { error: '接口不存在。' })
    } catch (error) { send(response, Number(error.status) || 400, { error: String(error.message || 'Agent 服务请求失败。').slice(0, 400) }) }
  }
  return { server, service, connection,
    async close() {
      const stopped = new Promise(resolve => server.close(resolve))
      await service.close(); server.closeIdleConnections(); await stopped
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), index = args.indexOf('--port')
  const port = index >= 0 ? Number(args[index + 1]) : Number(process.env.SULAN_AGENT_PORT || DEFAULT_AGENT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Agent 端口无效。'); process.exit(1) }
  try {
    const running = await startAgentServer({ port, billionContext: !args.includes('--native-context') })
    console.log(`Sulan Pi Agent: ${running.connection.endpoint}`)
    console.log(`上下文引擎: ${args.includes('--native-context') ? 'Pi native' : 'billion-context'}`)
    console.log('连接令牌保存在用户私有 connection.json；安装布局时会自动读取。')
    let closing = false
    const close = async () => {
      if (closing) return
      closing = true
      await running.close(); process.exit(0)
    }
    process.once('SIGINT', close); process.once('SIGTERM', close)
  } catch (error) { console.error(`无法启动 Agent 服务：${error.message}`); process.exit(1) }
}

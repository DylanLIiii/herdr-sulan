import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const DEFAULT_AGENT_PORT = 3426
export const agentHome = () => path.resolve(process.env.SULAN_AGENT_HOME || path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share'), 'herdr-sulan'))
export const workspaceKey = workspace => createHash('sha256').update(`${workspace.id}\0${workspace.folder}`).digest('hex').slice(0, 24)
export const connectionPath = () => path.join(agentHome(), 'connection.json')
export async function privateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}
export async function prepareAgentHome(home = agentHome(), endpoint = `http://127.0.0.1:${DEFAULT_AGENT_PORT}`) {
  await mkdir(home, { recursive: true, mode: 0o700 })
  await chmod(home, 0o700)
  const file = path.join(home, 'connection.json')
  let token
  try { token = JSON.parse(await readFile(file, 'utf8')).token } catch {}
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) token = randomBytes(32).toString('hex')
  await privateJson(file, { endpoint, token })
  return { home, endpoint, token }
}

// Only this service process receives these overrides. User Pi/bili config files
// and the original PI_CODING_AGENT_DIR remain untouched.
export async function configureBillionContext(home) {
  const configFile = path.join(home, 'billion-context.json')
  let custom = {}
  try { custom = JSON.parse(await readFile(configFile, 'utf8')) } catch {}
  await privateJson(configFile, { ...custom, autoUpdate: false, autoRestartOnUpdate: false,
    logFile: path.join(home, 'billion-context.log'),
    pi: { ...custom.pi, inline: true, subagents: false } })
  process.env.BILI_CONFIG_FILE = configFile
  process.env.BILI_SESSIONS_DIR = path.join(home, 'billion-sessions')
  process.env.BILI_PI_INLINE = '1'
  process.env.BILLION_CONTEXT_PLUGIN = '1'
  process.env.BILI_NATIVE_PI = '1'
  delete process.env.BILI_PROVIDER_REWRITES
  process.env.PI_CODING_AGENT_DIR = path.join(home, 'pi')
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true, mode: 0o700 })
}

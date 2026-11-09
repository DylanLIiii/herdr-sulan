import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const exists = (p) => access(p).then(() => true, () => false)

const MOD_FILES = [
  'main.js',
  'mod.json',
  'sulan.svg',
  'summary.js',
  'brief.js',
  'view.js',
  'model-settings.js',
  'settings-view.js',
  'workspace.js',
  'diagram.js',
  'text.js',
  'chat.js',
  'context.js',
  'llm.js',
  'demo.js',
  'vendor/mermaid-text.js',
  'vendor/LICENSE.beautiful-mermaid',
  'vendor/LICENSE.herdr-app',
]

export async function installSulan({
  home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app'),
  name = 'sulan',
  endpoint = 'http://127.0.0.1:3425/v1/messages',
} = {}) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) {
    throw new Error('Name must use lowercase letters, digits and hyphens, starting with a letter.')
  }
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Endpoint must be an HTTP(S) URL.')
  }

  const destination = resolve(home)
  const layoutPath = join(destination, 'layouts', `${name}.json`)
  const previewPath = join(destination, 'layouts', `${name}.svg`)
  const modDir = join(destination, 'mods', name)

  for (const target of [layoutPath, previewPath, modDir]) {
    if (await exists(target)) {
      throw new Error(`Already exists: ${target}. Choose another --name; existing files are never overwritten.`)
    }
  }

  const layout = JSON.parse(await readFile(join(root, 'layouts', 'sulan.json'), 'utf8'))
  layout.preview = `layouts/${name}.svg`
  const walk = (node) => {
    if (node.content?.mod === 'sulan') {
      node.content.mod = name
      node.content.props = { ...(node.content.props || {}), endpoint: url.href }
    }
    for (const child of node.children || []) walk(child)
  }
  walk(layout)

  await mkdir(join(destination, 'layouts'), { recursive: true })
  await mkdir(join(modDir, 'vendor'), { recursive: true })

  for (const rel of MOD_FILES) {
    if (rel.endsWith('.js') && name !== 'sulan') {
      const src = await readFile(join(root, 'mods', 'sulan', rel), 'utf8')
      await writeFile(join(modDir, rel), src.replaceAll('mods/sulan/', `mods/${name}/`), { flag: 'wx' })
    } else {
      await cp(join(root, 'mods', 'sulan', rel), join(modDir, rel), { force: false, errorOnExist: true })
    }
  }

  for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    await cp(join(root, file), join(modDir, file), { force: false, errorOnExist: true })
  }

  await writeFile(previewPath, await readFile(join(root, 'layouts', 'sulan.svg')), { flag: 'wx' })
  await writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`, { flag: 'wx' })

  return { home: destination, name, modDir, layoutPath, previewPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = {}
  try {
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = { '--home': 'home', '--name': 'name', '--endpoint': 'endpoint' }[process.argv[i]]
      if (!key || !process.argv[i + 1]) {
        throw new Error('Usage: node scripts/install-layout.js [--home DIR] [--name NAME] [--endpoint URL]')
      }
      options[key] = process.argv[i + 1]
    }
    const res = await installSulan(options)
    console.log(
      `Installed ${res.name} into ${res.home}\nVerify with: herdr-app check ${res.modDir}\nSwitch layout with: herdr-app do layout.switch --name ${res.name}`,
    )
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
}

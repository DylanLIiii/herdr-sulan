import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

async function checkDir(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory()) await checkDir(full)
    else if (full.endsWith('.js')) {
      const res = spawnSync(process.execPath, ['--check', full], { stdio: 'inherit' })
      if (res.status) process.exit(res.status)
    }
  }
}

for (const dir of ['mods', 'scripts', 'test']) {
  await checkDir(dir)
}
console.log('JavaScript syntax checks passed.')

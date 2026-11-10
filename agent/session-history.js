import { open, readdir, realpath, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'

// Discover only metadata from a bounded prefix; a multi-month transcript must
// not be read into memory merely to display a session picker.
export async function listSessions(root, folders) {
  let children
  try { children = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const files = []
  for (const child of children) {
    if (child.isFile() && child.name.endsWith('.jsonl')) files.push(path.join(root, child.name))
    if (child.isDirectory()) {
      for (const entry of await readdir(path.join(root, child.name), { withFileTypes: true }).catch(() => [])) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(root, child.name, entry.name))
      }
    }
  }
  const output = []
  for (const file of files) {
    let handle
    try {
      handle = await open(file, 'r')
      const buffer = Buffer.alloc(65536), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const prefix = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
      const records = []
      for (const line of prefix) { try { records.push(JSON.parse(line)) } catch {} }
      const header = records.find(item => item.type === 'session' && item.id && item.cwd)
      if (!header) continue
      const cwd = await realpath(header.cwd).catch(() => path.resolve(header.cwd))
      if (!folders.has(cwd)) continue
      const first = records.find(item => item.type === 'message' && item.message?.role === 'user')?.message
      const firstMessage = typeof first?.content === 'string' ? first.content : first?.content?.find(block => block.type === 'text')?.text || ''
      const metadata = await stat(file)
      output.push({ id: header.id, path: file, cwd, firstMessage: firstMessage.slice(0, 200), modified: metadata.mtime.toISOString() })
    } catch {} finally { await handle?.close() }
  }
  return output
}

// Cursor positions are byte offsets at line boundaries. Reading a late page
// seeks directly to that offset instead of rescanning the entire history.
export async function* sessionEntries(file, start = 0, { signal, end } = {}) {
  const stream = createReadStream(file, { start, end, signal, highWaterMark: 65536 })
  let pending = Buffer.alloc(0), cursor = start, oversized = false, skipped = 0
  try {
    for await (const chunk of stream) {
      pending = Buffer.concat([pending, chunk])
      let newline
      while ((newline = pending.indexOf(10)) >= 0) {
        const length = skipped + newline + 1, nextCursor = cursor + length
        let entry
        if (!oversized) { try { entry = JSON.parse(pending.subarray(0, newline).toString('utf8')) } catch {} }
        else entry = { type: 'oversized', summary: '原始条目超过 2MB；已保留位置，未载入大块二进制或文本。' }
        if (entry) yield { entry, cursor, nextCursor }
        cursor = nextCursor; pending = pending.subarray(newline + 1); oversized = false; skipped = 0
      }
      if (pending.length > 2 * 1024 * 1024) { skipped += pending.length; pending = Buffer.alloc(0); oversized = true }
    }
    if (pending.length && !oversized) {
      try { yield { entry: JSON.parse(pending.toString('utf8')), cursor, nextCursor: cursor + pending.length } } catch {}
    }
  } finally { stream.destroy() }
}

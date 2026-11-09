// Draws the summary's mermaid flowchart as colored box art sized to the pane.
// Approach after prismantis (MIT): render with beautiful-mermaid's ASCII engine,
// pad wide letters so the engine's columns match the terminal's, then read the
// grid back to color each box by the status glyph its label starts with.

import { cells, graphemes, truncate, width, widthOf } from './text.js'
import { renderMermaidAscii } from './vendor/mermaid-text.js'

// A wide letter is followed by this noncharacter while the engine lays out, so
// one code point per cell holds; it's removed from the drawn art
const PAD = '\uFDD0'
// Pads a label inside its box; drawn as a plain space
const NBSP = '\u00A0'
const MAX_LINES = 40
const MAX_CHARS = 3000

const GLYPHS = [
  [/^[✓✔☑]/, 'done', '✓'],
  [/^[◐◑◒◓]/, 'wip', '◐'],
  [/^[✗✘×☒]/, 'fail', '✗'],
  [/^[○◯◌]/, 'todo', '○'],
]

export function statusOfLabel(label) {
  const s = String(label ?? '').trim()
  for (const [re, status] of GLYPHS) if (re.test(s)) return status
  return null
}

// Strips the leading status glyph so the label reads on its own
const bareLabel = (label) => String(label ?? '').trim().replace(/^[✓✔☑◐◑◒◓✗✘×☒○◯◌]\s*/, '')

const NODE = /([A-Za-z_](?:\w|-(?![-.>]))*)\s*(?:\[\[?|\(\(?|\{\{?)\s*"?([^"\]\)\}\n]*?)"?\s*(?:\]\]?|\)\)?|\}\}?)/g

// The nodes a flowchart declares, in order of first appearance
export function flowNodes(source) {
  const seen = new Map()
  for (const m of String(source ?? '').matchAll(NODE)) {
    if (!seen.has(m[1])) seen.set(m[1], m[2].trim())
  }
  return [...seen.values()].filter(Boolean).map((label) => ({ label: bareLabel(label), status: statusOfLabel(label) }))
}

// Parses a Mermaid flowchart into topological layers of nodes and edges for native GPUI rendering
export function flowLayers(source) {
  const lines = String(source ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('```') && !l.startsWith('%%') && !/^(?:flowchart|graph)\b/i.test(l))

  const nodes = new Map()
  const edges = []
  const ensureNode = (id, rawLabel) => {
    if (!id) return
    const clean = rawLabel !== undefined ? String(rawLabel).trim() : id
    if (!nodes.has(id) || (rawLabel !== undefined && nodes.get(id).raw === id)) {
      nodes.set(id, {
        id,
        raw: clean,
        label: bareLabel(clean),
        status: statusOfLabel(clean) ?? 'todo',
      })
    }
  }

  for (const line of lines) {
    for (const m of line.matchAll(NODE)) {
      ensureNode(m[1], m[2])
    }
    // Strip node label brackets so we can parse `id1 -->|label| id2` cleanly
    const stripped = line.replace(/([A-Za-z_](?:\w|-(?![-.>]))*)\s*(?:\[\[?|\(\(?|\{\{?)\s*"?([^"\]\)\}\n]*?)"?\s*(?:\]\]?|\)\)?|\}\}?)/g, '$1')
    const edgeRe = /([A-Za-z_](?:\w|-(?![-.>]))*)\s*(?:-->|-.->|==>|--+)(?:\|([^|\n]*)\|)?\s*([A-Za-z_](?:\w|-(?![-.>]))*)/g
    for (const em of stripped.matchAll(edgeRe)) {
      const from = em[1]
      const edgeLabel = (em[2] ?? '').trim()
      const to = em[3]
      ensureNode(from)
      ensureNode(to)
      edges.push({ from, to, label: edgeLabel })
    }
  }

  if (!nodes.size) return []
  const rank = new Map()
  for (const id of nodes.keys()) rank.set(id, 0)
  for (let iter = 0; iter < nodes.size; iter++) {
    let changed = false
    for (const e of edges) {
      const nextRank = Math.min(nodes.size - 1, (rank.get(e.from) ?? 0) + 1)
      if (nextRank > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, nextRank)
        changed = true
      }
    }
    if (!changed) break
  }

  const byRank = new Map()
  for (const [id, node] of nodes.entries()) {
    const r = rank.get(id) ?? 0
    const incoming = edges.filter((e) => e.to === id && e.label).map((e) => e.label)
    const enriched = { ...node, edgeLabel: incoming[0] || '' }
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r).push(enriched)
  }

  return [...byRank.keys()]
    .sort((a, b) => a - b)
    .map((r) => byRank.get(r))
}

const padWide = (s) => (/^[\x00-\x7F]*$/.test(s) ? s : graphemes(s).map((g) => (g.length === 1 && widthOf(g) === 2 ? g + PAD : g)).join(''))

// Rewrites each [label] or ["label"] of a box node, written back quoted
const mapLabels = (s, fn) => s.replace(/\[\s*"([^"\n]*)"\s*\]|\[\s*([^\]"\n]*?)\s*\]/g, (_, q, p) => `["${fn((q ?? p).trim())}"]`)

// A space on each side of a label, so text doesn't touch the frame
const roomy = (s) => mapLabels(s, (l) => NBSP + l + NBSP)

const capLabels = (s, max) =>
  mapLabels(s, (l) => truncate(l, max)).replace(/\|([^|\n]+)\|/g, (_, l) => `|${truncate(l.trim(), Math.max(2, max - 2))}|`)

const dropEdgeLabels = (s) => s.replace(/\|[^|\n]+\|/g, '')

// Normalizes the header and keeps only flowcharts, drawn top to bottom
function prepare(source) {
  const lines = String(source ?? '')
    .split('\n')
    .filter((l) => !/^\s*```/.test(l) && !/^\s*%%/.test(l))
  const first = lines.findIndex((l) => l.trim())
  if (first < 0) return null
  const head = /^\s*(flowchart|graph)\b\s*(\w+)?/i.exec(lines[first])
  if (!head) return null
  lines[first] = 'flowchart TD'
  return lines.slice(first).join('\n')
}

const ROUND = { '┌': '╭', '┐': '╮', '└': '╰', '┘': '╯' }

function draw(source) {
  try {
    const art = renderMermaidAscii(padWide(source), { colorMode: 'none', paddingX: 3, paddingY: 1, boxBorderPadding: 0 })
    return art
      .replaceAll(PAD, '')
      .replaceAll(NBSP, ' ')
      .replace(/[┌┐└┘]/g, (c) => ROUND[c])
      .replace(/▶/g, '►')
      .replace(/◀/g, '◄')
      .replace(/[ \t]+$/gm, '')
      .split('\n')
      .filter((l) => l.trim())
      .join('\n')
  } catch {
    return null
  }
}

const artWidth = (art) => Math.max(0, ...art.split('\n').map(width))

const LINE = /[─-╿►◄▲▼]/

// Reads the art back into rows of same-colored runs. A run's tone is one of
// done, wip, fail, todo, box (a box with no status), edge, label, text.
export function paint(art) {
  const grid = art.split('\n').map(cells)
  const at = (r, c) => grid[r]?.[c] ?? ''
  const tone = grid.map((row) => row.map(() => null))

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (at(r, c) !== '╭') continue
      let c2 = c + 1
      while (/[─┬┴┼▲▼]/.test(at(r, c2))) c2++
      if (at(r, c2) !== '╮') continue
      let r2 = r + 1
      while (/[│├┤┼►◄]/.test(at(r2, c))) r2++
      if (at(r2, c) !== '╰' || at(r2, c2) !== '╯') continue
      const label = grid.slice(r + 1, r2).map((row) => row.slice(c + 1, c2).join('')).join(' ')
      const status = statusOfLabel(label) ?? 'box'
      for (let y = r; y <= r2; y++) {
        for (let x = c; x <= c2; x++) {
          const ch = at(y, x)
          if (!ch.trim()) continue
          const onFrame = y === r || y === r2 || x === c || x === c2
          // The status glyph and the frame take the status color, the label stays text
          tone[y][x] = onFrame || statusOfLabel(ch) ? status : 'text'
        }
      }
    }
  }

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (tone[r][c] || !grid[r][c].trim()) continue
      tone[r][c] = LINE.test(grid[r][c]) ? 'edge' : 'label'
    }
  }

  return grid.map((row, r) => {
    const runs = []
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '') continue
      const t = ch.trim() ? tone[r][c] : null
      const last = runs[runs.length - 1]
      if (last && last.tone === t) last.text += ch
      else runs.push({ tone: t, text: ch })
    }
    return runs
  })
}

const cache = new Map()

// The flow drawn for a pane `columns` wide:
// { kind: 'art', rows, art, nodes } when the box art fits,
// { kind: 'list', nodes } when it doesn't but its nodes can be read,
// or null when there's nothing to draw.
export function renderFlow(source, columns = 44) {
  if (!source) return null
  const key = columns + '\0' + source
  if (cache.has(key)) return cache.get(key)
  const result = layout(source, columns)
  if (cache.size > 32) cache.delete(cache.keys().next().value)
  cache.set(key, result)
  return result
}

function layout(source, columns) {
  if (source.length > MAX_CHARS || source.split('\n').length > MAX_LINES) return null
  const prepared = prepare(source)
  const nodes = flowNodes(source)
  if (prepared) {
    for (const attempt of [prepared, capLabels(prepared, 12), capLabels(dropEdgeLabels(prepared), 8)]) {
      const art = draw(roomy(attempt))
      if (art && artWidth(art) <= columns) return { kind: 'art', art, rows: paint(art), nodes }
    }
  }
  return nodes.length ? { kind: 'list', nodes } : null
}

// Parses the summary the model writes (the format INSTRUCTIONS.md asks for) into
// a TL;DR, up to six text sections and a flow diagram with its caption.

export const SECTION_ORDER = ['why', 'did', 'out', 'now', 'next', 'terms']

// Headings the model might write instead of the ids, mapped back to the ids
const ALIASES = {
  why: 'why', 目标: 'why', 项目目标: 'why',
  did: 'did', 做了: 'did', 做了什么: 'did', 最新进展: 'did',
  out: 'out', 结论: 'out', 关键结论: 'out',
  now: 'now', 现状: 'now', 当前进展: 'now',
  next: 'next', 需要你: 'next', 下一步: 'next', 接下来: 'next',
  terms: 'terms', glossary: 'terms', 名词: 'terms', 术语: 'terms', 概念: 'terms', 名词与概念: 'terms', 名词解释: 'terms',
  flow: 'flow', 进度: 'flow', 流程: 'flow',
}

const TLDR = /^(?:\*\*)?TL;?DR(?:\*\*)?\s*[:：]\s*(.*)$/i
const HEADING = /^#{1,3}\s*(.+?)\s*$/
const BULLET = /^(?:[-*•]|\d+[.)])\s+(.*)$/
const STATUS = /^\[(done|wip|fail|ask|todo)\]\s*/i
const FENCE = /^```/

export function parseSummary(text) {
  const tldrLines = []
  const sections = new Map()
  const flowLines = []
  const caption = []
  let current = null

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    const tldr = TLDR.exec(trimmed)
    if (tldr) {
      if (tldr[1]) tldrLines.push(tldr[1].trim())
      continue
    }
    const heading = HEADING.exec(trimmed)
    const id = heading && ALIASES[heading[1].toLowerCase()]
    if (id) {
      current = id
      if (id !== 'flow' && !sections.has(id)) sections.set(id, [])
      continue
    }
    if (!current || !trimmed) continue

    if (current === 'flow') {
      if (FENCE.test(trimmed)) continue
      const bullet = /^[-*•]\s+(.*)$/.exec(trimmed)
      if (bullet) caption.push(bullet[1])
      else flowLines.push(line)
      continue
    }

    const bullet = BULLET.exec(trimmed)
    const body = bullet ? bullet[1] : trimmed
    const status = STATUS.exec(body)
    sections.get(current).push({
      status: status ? status[1].toLowerCase() : null,
      text: status ? body.slice(status[0].length).trim() : body,
    })
  }

  const ordered = SECTION_ORDER.filter((id) => {
    const items = sections.get(id)
    if (!items?.length) return false
    if (id === 'terms' && items.length === 1 && /^(无|暂无|none|n\/a)[。.]?$/i.test(items[0].text.trim())) return false
    return true
  }).map((id) => ({ id, items: sections.get(id) }))
  const flow = flowLines.join('\n').trim()
  const tldr = tldrLines.join(' ')
  if (!tldr && ordered.length === 0) return null
  return { tldr, sections: ordered, flow: flow || null, caption }
}

// Splits `code` and **bold** spans out of one line of text
export function inlineSpans(text) {
  const spans = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let at = 0
  const s = String(text ?? '')
  for (const m of s.matchAll(re)) {
    if (m.index > at) spans.push({ text: s.slice(at, m.index) })
    spans.push(m[1] !== undefined ? { text: m[1], code: true } : { text: m[2], bold: true })
    at = m.index + m[0].length
  }
  if (at < s.length) spans.push({ text: s.slice(at) })
  return spans
}

// Counts for the progress bar: the flow's nodes, or else the statuses under "now"
export function progressOf(parsed, flowNodesFn) {
  if (!parsed) return null
  const statuses = parsed.flow && flowNodesFn
    ? flowNodesFn(parsed.flow).map((n) => n.status)
    : (parsed.sections.find((s) => s.id === 'now')?.items ?? []).map((i) => i.status)
  const counted = statuses.filter((s) => s === 'done' || s === 'wip' || s === 'fail' || s === 'todo')
  if (!counted.length) return null
  const n = (k) => counted.filter((s) => s === k).length
  const total = counted.length
  const done = n('done')
  const wip = n('wip')
  const fail = n('fail')
  const todo = n('todo')
  const pct = Math.round((done / total) * 100)
  return { total, done, wip, fail, todo, pct }
}

// Prepare the reading hierarchy once per summary, never on a tab switch.
const EMPTY = /^(?:无|无待办|暂无|无需|没有|none|n\/a)[。.]?$/i
const TITLE = { why: '项目目标', did: '已完成的工作', out: '关键结论', now: '当前进展', next: '接下来', terms: '名词解释' }
const marker = { done: '已完成', wip: '进行中', fail: '需关注', ask: '待你决定', todo: '' }
const itemText = item => `${marker[item.status] ? `**${marker[item.status]}** · ` : ''}${item.text}`
const clean = items => items.filter(i => i.text?.trim() && !EMPTY.test(i.text.trim()))
const list = items => items.map(item => `- ${itemText(item)}`).join('\n')
const shorten = item => ({ ...item, text: item.text.length > 220 ? item.text.slice(0, 217) + '…' : item.text })

export function prepareBrief(parsed) {
  if (!parsed) return { headline: '', attention: '', markdown: '', details: '' }
  const get = id => clean(parsed.sections.find(s => s.id === id)?.items ?? [])
  const attention = [...get('next').filter(i => i.status === 'ask'), ...get('now').filter(i => i.status === 'fail')]
    .slice(0, 2).map(shorten)
  const current = get('now').filter(i => i.status !== 'fail')
  const outcomes = get('out')
  const next = get('next').filter(i => i.status !== 'ask')
  const sections = [
    ['当前进展', (current.length ? current : get('did')).slice(0, 3)],
    ['关键结论', outcomes.slice(0, 2)],
    ['接下来', next.slice(0, 2)],
  ].filter(([, items]) => items.length)
  const details = parsed.sections.filter(s => clean(s.items).length)
    .map(s => `### ${TITLE[s.id] || s.id}\n\n${list(clean(s.items))}`).join('\n\n')
  return {
    headline: parsed.tldr,
    attention: attention.length ? list(attention) : '',
    markdown: sections.map(([title, items]) => `### ${title}\n\n${list(items.map(shorten))}`).join('\n\n'),
    details,
  }
}

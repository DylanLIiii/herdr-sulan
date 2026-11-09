// Display width helpers: a CJK letter or a wide emoji takes two terminal cells.
// Safe on both modern V8 and QuickJS (falls back when Intl.Segmenter is absent).

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
const ZERO = /^[\p{M}\p{Default_Ignorable_Code_Point}]+$/u

export function graphemes(s) {
  const str = String(s ?? '')
  if (/^[ -~]*$/.test(str)) return [...str]
  if (segmenter) return [...segmenter.segment(str)].map((g) => g.segment)
  const out = []
  for (const ch of str) {
    if (ZERO.test(ch) && out.length) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

export const widthOf = (g) => (ZERO.test(g) ? 0 : WIDE.test(g) ? 2 : 1)

export const width = (s) => (/^[ -~]*$/.test(s) ? String(s ?? '').length : graphemes(s).reduce((w, g) => w + widthOf(g), 0))

// One entry per terminal cell: a wide grapheme is followed by '' for its second cell
export const cells = (s) => graphemes(s).flatMap((g) => (widthOf(g) === 2 ? [g, ''] : [g]))

// Cut to at most `max` cells, ending in … when something was cut
export function truncate(s, max) {
  const str = String(s ?? '')
  if (max <= 0) return ''
  if (width(str) <= max) return str
  let out = ''
  let used = 0
  for (const g of graphemes(str)) {
    const w = widthOf(g)
    if (used + w > max - 1) break
    out += g
    used += w
  }
  return out.trimEnd() + '…'
}

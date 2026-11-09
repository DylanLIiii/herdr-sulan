// Runs the real sidebar class against a small instrumented GPUI host.
// Counts native element descriptions and records callbacks without launching Herdr.
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as summary from '../mods/sulan/summary.js'
import * as diagram from '../mods/sulan/diagram.js'
import * as text from '../mods/sulan/text.js'
import * as chat from '../mods/sulan/chat.js'
import * as project from '../mods/sulan/context.js'
import * as llm from '../mods/sulan/llm.js'
import * as demo from '../mods/sulan/demo.js'
import * as brief from '../mods/sulan/brief.js'

export async function createHost(options = {}) {
  let source = await readFile(new URL('../mods/sulan/main.js', import.meta.url), 'utf8')
  source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default class Sulan', 'globalThis.Mod = class Sulan')
  const metrics = { elements: 0, exec: 0, hc: 0, sharedWrites: 0 }
  const storage = new Map()
  const element = (kind = 'div') => {
    metrics.elements++
    const node = { kind, nodes: [], handlers: {}, styles: {} }
    let proxy
    proxy = new Proxy(node, { get(target, key) {
      if (key in target) return target[key]
      if (key === 'when') return (condition, body) => condition ? body(proxy) : proxy
      if (key === 'child') return child => { node.nodes.push(child); return proxy }
      if (key === 'children') return children => { node.nodes.push(...children); return proxy }
      if (String(key).startsWith('on_')) return (...args) => { node.handlers[key] = args.at(-1); return proxy }
      return (...args) => { node.styles[key] = args; return proxy }
    } })
    return proxy
  }
  const focus = { focus() {}, is_focused: () => false }
  const input = { text: '', callbacks: {}, on(event, callback) { this.callbacks[event] = callback }, value() { return this.text }, set_value(value) { this.text = value }, focus() {}, release() {} }
  const timers = []
  const commands = []
  const cx = { notify() {}, stop_propagation() {}, write_to_clipboard() {}, focus_handle: () => focus,
    timer: { every: (ms, callback) => timers.push({ ms, callback, kind: 'every' }), after: (ms, callback) => timers.push({ ms, callback, kind: 'after' }) },
    spawn(callback) { const task = callback(cx); task?.catch?.(error => { commands.push({ error }) }); return task },
  }
  const context = {
    ...summary, ...diagram, ...text, ...chat, ...project, ...llm, ...demo, ...brief,
    completeModel: options.completeModel || llm.completeModel,
    View: class {}, div: () => element(), svg: () => element('svg'), image: () => element('image'),
    h_flex: () => element('row'), v_flex: () => element('column'),
    InputState: { new: () => input }, Input: { new: () => element('input') },
    TextView: { markdown: (id, markdown) => { const el = element('markdown'); el.id = id; el.markdown = markdown; return el } },
    Button: { new: id => { const el = element('button'); el.id = id; return el } },
    Scrollbar: { vertical: () => element('scrollbar') },
    TextareaState: { new: () => input }, Textarea: { new: () => element('textarea') },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    theme: () => new Proxy({}, { get: () => '#789abc' }), settings: () => ({ zoom: 1, font_family: 'JetBrains Mono' }),
    spaces: () => options.spaces ?? [], panes: () => options.panes ?? [], focused: () => options.focused ?? null,
    agents: () => options.agents ?? [], terminals: () => options.terminals ?? [],
    props: () => ({}), layout: () => null, shared: () => null,
    setShared: () => { metrics.sharedWrites++ },
    run: (...args) => commands.push(args), openOverlay() {}, win: () => ({ platform: 'linux', buttons: false }),
    nextCommand: () => new Promise(() => {}), watchFolder: () => new Promise(() => {}),
    exec: async () => { metrics.exec++; return { code: 0, stdout: '', stderr: '' } },
    hc: async () => { metrics.hc++; return { code: 0, stdout: '', stderr: '' } },
    console, Date, Map, Set, JSON,
  }
  const sandbox = vm.createContext(context)
  for (const path of ['view.js', 'workspace.js']) {
    const helper = (await readFile(new URL(`../mods/sulan/${path}`, import.meta.url), 'utf8'))
      .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '').replace(/export function /g, 'function ')
    vm.runInContext(helper, sandbox)
  }
  vm.runInContext(source, sandbox)
  const mod = new context.Mod()
  mod.init({ mode: 'demo', ...options.props }, cx)
  return { mod, cx, metrics, timers, input, commands }
}

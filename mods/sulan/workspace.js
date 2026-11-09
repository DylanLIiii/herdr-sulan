// Adapted from Herdr App defaults/mods/tabs/main.js (Apache-2.0).
// Modified for the Sulan panel toggle. See vendor/LICENSE.herdr-app.
import { div, svg, image } from 'gpui-kit'
import { h_flex } from 'gpui-base'
import { spaces, panes, run, openOverlay, window as win, layout, settings, shared } from 'herdr'

export function findNode(node, id) {
  if (node?.id === id) return node
  for (const child of node?.children ?? []) { const found = findNode(child, id); if (found) return found }
  return null
}

export function renderWorkspaceTabs(view, t) {
  const space = spaces().find(s => s.active), shown = space?.tabs ?? [], all = panes()
  const root = layout(), panel = findNode(root, 'panel'), body = findNode(root, 'panel-body')
  const stop = (_e, cx) => cx.stop_propagation()
  const button = (id, child, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center()
    .rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down('left', stop).on_click(action).child(child)
  // Keep a saved closed state distinct from a Space with no saved selection.
  if (space && panel) {
    const current = panel.hidden ? null : body?.active ?? null
    if (view.activeSpaceId !== space.id) {
      const first = view.activeSpaceId === undefined
      view.activeSpaceId = space.id
      view.pendingPanel = null
      if (!(first && !Object.hasOwn(view.spacePanels, space.id))) {
        const saved = Object.hasOwn(view.spacePanels, space.id) ? view.spacePanels[space.id] : 'sulan'
        const want = ['sulan', 'files', 'changes'].includes(saved) ? saved : null
        if (want !== current) {
          view.pendingPanel = { want, until: Date.now() + 1000 }
          if (want) { run('layout.select', { stack: 'panel-body', child: want }); run('layout.show', { id: 'panel' }) }
          else run('layout.hide', { id: 'panel' })
        }
      }
    }
    if (view.pendingPanel && (view.pendingPanel.want === current || Date.now() >= view.pendingPanel.until)) view.pendingPanel = null
    if (!view.pendingPanel && view.spacePanels[space.id] !== current) {
      view.spacePanels[space.id] = current
      view.savePanelPrefs()
    }
  }
  const item = (tab, index) => {
    const program = all.find(p => p.tab === tab.id && p.program?.agent)?.program ?? all.find(p => p.tab === tab.id)?.program
    const name = /^tb\d+$/.test(tab.name) ? program?.name ?? 'Terminal' : tab.name
    return h_flex().id(`tab-${tab.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(tab.active ? t.border : t.chrome).bg(tab.active ? t.raised : t.chrome)
      .text_color(tab.active ? t.foreground : t.muted).hover(s => s.bg(t.hover))
      .on_mouse_down('left', (e, cx) => { cx.stop_propagation(); view.pressedTab = index; if (e.click_count === 2) run('tab.rename', { id: tab.id }) })
      .on_mouse_up('left', () => {
        const from = view.pressedTab; view.pressedTab = null
        if (from !== null && from !== index && shown[from]) run('tab.move', { id: shown[from].id, index: index + 1 })
        else run('tab.select', { id: tab.id })
      })
      .on_mouse_down('right', (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: 'menu', kind: 'popup', width: 200, props: { tab: 'tab', target: { id: tab.id, space: space.id } } }) })
      .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
      .child(div().max_w(170).truncate().child(name))
      .when(tab.status === 'working', el => el.child(svg('mods/workspace-chrome/spinner.svg').size(12).text_color(t.working).spin(900)))
      .when(tab.status === 'blocked' || tab.status === 'done', el => el.child(div().size(6).rounded(3).bg(t[tab.status])))
      .when(tab.active, el => el.child(button(`close-${tab.id}`, svg('mods/pane/close.svg').size(12), (_e, cx) => { cx.stop_propagation(); run('tab.close', { id: tab.id }) })))
  }
  const panelButton = (id, label, icon) => {
    const on = panel && !panel.hidden && body?.active === id
    return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover(s => s.bg(t.hover))
      .on_mouse_down('left', stop).on_click(() => {
        if (on) run('layout.hide', { id: 'panel' })
        else { run('layout.select', { stack: 'panel-body', child: id }); run('layout.show', { id: 'panel' }) }
      }).child(svg(icon).size(14)).child(label)
  }
  const w = win(), sidebar = findNode(root, 'sidebar')
  const lightsPadding = w?.platform === 'macos' && w.titlebar === 'none' && !w.fullscreen && root?.traffic_lights
    ? Math.max(10, (root.traffic_lights[0] + 64) / (settings().zoom || 1) - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0)) : 10
  const enabled = shared('workspace.panels') ?? ['files', 'changes']
  return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .on_mouse_up('left', () => { view.pressedTab = null })
    .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? 'tab.prev' : 'tab.next') })
    .child(h_flex().id('tab-scroll').flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
    .child(button('tab-new', '+', () => openOverlay({ mod: 'new-menu', kind: 'popup', width: 250, height: 512 })))
    .child(panelButton('sulan', '速览', 'mods/sulan/sulan.svg'))
    .when(enabled.includes('files'), el => el.child(panelButton('files', 'Files', 'mods/files/file.svg')))
    .when(enabled.includes('changes'), el => el.child(panelButton('changes', 'Changes', 'mods/changes/changes.svg')))
    .when(Boolean(w?.buttons), el => el
      .child(button('minimize', '−', () => run('window.minimize')))
      .child(button('maximize', '□', () => run('window.maximize')))
      .child(button('close-window', svg('mods/pane/close.svg').size(13), () => run('window.close'))))
}

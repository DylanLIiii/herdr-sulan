import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './native-host.js'
import { resolveModelSettings, validateModelSettings } from '../mods/sulan/model-settings.js'

const PREFS = 'herdr.sulan.v1:prefs'
const endpoint = 'http://localhost:3425/v1/chat/completions'
const values = { summaryModel: 'group/brief', chatModel: 'group/conversation', endpoint, apiKey: 'example-key', chatEffort: 'high' }
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.nodes ?? []).flatMap(walk)]
const flush = () => new Promise(setImmediate)
const fill = (mod, config = values) => {
  for (const key of ['summaryModel', 'chatModel', 'endpoint', 'apiKey']) mod.settingsInputs[key].set_value(config[key])
  mod.settingsEffort = config.chatEffort
}

test('settings page independently edits both models and masks the API key', async () => {
  const { mod, cx, input } = await createHost()
  mod.draft = '尚未发送的追问'; input.set_value(mod.draft)
  mod.openSettings(cx)
  const nodes = walk(mod.render(cx))
  assert.ok(nodes.some(node => node.styles.id?.[0] === 'sulan-settings-page'))
  assert.ok(nodes.some(node => node.styles.id?.[0] === 'settings-summaryModel'))
  assert.ok(nodes.some(node => node.styles.id?.[0] === 'settings-chatModel'))
  assert.ok(!nodes.some(node => node.kind === 'markdown'), 'opening settings must not build the hidden brief or transcript')
  assert.equal(mod.settingsInputs.apiKey.masked, true)
  const initial = mod.summaryModel
  fill(mod)
  mod.closeSettings(cx)
  assert.equal(mod.summaryModel, initial, 'cancel must not apply draft settings')
  assert.equal(input.value(), '尚未发送的追问')
  mod.openSettings(cx)
  assert.equal(mod.settingsInputs.summaryModel.value(), initial, 'reopening restores the applied values')
  mod.close()
})

test('saving arbitrary routes persists both models, service and effort across a reload', async () => {
  const storage = new Map()
  const first = await createHost({ storage })
  first.mod.openSettings(first.cx); fill(first.mod)
  assert.equal(first.mod.saveSettings(first.cx), true)
  assert.deepEqual(JSON.parse(storage.get(PREFS)), values)
  assert.equal(first.mod.page, 'content')
  first.mod.close()
  const second = await createHost({ storage, props: { summaryModel: 'layout-default', endpoint: 'http://layout/v1/messages' } })
  assert.deepEqual(JSON.parse(JSON.stringify(second.mod.modelConfiguration())), values, 'saved settings override layout defaults')
  second.mod.close()
})

test('old chat-only preferences retain their model and use summary defaults', () => {
  const config = resolveModelSettings({ summaryModel: 'summary-from-layout' }, { chatModel: 'old-chat', chatEffort: 'low' })
  assert.equal(config.summaryModel, 'summary-from-layout')
  assert.equal(config.chatModel, 'old-chat')
  assert.equal(config.chatEffort, 'low')
  assert.equal(resolveModelSettings({}, { apiKey: '' }).apiKey, '', 'an intentionally empty credential must remain empty')
})

test('validation and storage failures do not apply half-saved settings', async () => {
  const options = {}
  const { mod, cx, storage } = await createHost(options)
  const previous = mod.summaryModel
  mod.openSettings(cx); fill(mod, { ...values, summaryModel: '  ' })
  assert.equal(mod.saveSettings(cx), false)
  assert.match(mod.settingsError, /Sulan/)
  assert.equal(storage.has(PREFS), false)
  assert.equal(mod.summaryModel, previous)
  fill(mod)
  options.failWrites = true
  assert.equal(mod.saveSettings(cx), false)
  assert.equal(mod.summaryModel, previous)
  assert.match(mod.settingsError, /无法保存/)
  assert.equal(mod.page, 'settings')
  mod.close()
  for (const address of ['ftp://example/v1/messages', 'http://user:password@host/v1/messages', 'http://host/v1']) {
    assert.throws(() => validateModelSettings({ ...values, endpoint: address }))
  }
})

test('saving sends no request; summary and Side Chat subsequently use their separate saved models', async () => {
  const requests = []
  const { mod, cx } = await createHost({ props: { mode: 'live' },
    spaces: [{ id: 'project', active: true, name: 'Project', folder: '/project', tabs: [] }],
    completeModel: async config => { requests.push(config); return 'TLDR: 重点已整理\n## now\n- [done] 任务已完成' } })
  await flush()
  mod.openSettings(cx); fill(mod); mod.saveSettings(cx)
  assert.equal(requests.length, 0)
  mod.refresh(cx, { forceAi: true }); await flush()
  assert.equal(requests[0].model, 'group/brief')
  assert.equal(requests[0].endpoint, endpoint)
  assert.equal(requests[0].apiKey, 'example-key')
  mod.submitChat(cx, '下一步是什么？'); await flush()
  assert.equal(requests[1].model, 'group/conversation')
  assert.equal(requests[1].effort, 'high')
  assert.equal(requests[1].endpoint, endpoint)
  mod.close()
})

test('an already-started summary keeps its captured model when settings change', async () => {
  const requests = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { mod, cx } = await createHost({ props: { mode: 'live', summaryModel: 'original-model' },
    spaces: [{ id: 'project', active: true, name: 'Project', folder: '/project', tabs: [] }],
    completeModel: async config => { requests.push(config); return 'TLDR: 当前结论\n## now\n- 已完成' } })
  await flush()
  const snapshot = mod.snapshot
  mod.contextRequest = () => gate
  mod.refresh(cx, { forceAi: true })
  mod.openSettings(cx); fill(mod); mod.saveSettings(cx)
  release(snapshot); await flush()
  assert.equal(requests[0].model, 'original-model')
  mod.refresh(cx, { forceAi: true }); await flush()
  assert.equal(requests[1].model, 'group/brief')
  mod.close()
})

test('typing route names in settings cannot trigger sidebar shortcuts', async () => {
  const { mod, cx } = await createHost()
  mod.openSettings(cx)
  const mode = mod.mode, generation = mod.generation
  for (const key of ['d', 'r', 'b', '1', '2', 'enter']) mod.handleKey({ key, modifiers: {} }, cx)
  assert.equal(mod.page, 'settings')
  assert.equal(mod.mode, mode)
  assert.equal(mod.generation, generation)
  mod.handleKey({ key: 'escape' }, cx)
  assert.equal(mod.page, 'content')
  mod.close()
})

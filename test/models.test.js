import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchModels, modelsUrl } from '../mods/sulan/models.js'
import { createHost } from './native-host.js'

const flush = () => new Promise(setImmediate)
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.nodes ?? []).flatMap(walk)]
const button = (mod, cx, id) => walk(mod.render(cx)).find(node => node.id === id)
const choices = [{ id: 'route/summary', label: 'Brief Model' }, { id: 'route/chat', label: 'Conversation Model' }]
const response = data => ({ ok: true, json: async () => data })

test('model discovery derives the service URL, preserves proxy prefixes and uses matching authentication', async () => {
  assert.equal(modelsUrl('https://host/proxy/v1/messages'), 'https://host/proxy/v1/models')
  assert.equal(modelsUrl('https://host/v1/chat/completions'), 'https://host/v1/models')
  for (const suffix of ['messages', 'chat/completions']) {
    let request
    const models = await fetchModels({ endpoint: `https://host/proxy/v1/${suffix}`, apiKey: 'example-key',
      fetchFn: async (url, options) => { request = { url, options }; return response({ data: [
        { id: 'custom/model', display_name: 'Custom Model' }, { id: 'custom/model' }, { id: 'second' }, { id: '' }, { id: 42 },
      ] }) } })
    assert.equal(request.url, 'https://host/proxy/v1/models')
    assert.equal(request.options.method, 'GET')
    assert.equal(request.options.body, undefined, 'discovery must not transmit prompts or project context')
    assert.equal(request.options.headers[suffix === 'messages' ? 'x-api-key' : 'Authorization'], suffix === 'messages' ? 'example-key' : 'Bearer example-key')
    assert.deepEqual(models, [{ id: 'custom/model', label: 'Custom Model' }, { id: 'second', label: 'second' }])
  }
})

test('discovery reads paginated responses, encodes cursors and rejects repeating pagination', async () => {
  const urls = []
  const models = await fetchModels({ endpoint: 'https://host/v1/messages', fetchFn: async url => {
    urls.push(url)
    return response(urls.length === 1 ? { data: [{ id: 'provider/model' }], has_more: true, last_id: 'provider/model' }
      : { data: [{ id: 'next' }], has_more: false })
  } })
  assert.equal(urls[1], 'https://host/v1/models?after_id=provider%2Fmodel')
  assert.equal(models.length, 2)
  await assert.rejects(fetchModels({ fetchFn: async () => response({ data: [{ id: 'same' }], has_more: true }) }), /分页无效/)
})

test('empty, invalid and failed responses have distinct outcomes without echoing error bodies', async () => {
  assert.deepEqual(await fetchModels({ fetchFn: async () => response({ data: [] }) }), [])
  await assert.rejects(fetchModels({ fetchFn: async () => response({ error: 'no data' }) }), /格式无效/)
  await assert.rejects(fetchModels({ fetchFn: async () => ({ ok: true, json: async () => { throw new Error('bad json') } }) }), /有效 JSON/)
  await assert.rejects(fetchModels({ fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ message: 'private-example' }) }) }), error => /HTTP 401/.test(error.message) && !error.message.includes('private-example'))
  await assert.rejects(fetchModels({ fetchFn: async () => { throw new Error('private-example') } }), /无法连接模型服务/)
})

test('opening settings loads the service list and selects summary and chat independently', async () => {
  const requests = []
  const { mod, cx } = await createHost({ fetchModels: async config => { requests.push(config); return choices } })
  mod.openSettings(cx); await flush()
  assert.equal(requests.length, 1)
  assert.equal(mod.modelsStatus, 'ready')
  mod.toggleModelPicker('summaryModel', cx)
  mod.modelSearchInput.set_value('brief'); mod.modelSearchInput.callbacks.change({}, cx)
  button(mod, cx, 'settings-summaryModel-choice-0').handlers.on_click({}, cx)
  mod.toggleModelPicker('chatModel', cx)
  mod.modelSearchInput.set_value('CONVERSATION'); mod.modelSearchInput.callbacks.change({}, cx)
  button(mod, cx, 'settings-chatModel-choice-0').handlers.on_click({}, cx)
  assert.equal(mod.settingsInputs.summaryModel.value(), 'route/summary')
  assert.equal(mod.settingsInputs.chatModel.value(), 'route/chat')
  assert.equal(mod.saveSettings(cx), true)
  assert.equal(mod.summaryModel, 'route/summary')
  assert.equal(mod.chatModel, 'route/chat')
  mod.openSettings(cx); await flush()
  assert.equal(requests.length, 1, 'unchanged settings reuse the in-memory list')
  mod.close()
})

test('large model lists render bounded results and search includes entries beyond the first page', async () => {
  const models = Array.from({ length: 500 }, (_, index) => ({ id: `model-${index}`, label: `Model ${index}` }))
  const { mod, cx } = await createHost({ fetchModels: async () => models })
  mod.openSettings(cx); await flush(); mod.toggleModelPicker('summaryModel', cx)
  let nodes = walk(mod.render(cx))
  assert.equal(nodes.filter(node => node.kind === 'button' && String(node.id).startsWith('settings-summaryModel-choice-')).length, 40)
  mod.modelSearchInput.set_value('499'); mod.modelSearchInput.callbacks.change({}, cx)
  button(mod, cx, 'settings-summaryModel-choice-0').handlers.on_click({}, cx)
  assert.equal(mod.settingsInputs.summaryModel.value(), 'model-499')
  mod.close()
})

test('changing the unsaved service invalidates old results and uses the new address and key', async () => {
  const pending = []
  const { mod, cx } = await createHost({ fetchModels: config => new Promise(resolve => pending.push({ config, resolve })) })
  mod.openSettings(cx)
  const originalSummary = mod.settingsInputs.summaryModel.value()
  mod.settingsInputs.endpoint.set_value('https://new-service/v1/messages')
  mod.settingsInputs.apiKey.set_value('new-example-key')
  mod.settingsInputs.endpoint.callbacks.change({}, cx)
  assert.equal(mod.modelsStatus, 'idle')
  mod.loadModels(cx)
  assert.equal(pending[1].config.endpoint, 'https://new-service/v1/messages')
  assert.equal(pending[1].config.apiKey, 'new-example-key')
  pending[1].resolve(choices); await flush()
  pending[0].resolve([{ id: 'old-service-model', label: 'Old' }]); await flush()
  assert.equal(mod.modelChoices[0].id, 'route/summary')
  assert.equal(mod.settingsInputs.summaryModel.value(), originalSummary, 'loading must never replace a selected model')
  mod.close()
})

test('a timed-out or closed picker ignores late results and leaves manual model entry available', async () => {
  const pending = []
  const { mod, cx, timers } = await createHost({ fetchModels: () => new Promise(resolve => pending.push(resolve)) })
  mod.openSettings(cx)
  timers.find(timer => timer.ms === 20000).callback(cx)
  assert.equal(mod.modelsStatus, 'error')
  pending[0](choices); await flush()
  assert.equal(mod.modelsStatus, 'error')
  mod.settingsInputs.summaryModel.set_value('manual/model')
  mod.loadModels(cx, { force: true })
  mod.closeSettings(cx)
  pending[1](choices); await flush()
  assert.equal(mod.modelsStatus, 'idle')
  assert.equal(mod.summaryModel.includes('manual/model'), false, 'closing without Save still discards model changes')
  mod.close()
})

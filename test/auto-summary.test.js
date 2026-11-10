import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './native-host.js'

const flush = () => new Promise(setImmediate)
const reply = title => `TLDR: ${title}\n## now\n- [done] 已核对终端证据\n## next\n- 继续观察进展`
function projectOptions(extra = {}) {
  let now = 100000
  const calls = []
  const options = { props: { mode: 'live', autoUpdate: true }, now: () => now,
    spaces: [{ id: 's', active: true, name: 'Project', folder: '/project', tabs: [{ id: 't' }] }],
    agents: [{ address: 'a', space: 's', tab: 't', title: '第一阶段', status: 'working' }],
    completeModel: async config => { calls.push(config); return reply('自动结论 ' + calls.length) }, ...extra }
  return { options, calls, time: value => { now = value } }
}
const tick = async host => { host.timers.find(timer => timer.kind === 'every' && timer.ms === 10000).callback(host.cx); await flush() }

test('live project evidence generates the first AI brief automatically and unchanged polling is free', async () => {
  const f = projectOptions(), host = await createHost(f.options)
  await flush()
  assert.equal(f.calls.length, 1)
  assert.equal(host.mod.summarySource, 'ai')
  assert.match(host.mod.summary, /自动结论 1/)
  for (const at of [110000, 140000, 170000]) { f.time(at); await tick(host) }
  assert.equal(f.calls.length, 1, 'unchanged evidence must never regenerate just because time passes')
  host.mod.close()
})

test('follow-up model IO waits for the owning native View callback after context collection', async () => {
  const f = projectOptions({ manualViewTicks: true }), host = await createHost(f.options)
  await flush()
  assert.equal(f.calls.length, 0, 'a collector continuation must not start IO in another Mod scope')
  assert.equal(host.mod.viewWork.length, 1)
  host.timers.find(timer => timer.kind === 'every' && timer.ms === 250).callback(host.cx)
  await flush()
  assert.equal(f.calls.length, 1)
  assert.equal(host.mod.summarySource, 'ai')
  host.mod.close()
})

test('changes are coalesced during the cooldown and update without a user click', async () => {
  const f = projectOptions(), host = await createHost(f.options); await flush()
  f.options.agents[0].title = '第二阶段'; f.time(110000); await tick(host)
  assert.equal(f.calls.length, 1)
  assert.match(host.mod.note, /自动更新/)
  f.options.agents[0].title = '第三阶段'; f.time(130001); await tick(host)
  assert.equal(f.calls.length, 2)
  assert.match(f.calls[1].prompt, /第三阶段/)
  assert.match(host.mod.summary, /自动结论 2/)
  host.mod.close()
})

test('an unchanged cached brief survives reload without another generation, while new evidence still refreshes it', async () => {
  const storage = new Map(), f = projectOptions({ storage })
  const first = await createHost(f.options); await flush(); first.mod.close()
  const second = await createHost(f.options); await flush()
  assert.equal(f.calls.length, 1)
  f.options.agents[0].status = 'done'; await tick(second)
  assert.equal(f.calls.length, 2)
  second.mod.close()
})

test('automatic failures retry with backoff and recover without manual refresh', async () => {
  let attempts = 0
  const f = projectOptions({ completeModel: async () => { if (++attempts < 3) throw new Error('temporary gateway failure'); return reply('恢复后的结论') } })
  const host = await createHost(f.options); await flush()
  assert.equal(attempts, 1)
  f.time(110000); await tick(host); assert.equal(attempts, 1)
  f.time(130001); await tick(host); assert.equal(attempts, 2)
  f.time(160001); await tick(host); assert.equal(attempts, 2)
  f.time(190002); await tick(host); assert.equal(attempts, 3)
  assert.match(host.mod.summary, /恢复后的结论/)
  assert.equal(host.mod.isError, false)
  host.mod.close()
})

test('a timed-out automatic request cannot overwrite a later automatic recovery', async () => {
  const old = Promise.withResolvers(); let calls = 0
  const f = projectOptions({ completeModel: async () => ++calls === 1 ? old.promise : reply('当前有效结论') })
  const host = await createHost(f.options); await flush()
  f.time(160001); host.timers.filter(timer => timer.ms === 60000).at(-1).callback(host.cx)
  assert.equal(host.mod.busy(), false)
  f.time(190002); await tick(host)
  assert.match(host.mod.summary, /当前有效结论/)
  old.resolve(reply('迟到内容')); await flush()
  assert.doesNotMatch(host.mod.summary, /迟到内容/)
  assert.equal(calls, 2)
  host.mod.close()
})

test('automatic generation keeps the displayed brief, draft and expanded reading state until its replacement is ready', async () => {
  const pending = Promise.withResolvers(); let calls = 0
  const f = projectOptions({ completeModel: async () => ++calls === 1 ? reply('上一版结论') : pending.promise })
  const host = await createHost(f.options); await flush()
  host.mod.draft = '尚未发送'; host.input.set_value(host.mod.draft); host.mod.detailsOpen = true
  f.options.agents[0].title = '新进展'; f.time(130001); await tick(host)
  assert.match(host.mod.summary, /上一版结论/)
  assert.equal(host.mod.summarizing, true)
  pending.resolve(reply('新版结论')); await flush()
  assert.match(host.mod.summary, /新版结论/)
  assert.equal(host.input.value(), '尚未发送')
  assert.equal(host.mod.detailsOpen, true)
  host.mod.close()
})

test('empty projects and hidden settings do not trigger needless background generations', async () => {
  const empty = projectOptions({ agents: [] }), first = await createHost(empty.options); await flush()
  assert.equal(empty.calls.length, 0); first.mod.close()
  const f = projectOptions(), host = await createHost(f.options); await flush()
  host.mod.openSettings(host.cx); f.options.agents[0].title = '新进展'; f.time(130001); await tick(host)
  assert.equal(f.calls.length, 1)
  host.mod.closeSettings(host.cx); await tick(host)
  assert.equal(f.calls.length, 2)
  host.mod.close()
})

const unconfirmed = status => `压缩状态未确认落盘${status ? `（HTTP ${status}）` : ''}；原始 Pi 会话仍保留。`

// Inline bili debounces disk writes and does not own the host's shutdown.
// Its documented replica API flushes the resident session before returning.
// Remove only this temporary checkpoint; the persisted session remains intact.
export async function persistContext({ sessionId, enabled = true, origin = process.env.BILLION_CONTEXT_PROXY,
  fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!enabled || !origin || !sessionId) return ''
  const base = origin.replace(/\/+$/, '')
  const save = async () => {
    const response = await fetchFn(base + '/__bili/replicas', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, label: 'sulan-turn-persist', pinned: false }) })
    if (response.status === 404) return '' // The SDK used its native fallback.
    if (!response.ok) return unconfirmed(response.status)
    const checkpoint = (await response.json()).replica?.cpId
    if (typeof checkpoint !== 'string' || !checkpoint) return unconfirmed()
    const removed = await fetchFn(base + '/__bili/replicas/' + encodeURIComponent(checkpoint), { method: 'DELETE' })
    return removed.ok ? '' : '压缩状态已保存，但临时检查点清理未完成。'
  }
  let timer
  try {
    return await Promise.race([save(), new Promise(resolve => { timer = setTimeout(() => resolve(unconfirmed()), timeoutMs) })])
  } catch { return unconfirmed() }
  finally { clearTimeout(timer) }
}

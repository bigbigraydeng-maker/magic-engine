// Device-side watch of the Remotion render engine. An unreadable check is not healthy.

export const RENDER_WORKER_UNREADABLE = '读不到'

export function watchRenderWorker(problems) {
  if (!Array.isArray(problems)) {
    return { ok: false, watched: false, reason: RENDER_WORKER_UNREADABLE }
  }
  const lines = problems.filter((line) => typeof line === 'string' && line.trim())
  if (problems.length > 0 && lines.length === 0) {
    return { ok: false, watched: false, reason: RENDER_WORKER_UNREADABLE }
  }
  if (lines.length === 0) return { ok: true, watched: true }
  return { ok: false, watched: true, reason: lines.join('；').slice(0, 500) }
}

export function pingRenderWorker(watch) {
  if (!watch || typeof watch !== 'object') return { ok: false, reason: RENDER_WORKER_UNREADABLE }
  if (watch.ok === true && watch.watched === true) return { ok: true }
  if (watch.ok === false) {
    const reason = typeof watch.reason === 'string' && watch.reason.trim()
      ? watch.reason.trim().slice(0, 500)
      : RENDER_WORKER_UNREADABLE
    return { ok: false, reason }
  }
  return { ok: false, reason: RENDER_WORKER_UNREADABLE }
}

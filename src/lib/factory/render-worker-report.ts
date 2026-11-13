// What the device reports about the render engine. A missing field is not "healthy".

export const UNREADABLE = '读不到'

export type RenderWorkerReport = { ok: true } | { ok: false; reason: string }

export function parseRenderWorkerField(body: Record<string, unknown>): RenderWorkerReport | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, 'render_worker')) return undefined
  const raw = body.render_worker
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: UNREADABLE }
  const record = raw as Record<string, unknown>
  if (record.ok === true) return { ok: true }
  if (record.ok === false) {
    const reason = typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim().slice(0, 500)
      : UNREADABLE
    return { ok: false, reason }
  }
  return { ok: false, reason: UNREADABLE }
}

export interface AlivePing {
  summary: {
    client_ids?: string[] | null
    render_worker?: unknown
    engine_stale?: boolean
    engine_notice?: string
  } | null
}

/** Reason text when this client's latest pings say the render engine is down. */
export function renderWorkerDownReason(pings: readonly AlivePing[], clientId: string): string | null {
  const id = clientId.toLowerCase()
  const reasons: string[] = []
  for (const ping of pings) {
    const ids = ping.summary?.client_ids ?? []
    if (!ids.some((item) => item.toLowerCase() === id)) continue
    const report = ping.summary?.render_worker
    if (report == null) continue
    if (typeof report !== 'object' || Array.isArray(report)) {
      reasons.push(UNREADABLE)
      continue
    }
    const record = report as Record<string, unknown>
    if (record.ok === true) continue
    if (record.ok === false) {
      reasons.push(typeof record.reason === 'string' && record.reason.trim() ? record.reason.trim() : UNREADABLE)
      continue
    }
    reasons.push(UNREADABLE)
  }
  if (reasons.length === 0) return null
  return Array.from(new Set(reasons)).join('；').slice(0, 500)
}

// Automatic dead-letter rerun. A person can still use the revive button.
// This does not approve a work order and does not put anything in the creative pool.

export const AUTO_RERUN_LIMIT = 2
export const UNREADABLE = '读不到'
export const HELD_FROM_AUTO_RERUN = ['90506421', '3f79a2ce'] as const

export interface DeadLetterRow {
  id: string
  client_id: string
  reject_reason: unknown
  review_ref: unknown
  brief: unknown
  reclaim_count: unknown
}

export type FailureClass = 'missing_file' | 'worker_offline' | 'too_large' | 'other' | 'unreadable'

export type RerunAction =
  | { action: 'rerun'; id: string; clientId: string; nextCount: number; reclaimCount: number; reason: string }
  | { action: 'hold'; id: string; clientId: string }
  | { action: 'escalate'; id: string; clientId: string; reason: string; reruns: number }
  | { action: 'unread'; id: string; clientId: string; reason: typeof UNREADABLE }

export function isHeldWorkOrder(id: string, prefixes: readonly string[] = HELD_FROM_AUTO_RERUN): boolean {
  const norm = id.toLowerCase()
  return prefixes.some((prefix) => prefix.length > 0 && norm.startsWith(prefix.toLowerCase()))
}

export function classifyFailure(reason: unknown): FailureClass {
  if (typeof reason !== 'string' || !reason.trim()) return 'unreadable'
  const text = reason.toLowerCase()
  if (/413|too large|entity too large|payload too large|文件太大|max size|50\s?mb/.test(text)) return 'too_large'
  if (/enoent|no such file|missing file|missing local|缺文件|本地素材|素材文件|local file/.test(text)) {
    return 'missing_file'
  }
  if (/worker offline|worker not running|渲染工人|引擎未就绪|econnrefused|remotion/.test(text)) return 'worker_offline'
  return 'other'
}

function readCount(reviewRef: unknown): number | 'unreadable' {
  if (reviewRef == null) return 0
  if (typeof reviewRef !== 'object' || Array.isArray(reviewRef)) return 'unreadable'
  const raw = (reviewRef as Record<string, unknown>).auto_rerun_count
  if (raw == null) return 0
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return 'unreadable'
  return raw
}

function readReclaim(value: unknown): number | 'unreadable' {
  if (value == null) return 0
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  return 'unreadable'
}

function needsReplan(brief: unknown): boolean | 'unreadable' {
  if (brief == null) return false
  if (typeof brief !== 'object' || Array.isArray(brief)) return 'unreadable'
  return (brief as Record<string, unknown>).recipe_replan_required === true
}

export function planDeadLetter(row: DeadLetterRow, prefixes: readonly string[] = HELD_FROM_AUTO_RERUN): RerunAction {
  if (isHeldWorkOrder(row.id, prefixes)) return { action: 'hold', id: row.id, clientId: row.client_id }
  const count = readCount(row.review_ref)
  const reclaim = readReclaim(row.reclaim_count)
  const replan = needsReplan(row.brief)
  if (count === 'unreadable' || reclaim === 'unreadable' || replan === 'unreadable') {
    return { action: 'unread', id: row.id, clientId: row.client_id, reason: UNREADABLE }
  }
  const failure = classifyFailure(row.reject_reason)
  if (failure === 'unreadable') return { action: 'unread', id: row.id, clientId: row.client_id, reason: UNREADABLE }
  const reason = (row.reject_reason as string).trim()
  if (failure === 'too_large' || failure === 'other' || replan || count >= AUTO_RERUN_LIMIT) {
    return { action: 'escalate', id: row.id, clientId: row.client_id, reason, reruns: count }
  }
  return {
    action: 'rerun',
    id: row.id,
    clientId: row.client_id,
    nextCount: count + 1,
    reclaimCount: reclaim + 1,
    reason,
  }
}

export function nextReviewRef(current: unknown, count: number, reason: string, at: string): Record<string, unknown> {
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {}
  return {
    ...base,
    auto_rerun_count: count,
    auto_rerun_at: at,
    auto_rerun_prev_reject: reason,
    revived_by: 'factory-dead-letter-rerun',
  }
}

export interface DeadLetterStore {
  list(): Promise<{ ok: true; rows: DeadLetterRow[] } | { ok: false; reason: string }>
  rerun(action: Extract<RerunAction, { action: 'rerun' }>, at: string): Promise<{ ok: true } | { ok: false; reason: string }>
}

export interface RerunSummary {
  ok: boolean
  dryRun: boolean
  processed: number
  rerun: number
  planned: number
  escalated: number
  held: number
  unread: number
  failed: number
  reason?: string
}

export async function runDeadLetterRerun(
  store: DeadLetterStore,
  options: { dryRun: boolean; at?: string; heldPrefixes?: readonly string[] } = { dryRun: false },
): Promise<RerunSummary> {
  const listed = await store.list()
  if (!listed.ok) {
    return { ok: false, dryRun: options.dryRun, processed: 0, rerun: 0, planned: 0, escalated: 0, held: 0, unread: 0, failed: 1, reason: listed.reason || UNREADABLE }
  }
  const summary = emptySummary(options.dryRun, listed.rows.length)
  const at = options.at ?? new Date().toISOString()
  for (const row of listed.rows) {
    const plan = planDeadLetter(row, options.heldPrefixes)
    if (plan.action === 'hold') summary.held += 1
    else if (plan.action === 'escalate') summary.escalated += 1
    else if (plan.action === 'unread') summary.unread += 1
    else if (!options.dryRun) await applyRerun(store, plan, at, summary)
    else summary.planned += 1
  }
  summary.failed += summary.unread
  if (summary.unread > 0 && summary.reason == null) summary.reason = UNREADABLE
  summary.ok = summary.failed === 0 && summary.reason == null
  return summary
}

function emptySummary(dryRun: boolean, processed: number): RerunSummary {
  return { ok: true, dryRun, processed, rerun: 0, planned: 0, escalated: 0, held: 0, unread: 0, failed: 0 }
}

async function applyRerun(
  store: DeadLetterStore,
  plan: Extract<RerunAction, { action: 'rerun' }>,
  at: string,
  summary: RerunSummary,
): Promise<void> {
  const wrote = await store.rerun(plan, at)
  if (wrote.ok) {
    summary.rerun += 1
    return
  }
  summary.failed += 1
  summary.ok = false
  summary.reason = wrote.reason || UNREADABLE
}

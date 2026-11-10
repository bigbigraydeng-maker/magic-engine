/**
 * Read-only view model: executed budget / pause cards and their post-window verdict.
 */
import {
  BUDGET_CARD_ACTION,
  PAUSE_CARD_ACTION,
  observationDue,
  readExecutedReview,
  type ReviewAction,
} from '@/lib/flywheel/attribution/executed-review'

export const EXECUTION_REVIEW_DEFAULT_LIMIT = 15

export type ExecutionReviewPhase = 'pending' | 'concluded' | 'incomplete'

export type ExecutionVerdictUi = 'improved' | 'worse' | 'unsure'

export interface ExecutionReviewItem {
  readonly action_id: string
  readonly kind: 'budget' | 'pause'
  readonly kind_label: string
  readonly executed_at: string | null
  readonly executed_at_display: string
  readonly observation_window_days: number | null
  readonly phase: ExecutionReviewPhase
  readonly phase_label: string
  readonly what_done: string | null
  readonly before_display: string | null
  readonly after_display: string | null
  readonly verdict: ExecutionVerdictUi | null
  readonly verdict_label: string | null
  readonly reason: string | null
  readonly summary: string | null
}

export interface AdsExecutionReviewPanel {
  readonly client_id: string
  readonly limit: number
  readonly generated_at: string
  readonly items: ExecutionReviewItem[]
}

const VERDICT_ZH: Record<ExecutionVerdictUi, string> = {
  improved: '变好',
  worse: '变差',
  unsure: '判不了',
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function moneyFromCents(cents: unknown): string | null {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) return null
  return (cents / 100).toFixed(2)
}

function statusWord(value: unknown): string | null {
  if (value === 'ACTIVE') return '在投'
  if (value === 'PAUSED') return '已暂停'
  return null
}

function formatExecutedAt(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(t))
}

function reviewCaseOf(payload: Record<string, unknown> | null): {
  verdict: ExecutionVerdictUi
  reason: string | null
  text: string
} | null {
  const row = record(payload?.reviewCase)
  if (!row) return null
  const verdictRaw = row.verdict
  const verdict = verdictRaw === 'improved' || verdictRaw === 'worse' || verdictRaw === 'unsure' ? verdictRaw : null
  const body = text(row.text)
  if (!verdict || !body) return null
  return { verdict, reason: text(row.reason), text: body }
}

function whatDoneFromPayload(actionType: string, payload: Record<string, unknown>): string | null {
  const before = moneyFromCents(payload.beforeCents)
  const after = moneyFromCents(payload.afterCents)
  if (before !== null && after !== null) {
    return `日预算从 ${before} 调到 ${after}`
  }
  const left = statusWord(payload.before)
  const right = statusWord(payload.after)
  if (actionType === PAUSE_CARD_ACTION) {
    if (left && right) return `从${left}改成${right}`
    return '暂停了这一组'
  }
  const line = text(payload.resultLine)
  return line
}

function beforeAfterFromPayload(payload: Record<string, unknown>): { before: string | null; after: string | null } {
  const before = moneyFromCents(payload.beforeCents) ?? statusWord(payload.before)
  const after = moneyFromCents(payload.afterCents) ?? statusWord(payload.after)
  return { before, after }
}

function beforeAfterFromOutcome(
  baseline: number | null,
  after: number | null,
): { before: string | null; after: string | null } {
  if (baseline === null && after === null) return { before: null, after: null }
  const fmt = (n: number | null) => (n === null ? null : String(Math.round(n * 100) / 100))
  return { before: fmt(baseline), after: fmt(after) }
}

function pendingLabel(windowDays: number): string {
  return `第 ${windowDays} 天出结论`
}

export interface RawExecutionRow {
  readonly id: string
  readonly action_type: string | null
  readonly executed_at: string | null
  readonly payload: Record<string, unknown> | null
  readonly outcome_baseline: number | null
  readonly outcome_after: number | null
}

function asReviewAction(row: RawExecutionRow): ReviewAction {
  return {
    id: row.id,
    client_id: '',
    action_type: row.action_type,
    payload: row.payload,
    expected_metric: null,
    executed_at: row.executed_at,
  }
}

export function buildExecutionReviewItem(row: RawExecutionRow, now: Date): ExecutionReviewItem | null {
  const actionType = row.action_type
  if (actionType !== BUDGET_CARD_ACTION && actionType !== PAUSE_CARD_ACTION) return null
  const payload = record(row.payload)
  if (!payload || payload.status !== 'executed') return null

  const kind = actionType === BUDGET_CARD_ACTION ? 'budget' as const : 'pause' as const
  const kind_label = kind === 'budget' ? '调日预算' : '暂停广告组'
  const read = readExecutedReview(asReviewAction(row))
  const windowDays = read.kind === 'ready' ? read.review.observationWindowDays : null
  const executedAt = text(row.executed_at)

  const reviewCase = reviewCaseOf(payload)
  const payloadBa = beforeAfterFromPayload(payload)
  const outcomeBa = beforeAfterFromOutcome(row.outcome_baseline, row.outcome_after)

  let phase: ExecutionReviewPhase = 'incomplete'
  let phase_label = '观察信息不齐，还出不了结论'
  let verdict: ExecutionVerdictUi | null = null
  let reason: string | null = null
  let summary: string | null = reviewCase?.text ?? null

  if (read.kind === 'ready' && executedAt && windowDays !== null) {
    if (!observationDue(executedAt, windowDays, now)) {
      phase = 'pending'
      phase_label = pendingLabel(windowDays)
    } else if (reviewCase) {
      phase = 'concluded'
      phase_label = '观察期已满'
      verdict = reviewCase.verdict
      reason = reviewCase.reason
    } else {
      phase = 'concluded'
      phase_label = '观察期已满，结论还没写上'
    }
  }

  const what_done = whatDoneFromPayload(actionType, payload)
  const before_display = payloadBa.before ?? outcomeBa.before
  const after_display = payloadBa.after ?? outcomeBa.after

  return {
    action_id: row.id,
    kind,
    kind_label,
    executed_at: executedAt,
    executed_at_display: formatExecutedAt(executedAt),
    observation_window_days: windowDays,
    phase,
    phase_label,
    what_done,
    before_display,
    after_display,
    verdict,
    verdict_label: verdict ? VERDICT_ZH[verdict] : null,
    reason,
    summary,
  }
}

export function buildAdsExecutionReviewPanel(input: {
  clientId: string
  rows: readonly RawExecutionRow[]
  limit: number
  now: Date
}): AdsExecutionReviewPanel {
  const items = input.rows
    .map((row) => buildExecutionReviewItem(row, input.now))
    .filter((item): item is ExecutionReviewItem => item !== null)
  return {
    client_id: input.clientId,
    limit: input.limit,
    generated_at: input.now.toISOString(),
    items,
  }
}

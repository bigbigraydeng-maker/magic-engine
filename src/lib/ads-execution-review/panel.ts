/**
 * Read-only view model: budget / pause card post-execution review (plain Chinese).
 */
import {
  BUDGET_CARD_ACTION,
  PAUSE_CARD_ACTION,
  observationDue,
  readExecutedReview,
  windowSpanOf,
  type ReviewAction,
} from '@/lib/flywheel/attribution/executed-review'

export const EXECUTION_REVIEW_DEFAULT_LIMIT = 12

const METRIC_LABEL: Readonly<Record<string, string>> = {
  'ads.account.cpa': '获客成本',
  'ads.account.cost_per_lead': '每个留资的成本',
  'ads.account.cost_per_conversation': '每次开口的成本',
  'ads.account.spend': '花费',
  'ads.account.roas': '广告回报',
  'ads.account.ctr': '点击率',
  'ads.account.cpc': '每次点击的成本',
  'ads.account.clicks': '点击次数',
  'ads.account.impressions': '展示次数',
  'ads.account.conversions': '结果数',
}

const VERDICT_ZH: Readonly<Record<'improved' | 'worse' | 'unsure', string>> = {
  improved: '变好',
  worse: '变差',
  unsure: '判不了',
}

export type ExecutionReviewKind = 'budget' | 'pause'

export interface ExecutionReviewMetricRow {
  readonly label: string
  readonly before: string | null
  readonly after: string | null
}

export interface AdsExecutionReviewItem {
  readonly id: string
  readonly kind: ExecutionReviewKind
  readonly kind_label: string
  readonly unit_label: string | null
  readonly executed_at: string | null
  readonly executed_at_display: string
  readonly what_done: string | null
  readonly pending_label: string | null
  readonly verdict: 'improved' | 'worse' | 'unsure' | null
  readonly verdict_label: string | null
  readonly reason: string | null
  readonly summary: string | null
  readonly metrics: ExecutionReviewMetricRow[] | null
}

export interface AdsExecutionReviewPanel {
  readonly client_id: string
  readonly limit: number
  readonly generated_at: string
  readonly items: AdsExecutionReviewItem[]
}

export interface ExecutionReviewActionRow {
  readonly id: string
  readonly action_type: string | null
  readonly executed_at: string | null
  readonly expected_metric: string | null
  readonly payload: Record<string, unknown> | null
}

export interface ExecutionReviewOutcomeRow {
  readonly action_id: string
  readonly metric_key: string
  readonly window_days: number
  readonly baseline: number | null
  readonly after_value: number | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseReviewCase(payload: Record<string, unknown> | null): {
  verdict: 'improved' | 'worse' | 'unsure'
  reason: string | null
  text: string
} | null {
  const row = record(payload?.reviewCase)
  if (!row) return null
  const verdict = row.verdict
  if (verdict !== 'improved' && verdict !== 'worse' && verdict !== 'unsure') return null
  const summary = text(row.text)
  if (!summary) return null
  return { verdict, reason: text(row.reason), text: summary }
}

function kindOf(actionType: string | null): ExecutionReviewKind | null {
  if (actionType === BUDGET_CARD_ACTION) return 'budget'
  if (actionType === PAUSE_CARD_ACTION) return 'pause'
  return null
}

function kindLabel(kind: ExecutionReviewKind): string {
  return kind === 'budget' ? '调日预算' : '暂停广告组'
}

function unitLabel(payload: Record<string, unknown> | null, kind: ExecutionReviewKind): string | null {
  const order = record(payload?.order)
  if (kind === 'budget') {
    const name = text(order?.name)
    return name && !looksLikeId(name) ? name : '一个广告组'
  }
  return '一个广告组'
}

function looksLikeId(value: string): boolean {
  return /^act_|^\d{10,}$/i.test(value.trim())
}

function whatDone(payload: Record<string, unknown> | null, reviewCase: ReturnType<typeof parseReviewCase>): string | null {
  if (reviewCase) {
    const first = reviewCase.text.split(/[。！？]/)[0]?.trim()
    if (first) return first.endsWith('。') ? first : `${first}。`
  }
  const line = text(payload?.resultLine)
  if (line) return line
  const before = cents(payload?.beforeCents)
  const after = cents(payload?.afterCents)
  if (before !== null && after !== null) {
    return `日预算从 ${money(before)} 调到 ${money(after)}。`
  }
  const left = statusWord(payload?.before)
  const right = statusWord(payload?.after)
  if (left && right) return `广告组从${left}改成${right}。`
  return null
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function money(centsValue: number): string {
  return `$${(centsValue / 100).toFixed(2)}`
}

function statusWord(value: unknown): string | null {
  if (value === 'ACTIVE') return '在投'
  if (value === 'PAUSED') return '已暂停'
  return null
}

function fmtMetric(value: number | null): string | null {
  if (value === null) return null
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

function metricLabel(key: string | null): string {
  if (!key) return '观察指标'
  return METRIC_LABEL[key] ?? '观察指标'
}

function observationDayIndex(executedAt: string, windowDays: number, now: Date): number {
  const start = Date.parse(executedAt)
  if (Number.isNaN(start)) return 1
  const dayMs = 86_400_000
  const elapsed = Math.floor((now.getTime() - start) / dayMs)
  return Math.min(windowDays, Math.max(1, elapsed + 1))
}

export function formatExecutionTimeNz(iso: string | null): string {
  if (iso === null) return '时间未知'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '时间未知'
  return new Date(t).toLocaleString('zh-CN', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function asReviewAction(row: ExecutionReviewActionRow): ReviewAction {
  return {
    id: row.id,
    client_id: '',
    action_type: row.action_type,
    payload: row.payload,
    expected_metric: row.expected_metric,
    executed_at: row.executed_at,
  }
}

function pickOutcome(
  outcomes: readonly ExecutionReviewOutcomeRow[],
  actionId: string,
  metric: string | null,
  windowDays: number | null,
): ExecutionReviewOutcomeRow | null {
  if (!metric || windowDays === null) return null
  const match = outcomes.find(
    (row) => row.action_id === actionId && row.metric_key === metric && row.window_days === windowDays,
  )
  return match ?? null
}

function buildMetrics(
  metric: string | null,
  outcome: ExecutionReviewOutcomeRow | null,
  payload: Record<string, unknown> | null,
): ExecutionReviewMetricRow[] | null {
  const rows: ExecutionReviewMetricRow[] = []
  const label = metricLabel(metric)
  if (outcome && (outcome.baseline !== null || outcome.after_value !== null)) {
    rows.push({
      label,
      before: fmtMetric(outcome.baseline),
      after: fmtMetric(outcome.after_value),
    })
  }
  const before = cents(payload?.beforeCents)
  const after = cents(payload?.afterCents)
  if (before !== null || after !== null) {
    rows.push({
      label: '日预算',
      before: before !== null ? money(before) : null,
      after: after !== null ? money(after) : null,
    })
  }
  const left = statusWord(payload?.before)
  const right = statusWord(payload?.after)
  if (left || right) {
    rows.push({
      label: '投放状态',
      before: left,
      after: right,
    })
  }
  return rows.length > 0 ? rows : null
}

export function buildAdsExecutionReviewItem(
  row: ExecutionReviewActionRow,
  outcomes: readonly ExecutionReviewOutcomeRow[],
  now: Date,
): AdsExecutionReviewItem | null {
  const kind = kindOf(row.action_type)
  if (!kind) return null
  const payload = record(row.payload)
  if (!payload || payload.status !== 'executed') return null

  const reviewCase = parseReviewCase(payload)
  const action = asReviewAction(row)
  const opened = readExecutedReview(action)
  const span = windowSpanOf(action)
  const windowDays = opened.kind === 'ready' ? opened.review.observationWindowDays : span?.observationWindowDays ?? null
  const metric = opened.kind === 'ready' ? opened.review.metric : text(row.expected_metric)
  const executedAt = text(row.executed_at) ?? (span ? span.executedAt : null)
  const due = executedAt !== null && windowDays !== null ? observationDue(executedAt, windowDays, now) : false

  let pendingLabel: string | null = null
  if (executedAt && windowDays !== null && !due) {
    pendingLabel = `第 ${observationDayIndex(executedAt, windowDays, now)} 天出结论`
  } else if (due && !reviewCase) {
    pendingLabel = '观察期已过，结论还没写上'
  }

  const outcome = pickOutcome(outcomes, row.id, metric, windowDays)
  const verdict = reviewCase?.verdict ?? null
  const verdictLabel = verdict ? VERDICT_ZH[verdict] : null

  return {
    id: row.id,
    kind,
    kind_label: kindLabel(kind),
    unit_label: unitLabel(payload, kind),
    executed_at: executedAt,
    executed_at_display: formatExecutionTimeNz(executedAt),
    what_done: whatDone(payload, reviewCase),
    pending_label: pendingLabel,
    verdict,
    verdict_label: verdictLabel,
    reason: reviewCase?.reason ?? null,
    summary: reviewCase?.text ?? null,
    metrics: buildMetrics(metric, outcome, payload),
  }
}

export function buildAdsExecutionReviewPanel(input: {
  clientId: string
  limit: number
  now: Date
  actions: readonly ExecutionReviewActionRow[]
  outcomes: readonly ExecutionReviewOutcomeRow[]
}): AdsExecutionReviewPanel {
  const items = input.actions
    .map((row) => buildAdsExecutionReviewItem(row, input.outcomes, input.now))
    .filter((item): item is AdsExecutionReviewItem => item !== null)
  return {
    client_id: input.clientId,
    limit: input.limit,
    generated_at: input.now.toISOString(),
    items,
  }
}

import { ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { computeOutcomeVerdict } from '@/lib/flywheel/attribution/job'

export const O1_BUDGET_FIRST_REVIEW_HOURS = 72
export const O1_BUDGET_OUTCOME_WINDOW_DAYS = 14

export type O1BudgetGoalMetric = {
  key: 'leads_count' | 'messaging_started'
  column: 'leads' | 'messaging_conversations'
  label: string
}

export type O1BudgetMetricRow = {
  insight_date: string
  leads: number | null
  messaging_conversations: number | null
}

export type O1BudgetMetricPeriod = {
  start: string
  end: string
  days: number
  total: number
  daily: Array<{ date: string; value: number }>
}

export function resolveO1BudgetGoalMetric(key: string): O1BudgetGoalMetric | null {
  if (key === 'leads_count') return { key, column: 'leads', label: '广告线索' }
  if (key === 'messaging_started') return { key, column: 'messaging_conversations', label: '已开始的广告对话' }
  return null
}

export function shiftO1BudgetDate(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Every day in the requested interval must have a stored value; missing rows are never treated as zero. */
export function sumO1BudgetMetricPeriod(
  rows: readonly O1BudgetMetricRow[],
  metric: O1BudgetGoalMetric | null,
  start: string,
  end: string,
): O1BudgetMetricPeriod | null {
  if (!metric || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return null
  const byDate = new Map<string, number>()
  for (const row of rows) {
    const raw = row[metric.column]
    if (row.insight_date < start || row.insight_date > end || raw === null || raw === undefined) continue
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || byDate.has(row.insight_date)) return null
    byDate.set(row.insight_date, value)
  }

  const daily: O1BudgetMetricPeriod['daily'] = []
  for (let date = start; date <= end; date = shiftO1BudgetDate(date, 1)) {
    const value = byDate.get(date)
    if (value === undefined) return null
    daily.push({ date, value })
  }
  return { start, end, days: daily.length, total: daily.reduce((sum, point) => sum + point.value, 0), daily }
}

export type O1BudgetObservationConclusion = 'keep' | 'request_restore' | 'continue_observing'

export function concludeO1BudgetObservation(input: {
  readonly baseline: O1BudgetMetricPeriod | null
  readonly after: O1BudgetMetricPeriod | null
  readonly metric: O1BudgetGoalMetric | null
  readonly targetDirection: 'increase' | 'decrease' | null
  readonly baselineFresh: boolean
  readonly now: Date
  readonly firstReviewAt: string
  readonly windowComplete: boolean
  readonly receiptVerified: boolean
  readonly budgetMatchesThisRun: boolean
}): { conclusion: O1BudgetObservationConclusion; reason: string; delta: number | null; deltaPct: number | null; confidence: number | null } {
  const keepObserving = (reason: string) => ({ conclusion: 'continue_observing' as const, reason, delta: null, deltaPct: null, confidence: null })

  if (!input.receiptVerified) return keepObserving('执行或 Meta 预算回读尚未验证成功，不能评估这次调整。')
  if (!input.metric || !input.targetDirection) return keepObserving('当前增长目标没有可由此广告目标可靠读取的 KPI，继续观察，不作效果结论。')
  if (!input.baselineFresh) return keepObserving('执行前 KPI 基线已超出 O1 现有 36 小时新鲜度窗口，不能评估这次调整。')
  if (!input.baseline) return keepObserving('调整前的 KPI 日数据不完整，不能比较前后变化。')
  if (!input.budgetMatchesThisRun) return keepObserving('最近的预算快照无法确认仍是本次审批金额；可能有后续外部变更，暂不归因或建议恢复。')
  const nowMs = input.now.getTime()
  const firstReviewMs = Date.parse(input.firstReviewAt)
  if (!Number.isFinite(firstReviewMs) || nowMs < firstReviewMs) return keepObserving('专属观察期尚未到首次复查时间（执行后 72 小时）。')
  if (!input.after) return keepObserving('首次复查已到；14 天观察窗口的数据尚未完整，继续观察。')
  if (!input.windowComplete) return keepObserving('指标已有阶段数据；14 天观察窗口尚未结束，继续观察后再下结论。')

  const delta = input.after.total - input.baseline.total
  const deltaPct = input.baseline.total === 0 ? null : delta / Math.abs(input.baseline.total) * 100
  const result = computeOutcomeVerdict(
    ADS_METRIC_KEY.CONVERSIONS,
    delta,
    deltaPct,
    input.targetDirection === 'increase' ? 1 : -1,
  )
  if (result.verdict === 'confirmed') {
    return { conclusion: 'keep', reason: '目标 KPI 按现有归因阈值改善；保留本次预算，变化不代表因果证明。', delta, deltaPct, confidence: result.confidence }
  }
  if (result.verdict === 'reversed') {
    return { conclusion: 'request_restore', reason: '目标 KPI 按现有归因阈值朝目标相反方向变化；建议负责人走现有人工审批入口请求恢复，不会自动改预算。', delta, deltaPct, confidence: result.confidence }
  }
  return { conclusion: 'continue_observing', reason: '现有归因阈值将此变化判为不确定；继续观察，不把预算读回当成效果证明。', delta, deltaPct, confidence: result.confidence }
}

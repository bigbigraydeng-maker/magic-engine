/**
 * 每周对账 —— 纯函数。输入「计划 + 事实」，输出几行「计划值 / 实际值 / 状态」和一句头条。
 *
 * 设计稿 §4.5。规则：
 *  - 对账窗口 = 最近 7 个完整的自然日，往前再让出 insightsUnstableDays 天（平台会回补，
 *    排除最近不稳定的天，免得每次对账都显示"落后"）；
 *  - 日期一律是「账户时区的今天」（调用方用 account-timezone 算好传入）；时区读不到，
 *    花费那一行判 unknown，不静默按 UTC 比；
 *  - 读不到的事实一律 unknown，不当 0、不当绿；
 *  - 头条取最差的一行：花费或结果任一核心行是 unknown，就不能写「基本按计划」；
 *  - 结果的「计划值」复用 goal-pace 的线性节奏，不拿整个目标期的目标值当本周分母；
 *  - Meta 自报结果与目标进度分两行并列，永不合并成一个数；
 *  - 实际花费是该广告账户的全部花费（含非本计划的广告），行里明说。
 */

import { computeGoalPace } from '@/lib/ads-strategy/goal-pace'
import { unreadWeeklySpendReason, type AccountSpendTotal } from '@/lib/ads/spend-figures'
import type { PromoPlaybook } from './playbooks'
import type { AdsStep, PromoSpec } from './spec'
import { allAdsSteps } from './spec'

export type RowStatus = 'on_track' | 'behind' | 'over' | 'unknown' | 'immature' | 'info'

export interface ReconcileRow {
  key: 'spend' | 'results_goal' | 'results_meta' | 'content'
  label: string
  planned: number | null
  actual: number | null
  unit: string
  status: RowStatus
  reason: string
  as_of: string | null
}

export interface GoalFact {
  status: string
  target_value: number | null
  baseline_value: number | null
  period_start: string
  period_end: string
  current_value: number | null
  current_value_fetched_at: string | null
}

export interface ReconcileFacts {
  /** 账户 → 日期 → 当天花费（分）。整个读失败 = null */
  spend_cents_by_account_day: Record<string, Record<string, number>> | null
  /** 窗口内 Meta 自报的结果数合计；读不到 = null */
  meta_results: number | null
  goal: GoalFact | null
  /** 窗口内已发布的内容条数；读不到 = null */
  content_published: number | null
  /** 广告数据最近一次入库时间（ISO） */
  insights_as_of: string | null
  /** 账户时区是否已确定（false → 花费行 unknown） */
  timezone_known: boolean
  /**
   * 广告数据页同一份账户合计（meta_ads_snapshots）。
   * 本周逐日花费读不到时写进原因，说明另一页的数字是哪一段；不当成这一周的实际花费。
   */
  account_total?: AccountSpendTotal | null
}

export interface Reconciliation {
  window: { start: string; end: string }
  week_index: number | null
  rows: ReconcileRow[]
  headline: string
  /** 头条是否算"看不清" */
  blind: boolean
}

// ─── 日期工具（字符串上做 UTC 日历加减，无 DST 问题）──────────────────────────────

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function* eachDay(start: string, end: string): Generator<string> {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d
}

export function reconcileWindow(today: string, unstableDays: number): { start: string; end: string } {
  const end = addDays(today, -1 - unstableDays)
  return { start: addDays(end, -6), end }
}

// ─── 计划花费 ──────────────────────────────────────────────────────────────────

function stepActiveOn(step: AdsStep, phaseStart: string, phaseEnd: string, day: string): boolean {
  if (day < phaseStart || day > phaseEnd) return false
  return !step.settings.paused_ranges.some(r => day >= r.from && day <= r.to)
}

/** 窗口内每个有效广告步骤的日预算 × 有效天数，按账户汇总（分）。 */
export function plannedSpendCents(spec: PromoSpec, win: { start: string; end: string }): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { phase, step } of allAdsSteps(spec)) {
    for (const day of eachDay(win.start, win.end)) {
      if (stepActiveOn(step, phase.start_date, phase.end_date, day)) {
        out[step.settings.ad_account_id] = (out[step.settings.ad_account_id] ?? 0) + step.settings.daily_budget_cents
      }
    }
  }
  return out
}

// ─── 行 ────────────────────────────────────────────────────────────────────────

function spendRow(spec: PromoSpec, win: { start: string; end: string }, f: ReconcileFacts, pb: PromoPlaybook): ReconcileRow | null {
  const planned = plannedSpendCents(spec, win)
  const plannedTotal = Object.values(planned).reduce((a, b) => a + b, 0)
  const hasAds = allAdsSteps(spec).length > 0
  if (!hasAds) return null
  const base = { key: 'spend' as const, label: '广告花费（该账户全部广告，含非本计划）', unit: '分', as_of: f.insights_as_of }
  if (!f.timezone_known) {
    return { ...base, planned: plannedTotal, actual: null, status: 'unknown', reason: '广告账户时区未确定，不能按天核对花费' }
  }
  if (f.spend_cents_by_account_day === null) {
    return { ...base, planned: plannedTotal, actual: null, status: 'unknown', reason: unreadWeeklySpendReason(f.account_total) }
  }
  if (plannedTotal === 0) {
    return { ...base, planned: 0, actual: null, status: 'unknown', reason: '这个窗口内没有生效的广告步骤（可能在暂停区间或阶段之外）' }
  }
  // 实际花费只算计划生效的那几天（阶段内、不在暂停区间），和计划口径一致
  const activeDays = new Set<string>()
  for (const { phase, step } of allAdsSteps(spec)) {
    for (const day of eachDay(win.start, win.end)) {
      if (stepActiveOn(step, phase.start_date, phase.end_date, day)) activeDays.add(`${step.settings.ad_account_id}|${day}`)
    }
  }
  let actual = 0
  for (const key of activeDays) {
    const [acc, day] = key.split('|')
    actual += f.spend_cents_by_account_day[acc]?.[day] ?? 0
  }
  const ratio = actual / plannedTotal
  const pct = Math.round(ratio * 100)
  if (ratio < pb.behindBelowRatio) return { ...base, planned: plannedTotal, actual, status: 'behind', reason: `实际是计划的 ${pct}%，低于 ${Math.round(pb.behindBelowRatio * 100)}%` }
  if (ratio > pb.spendOverRatio) return { ...base, planned: plannedTotal, actual, status: 'over', reason: `实际是计划的 ${pct}%，高于 ${Math.round(pb.spendOverRatio * 100)}%` }
  return { ...base, planned: plannedTotal, actual, status: 'on_track', reason: `实际是计划的 ${pct}%` }
}

function goalRow(spec: PromoSpec, today: string, f: ReconcileFacts, pb: PromoPlaybook): ReconcileRow {
  const base = { key: 'results_goal' as const, label: '目标进度', unit: '', as_of: f.goal?.current_value_fetched_at ?? null }
  const g = f.goal
  if (!g) return { ...base, planned: null, actual: null, status: 'unknown', reason: '读不到目标，目标进度未核对' }
  if (g.status !== 'active') return { ...base, planned: null, actual: null, status: 'unknown', reason: `目标不适用（状态：${g.status}）` }
  const planStart = [...spec.phases].map(p => p.start_date).sort()[0]
  const planEnd = [...spec.phases].map(p => p.end_date).sort().slice(-1)[0]
  if (g.period_end < planStart || g.period_start > planEnd) {
    return { ...base, planned: null, actual: null, status: 'unknown', reason: '目标周期与计划周期不重叠，目标不适用' }
  }
  if (g.target_value === null || g.baseline_value === null) {
    return { ...base, planned: null, actual: null, status: 'unknown', reason: '目标缺少起点或目标值' }
  }
  const fetchedDay = g.current_value_fetched_at?.slice(0, 10) ?? null
  if (fetchedDay === null || daysBetween(fetchedDay, today) > pb.factFreshnessDays) {
    return { ...base, planned: null, actual: null, status: 'unknown', reason: `目标数据已超过 ${pb.factFreshnessDays} 天没更新（或没有更新时间），不能判断进度` }
  }
  const elapsed = daysBetween(g.period_start, today) + 1
  const pace = computeGoalPace({
    targetValue: g.target_value, baselineValue: g.baseline_value,
    periodStart: g.period_start, periodEnd: g.period_end, today,
    actualToDate: g.current_value, dailyCapCents: null, medianCostPerResultCents7d: null,
  })
  const row = { ...base, planned: pace.expectedToDate, actual: pace.actualToDate }
  if (pace.verdict === 'unknown') return { ...row, status: 'unknown', reason: pace.reason }
  // 结果有滞后：目标期刚开始的几天不判落后，只说"未成熟"
  if (elapsed < pb.resultMaturityDays && pace.verdict !== 'on_track') {
    return { ...row, status: 'immature', reason: `目标期才第 ${elapsed} 天，结果还没到该看的时候（${pace.reason}）` }
  }
  if (pace.verdict === 'on_track') return { ...row, status: 'on_track', reason: pace.reason }
  return { ...row, status: 'behind', reason: pace.reason }
}

function metaRow(f: ReconcileFacts): ReconcileRow {
  return {
    key: 'results_meta', label: '广告平台自报结果（近 7 天，仅供参考）', planned: null, actual: f.meta_results, unit: '',
    status: f.meta_results === null ? 'unknown' : 'info',
    reason: f.meta_results === null ? '广告平台结果读不出来' : '与上面的目标进度是两个口径，不相加、不互相替代',
    as_of: f.insights_as_of,
  }
}

function contentRow(spec: PromoSpec, win: { start: string; end: string }, f: ReconcileFacts, pb: PromoPlaybook): ReconcileRow | null {
  let planned = 0
  let any = false
  for (const phase of spec.phases) {
    if (phase.end_date < win.start || phase.start_date > win.end) continue
    for (const s of phase.steps) {
      if (s.kind !== 'social_cadence') continue
      any = true
      planned += s.settings.posts_per_week + s.settings.stories_per_week + Math.round((s.settings.reels_per_month * 7) / 30)
    }
  }
  if (!any) return null
  const base = { key: 'content' as const, label: '本周发布的社媒内容', unit: '条', as_of: null as string | null }
  if (f.content_published === null) return { ...base, planned, actual: null, status: 'unknown', reason: '已发布内容条数读不出来' }
  if (planned === 0) return { ...base, planned, actual: f.content_published, status: 'info', reason: '计划里没有安排社媒条数' }
  const ratio = f.content_published / planned
  return ratio < pb.behindBelowRatio
    ? { ...base, planned, actual: f.content_published, status: 'behind', reason: `只发了计划的 ${Math.round(ratio * 100)}%` }
    : { ...base, planned, actual: f.content_published, status: 'on_track', reason: `发了计划的 ${Math.round(ratio * 100)}%` }
}

// ─── 对账 ──────────────────────────────────────────────────────────────────────

export function reconcileWeek(spec: PromoSpec, today: string, f: ReconcileFacts, pb: PromoPlaybook): Reconciliation {
  const win = reconcileWindow(today, pb.insightsUnstableDays)
  const planStart = [...spec.phases].map(p => p.start_date).sort()[0]
  const week_index = today < planStart ? null : Math.floor(daysBetween(planStart, today) / 7) + 1

  const rows = [spendRow(spec, win, f, pb), goalRow(spec, today, f, pb), metaRow(f), contentRow(spec, win, f, pb)]
    .filter((r): r is ReconcileRow => r !== null)

  if (week_index === null) {
    return { window: win, week_index, rows, headline: `计划还没开始（${planStart} 开始）`, blind: false }
  }

  // 头条取最差的一行：花费或目标进度（核心行）读不到 → 看不清
  const core = rows.filter(r => r.key === 'spend' || r.key === 'results_goal')
  const blindRows = core.filter(r => r.status === 'unknown')
  if (blindRows.length > 0) {
    return {
      window: win, week_index, rows, blind: true,
      headline: `第 ${week_index} 周 · 本周看不清：${blindRows.map(r => `${r.label.split('（')[0]}（${r.reason}）`).join('；')}`,
    }
  }
  const bad = rows.filter(r => r.status === 'behind' || r.status === 'over')
  if (bad.length > 0) {
    const names = bad.map(r => `${r.label.split('（')[0]}${r.status === 'over' ? '超出' : '落后'}`).join('、')
    return { window: win, week_index, rows, blind: false, headline: `第 ${week_index} 周 · ${names}，要你决定 1 件事` }
  }
  const immature = rows.some(r => r.status === 'immature')
  return {
    window: win, week_index, rows, blind: false,
    headline: `第 ${week_index} 周 · 基本按计划${immature ? '（结果还没到该看的时候）' : ''}`,
  }
}

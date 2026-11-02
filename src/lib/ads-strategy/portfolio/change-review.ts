/**
 * 广告改动回看（Agent 闭环升级第 1 步，docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md §5 第 1 步）。
 *
 * 每天看「正好满 7 天」的设置改动——快照看到的暂停 / 开启 / 加减日预算，人在 Ads Manager 里手改的也算——
 * 拿改动前 7 天和改动后 7 天比，判「变好 / 变差 / 持平 / 止损成立 / 停掉了达标的组 / 说不清」。
 * 说不清的原因只能从固定清单里选（§4），单独统计，不算进「有结论」。
 *
 * 纯函数：只读诊断输入里已有的东西（近 28 天日数据 + 近 35 天快照算出的设置变化 + 客户的「广告结果怎么算」），
 * 不查库、不改传进来的任何东西。
 *
 * 🔴 本步只影子跑：结果只进每日任务的运行日志（`cron_run_logs.summary.change_review`），
 *    不写结论表、不进待办和日报。PM 看过影子结果回「开」才另开改动单写进 flywheel_outcomes。
 * 🔴 判的是「改完之后数字怎么变」，不是因果证明：同一时间别的改动、季节、素材疲劳都可能是原因。
 */

import { countOutcome } from './outcome-ladder'
import { scopeAccountToClient } from './diagnostics/ownership'
import { shiftDate } from './diagnostics/context'
import type { AccountInput, DailyRow, DiagnosisInput, SettingChange, SettingChangeKind } from './diagnostics/types'

/** 改动前后各看几天（不含改动当天） */
export const CHANGE_REVIEW_WINDOW_DAYS = 7
/** 前后两段各至少几个主结果才比单次成本 */
export const CHANGE_REVIEW_MIN_PRIMARY = 5
/** 单次成本降到改前的这个比例以下 = 变好 */
export const CHANGE_REVIEW_BETTER_RATIO = 0.8
/** 单次成本升到改前的这个比例以上 = 变差 */
export const CHANGE_REVIEW_WORSE_RATIO = 1.2
/** 暂停前 7 天花了「目标单次成本 × 这个倍数」还零结果 = 止损成立（跟 D3 同一个直觉：花了两单的钱一单没有） */
export const PAUSE_WASTE_TARGET_MULTIPLE = 2

const MAX_SAMPLES = 5

export type ChangeReviewVerdict = 'better' | 'worse' | 'flat' | 'stop_loss_justified' | 'paused_a_performer' | 'inconclusive'

/** 说不清的固定原因清单 */
export type ChangeReviewInconclusiveReason =
  | 'no_outcome_config' // 「广告结果怎么算」没设置
  | 'no_target_cost' // 暂停要跟目标单次成本比，没设置
  | 'too_few_results' // 前后结果太少，比不出来
  | 'cost_above_target' // 暂停前有结果、但单次成本高于目标：停得有道理，算不上止损
  | 'changed_again' // 观察期里又改过（这个组或它的系列），分不清是哪次改的
  | 'data_missing' // 结果数归不上（例如私信来源还没接通）

export interface ChangeReview {
  ad_account_id: string
  level: 'campaign' | 'adset'
  entity_id: string
  kind: Exclude<SettingChangeKind, 'other'>
  /** 改动那天（账户时区） */
  changed_on: string
  verdict: ChangeReviewVerdict
  reason?: ChangeReviewInconclusiveReason
  before: { spend: number; primary: number | null }
  after: { spend: number; primary: number | null }
}

export interface ChangeReviewSummary {
  /** 今天满 7 天、拿来回看的改动数（不含只改了别的字段的、不含暂停前就没花钱的） */
  reviewed: number
  /** 暂停前 7 天就没花钱（清理用的暂停）：不用回看，只计数。2026-11-03 回放：36 处里 12 处是这种 */
  skipped_no_spend: number
  /** 有结论的（说不清以外） */
  decided: number
  by_verdict: Record<ChangeReviewVerdict, number>
  /** 说不清的各原因计数 */
  inconclusive_reasons: Partial<Record<ChangeReviewInconclusiveReason, number>>
  samples: ChangeReview[]
}

type Span = { spend: number; primary: number | null }

/** UTC 时刻落在账户时区的哪一天。时区缺失按 UTC。 */
export function localDay(iso: string, tz: string | null): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso))
  const get = (k: string) => p.find(x => x.type === k)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function sumSpan(rows: readonly DailyRow[], input: DiagnosisInput, optimizationGoal: string | null): Span {
  const primaryStep = input.outcome.primary
  let spend = 0
  let primary: number | null = 0
  for (const r of rows) {
    spend += r.spend
    if (primaryStep === null) { primary = null; continue }
    const c = countOutcome(primaryStep, r, { messagingReferralAvailable: input.messagingReferralAvailable, optimizationGoal })
    primary = c.value === null || primary === null ? null : primary + c.value
  }
  return { spend, primary }
}

function rowsBetween(account: AccountInput, change: SettingChange, from: string, to: string): DailyRow[] {
  return account.daily.filter(r =>
    r.level === change.level && r.entity_id === change.entity_id && r.insight_date >= from && r.insight_date <= to)
}

/** 调用方已经排除了暂停前没花钱的（见 reviewAccount）。 */
function judgePause(before: Span, target: number | null): Pick<ChangeReview, 'verdict' | 'reason'> {
  if (target === null) return { verdict: 'inconclusive', reason: 'no_target_cost' }
  if (before.primary === null) return { verdict: 'inconclusive', reason: 'data_missing' }
  if (before.primary === 0) {
    return before.spend >= PAUSE_WASTE_TARGET_MULTIPLE * target
      ? { verdict: 'stop_loss_justified' }
      : { verdict: 'inconclusive', reason: 'too_few_results' }
  }
  if (before.spend / before.primary <= target) return { verdict: 'paused_a_performer' }
  return { verdict: 'inconclusive', reason: 'cost_above_target' }
}

function judgeCostChange(before: Span, after: Span, changedAgain: boolean): Pick<ChangeReview, 'verdict' | 'reason'> {
  if (changedAgain) return { verdict: 'inconclusive', reason: 'changed_again' }
  if (before.primary === null || after.primary === null) return { verdict: 'inconclusive', reason: 'data_missing' }
  if (before.primary < CHANGE_REVIEW_MIN_PRIMARY || after.primary < CHANGE_REVIEW_MIN_PRIMARY) {
    return { verdict: 'inconclusive', reason: 'too_few_results' }
  }
  const ratio = (after.spend / after.primary) / (before.spend / before.primary)
  if (ratio < CHANGE_REVIEW_BETTER_RATIO) return { verdict: 'better' }
  if (ratio > CHANGE_REVIEW_WORSE_RATIO) return { verdict: 'worse' }
  return { verdict: 'flat' }
}

/** 一个（已切成只剩客户自己的）账户里，今天正好满 7 天的改动逐条回看。 */
function reviewAccount(account: AccountInput, input: DiagnosisInput): { reviews: ChangeReview[]; skippedNoSpend: number } {
  const changedOn = shiftDate(input.date, -CHANGE_REVIEW_WINDOW_DAYS)
  const tz = account.timezone
  const own = new Map(account.snapshots
    .filter(s => s.level === 'campaign' || s.level === 'adset')
    .map(s => [`${s.level}:${s.entity_id}`, s]))
  const changes = (account.settingChanges ?? []).map(c => ({ c, day: localDay(c.captured_at, tz) }))

  const out: ChangeReview[] = []
  let skippedNoSpend = 0
  const seen = new Set<string>()
  for (const { c, day } of changes) {
    if (day !== changedOn || (c.level !== 'campaign' && c.level !== 'adset')) continue
    if (!c.kind || c.kind === 'other') continue
    const snap = own.get(`${c.level}:${c.entity_id}`)
    if (!snap) continue // 不是客户自己的（或已经不在了），不判
    const key = `${c.level}:${c.entity_id}:${c.kind}`
    if (seen.has(key)) continue // 同一天同一处来回改了几次，只看一次
    seen.add(key)

    const before = sumSpan(rowsBetween(account, c, shiftDate(day, -CHANGE_REVIEW_WINDOW_DAYS), shiftDate(day, -1)), input, snap.optimization_goal ?? null)
    if (c.kind === 'pause' && before.spend <= 0) { skippedNoSpend += 1; continue }
    const after = sumSpan(rowsBetween(account, c, shiftDate(day, 1), input.date), input, snap.optimization_goal ?? null)
    const parent = c.level === 'adset' ? snap.campaign_id : null
    const changedAgain = changes.some(o =>
      o.c !== c && o.day > day && o.day <= input.date &&
      (o.c.entity_id === c.entity_id || (parent !== null && o.c.entity_id === parent)))

    const judged = input.outcome.primary === null
      ? { verdict: 'inconclusive' as const, reason: 'no_outcome_config' as const }
      : c.kind === 'pause'
        ? judgePause(before, input.outcome.targetCostPerPrimary)
        : judgeCostChange(before, after, changedAgain)
    out.push({ ad_account_id: account.adAccountId, level: c.level, entity_id: c.entity_id, kind: c.kind, changed_on: day, ...judged, before, after })
  }
  return { reviews: out, skippedNoSpend }
}

export function reviewMaturedChanges(input: DiagnosisInput): ChangeReviewSummary {
  const reviews: ChangeReview[] = []
  let skippedNoSpend = 0
  for (const raw of input.accounts) {
    if (raw.shared) continue // 共用账户分不清是谁的改动
    const scoped = scopeAccountToClient(raw, input.clientPageId, input.date, input.evaluatedAt)
    if (scoped.accountLevelOnly) continue
    const r = reviewAccount(scoped.account, input)
    reviews.push(...r.reviews)
    skippedNoSpend += r.skippedNoSpend
  }

  const by_verdict: Record<ChangeReviewVerdict, number> = {
    better: 0, worse: 0, flat: 0, stop_loss_justified: 0, paused_a_performer: 0, inconclusive: 0,
  }
  const inconclusive_reasons: Partial<Record<ChangeReviewInconclusiveReason, number>> = {}
  for (const r of reviews) {
    by_verdict[r.verdict] += 1
    if (r.reason) inconclusive_reasons[r.reason] = (inconclusive_reasons[r.reason] ?? 0) + 1
  }
  // 有结论的排前面当样例
  const samples = [...reviews].sort((a, b) => Number(a.verdict === 'inconclusive') - Number(b.verdict === 'inconclusive')).slice(0, MAX_SAMPLES)
  return {
    reviewed: reviews.length,
    skipped_no_spend: skippedNoSpend,
    decided: reviews.length - by_verdict.inconclusive,
    by_verdict,
    inconclusive_reasons,
    samples,
  }
}

/** 回看出错只记一句，绝不让正式流程（诊断、日报）跟着挂。 */
export function safeChangeReview(input: DiagnosisInput): ChangeReviewSummary | { error: string } {
  try {
    return reviewMaturedChanges(input)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

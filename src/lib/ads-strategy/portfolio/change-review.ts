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

import { countOutcome, type OutcomeStep } from './outcome-ladder'
import { rollupCampaignRole } from './roles'
import { resolveCoreMetric } from '../rules/core-metric'
import { scopeAccountToClient } from './diagnostics/ownership'
import { buildAccountContext, shiftDate, type AccountContext } from './diagnostics/context'
import { D3_COST_MULTIPLE, WINDOW_DAYS } from './diagnostics/thresholds'
import type { EntitySnapshotRow } from './snapshot'
import type { AccountInput, DailyRow, DiagnosisInput, SettingChange, SettingChangeKind } from './diagnostics/types'

/** 改动前后各看几天（不含改动当天）：跟诊断窗口同一个数 */
export const CHANGE_REVIEW_WINDOW_DAYS = WINDOW_DAYS
/** 单次成本降到改前的这个比例以下 = 变好 */
export const CHANGE_REVIEW_BETTER_RATIO = 0.8
/** 单次成本升到改前的这个比例以上 = 变差 */
export const CHANGE_REVIEW_WORSE_RATIO = 1.2
/**
 * 暂停前 7 天花了「目标单次成本 × 这个倍数」还零结果 = 止损成立。跟 D3「花钱没结果」同一个数。
 * 每段至少几个主结果才下结论，读客户自己配的 `outcome.minPrimaryPerUnit`（D5 / O3 同一个门槛）。
 */
export const PAUSE_WASTE_TARGET_MULTIPLE = D3_COST_MULTIPLE

/** 只回看拿来出结果的单位（跟 D3 自动暂停同一个范围）；曝光、扩量、混合的不按结果判 */
const RESULT_ROLES: ReadonlySet<string> = new Set(['acquisition', 'retargeting'])

const MAX_SAMPLES = 5

export type ChangeReviewVerdict = 'better' | 'worse' | 'flat' | 'stop_loss_justified' | 'paused_a_performer' | 'inconclusive'

/** 说不清的固定原因清单 */
export type ChangeReviewInconclusiveReason =
  | 'no_outcome_config' // 「广告结果怎么算」没设置
  | 'no_target_cost' // 暂停要跟目标单次成本比，没设置
  | 'too_few_results' // 结果太少，比不出来
  | 'cost_above_target' // 暂停前有结果、但单次成本高于目标：停得有道理，算不上止损
  | 'changed_again' // 前后 7 天里又改过（同一天来回改、它的系列、它名下的组），分不清是哪次改的
  | 'data_missing' // 结果数归不上（例如私信来源还没接通、系列下各组优化目标不一样）
  | 'not_result_unit' // 不是拿来出结果的单位（曝光 / 扩量 / 混合），不按结果判
  | 'goal_mismatch' // 暂停的单位出的结果跟客户配的主结果不是一种（例如按开聊优化、客户主结果是留资），没法跟目标成本比；或单位本身不出留资 / 开聊

export interface ChangeReview {
  ad_account_id: string
  level: 'campaign' | 'adset'
  entity_id: string
  kind: Exclude<SettingChangeKind, 'other' | 'activate'>
  /** 改动那天（账户时区） */
  changed_on: string
  verdict: ChangeReviewVerdict
  reason?: ChangeReviewInconclusiveReason
  before: { spend: number; primary: number | null }
  after: { spend: number; primary: number | null }
}

export interface ChangeReviewSummary {
  /** 今天满 7 天、拿来回看的改动数（不含只改了别的字段的、清理型暂停、重新开启） */
  reviewed: number
  /** 暂停前 7 天就没花钱（清理用的暂停）：不用回看，只计数。2026-11-03 回放：36 处里 16 处是这种 */
  skipped_no_spend: number
  /** 重新开启：开之前是停着的，没有「改前」可比，只计数（口径等第 3 步再定） */
  skipped_activate: number
  /** 有结论的（说不清以外） */
  decided: number
  by_verdict: Record<ChangeReviewVerdict, number>
  /** 说不清的各原因计数 */
  inconclusive_reasons: Partial<Record<ChangeReviewInconclusiveReason, number>>
  samples: ChangeReview[]
}

type Span = { spend: number; primary: number | null }
type Judged = Pick<ChangeReview, 'verdict' | 'reason'>
type DatedChange = { c: SettingChange; day: string }

/** UTC 时刻落在账户时区的哪一天。时区缺失按 UTC。 */
export function localDay(iso: string, tz: string | null): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(iso))
  const get = (k: string) => p.find(x => x.type === k)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function sumSpan(rows: readonly DailyRow[], input: DiagnosisInput, optimizationGoal: string | null, step: OutcomeStep | null): Span {
  const primaryStep = step
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

interface UnitFacts {
  role: string
  /** undefined = 系列下各组不一样，归不准 */
  goal: string | null | undefined
  /** 这个单位自己出的是哪种结果（跟广告组目的地走，复用 rules/core-metric.ts）；undefined 同上 */
  metric: OutcomeStep | null | undefined
}

function onlyValue<T>(values: readonly T[]): T | undefined {
  const set = new Set(values)
  return set.size === 1 ? Array.from(set)[0] : undefined
}

/**
 * 单位的用途、优化目标、它自己出的结果。系列用名下广告组：用途按 D3 同一套汇总；
 * 优化目标和结果种类各组一样才用，不一样返回 undefined（不能拿系列快照里多半是空的那一格去数）。
 */
function unitFacts(ctx: AccountContext, c: SettingChange, snap: EntitySnapshotRow, input: DiagnosisInput): UnitFacts {
  const metricOf = (s: EntitySnapshotRow) =>
    resolveCoreMetric({ destinationType: s.destination_type, optimizationGoal: s.optimization_goal, clientPrimary: input.outcome.primary })
  if (c.level === 'adset') {
    return { role: ctx.roles.get(c.entity_id)?.role ?? 'unknown', goal: snap.optimization_goal ?? null, metric: metricOf(snap) }
  }
  const children = Array.from(ctx.adsets.values()).filter(s => s.campaign_id === c.entity_id)
  const role = rollupCampaignRole(children.map(s => ctx.roles.get(s.entity_id)).filter(v => v !== undefined)).role
  return { role, goal: onlyValue(children.map(s => s.optimization_goal ?? null)), metric: onlyValue(children.map(metricOf)) }
}

/** 这个单位、它的系列、或它名下的组，在 [from, to] 里还有别的改动（只改了名字之类的也算：Meta 修改时间动了就算） */
function touchedBetween(changes: readonly DatedChange[], self: DatedChange, related: ReadonlySet<string>, from: string, to: string): boolean {
  return changes.some(o => o !== self && o.day >= from && o.day <= to && related.has(o.c.entity_id))
}

/** 调用方已经排除了暂停前没花钱的（见 reviewAccount）。 */
function judgePause(before: Span, target: number | null, minPrimary: number): Judged {
  if (target === null) return { verdict: 'inconclusive', reason: 'no_target_cost' }
  if (before.primary === null) return { verdict: 'inconclusive', reason: 'data_missing' }
  if (before.primary === 0) {
    return before.spend >= PAUSE_WASTE_TARGET_MULTIPLE * target
      ? { verdict: 'stop_loss_justified' }
      : { verdict: 'inconclusive', reason: 'too_few_results' }
  }
  if (before.spend / before.primary > target) return { verdict: 'inconclusive', reason: 'cost_above_target' }
  // 「停掉了达标的组」跟加减预算一样要够样本：一两条结果撞上的低成本不算数
  return before.primary >= minPrimary ? { verdict: 'paused_a_performer' } : { verdict: 'inconclusive', reason: 'too_few_results' }
}

function judgeCostChange(before: Span, after: Span, minPrimary: number): Judged {
  if (before.primary === null || after.primary === null) return { verdict: 'inconclusive', reason: 'data_missing' }
  if (before.primary < minPrimary || after.primary < minPrimary) return { verdict: 'inconclusive', reason: 'too_few_results' }
  const ratio = (after.spend / after.primary) / (before.spend / before.primary)
  if (ratio < CHANGE_REVIEW_BETTER_RATIO) return { verdict: 'better' }
  if (ratio > CHANGE_REVIEW_WORSE_RATIO) return { verdict: 'worse' }
  return { verdict: 'flat' }
}

interface AccountReview { reviews: ChangeReview[]; skippedNoSpend: number; skippedActivate: number }

/** 一个（已切成只剩客户自己的）账户里，今天正好满 7 天的改动逐条回看。每个单位一天最多一条。 */
function reviewAccount(account: AccountInput, input: DiagnosisInput): AccountReview {
  const changedOn = shiftDate(input.date, -CHANGE_REVIEW_WINDOW_DAYS)
  const ctx = buildAccountContext(account, input.date)
  const own = new Map(account.snapshots
    .filter(s => s.level === 'campaign' || s.level === 'adset')
    .map(s => [`${s.level}:${s.entity_id}`, s]))
  const changes: DatedChange[] = (account.settingChanges ?? []).map(c => ({ c, day: localDay(c.captured_at, account.timezone) }))
  const minPrimary = input.outcome.minPrimaryPerUnit
  const out: AccountReview = { reviews: [], skippedNoSpend: 0, skippedActivate: 0 }
  const seen = new Set<string>()

  for (const self of changes) {
    const { c, day } = self
    if (day !== changedOn || (c.level !== 'campaign' && c.level !== 'adset')) continue
    if (!c.kind || c.kind === 'other') continue
    const snap = own.get(`${c.level}:${c.entity_id}`)
    if (!snap) continue // 不是客户自己的（或已经不在了），不判
    if (seen.has(`${c.level}:${c.entity_id}`)) continue
    seen.add(`${c.level}:${c.entity_id}`)
    // 同一天同一处改了不止一种（例如上午加预算、下午改回）：只出一条，判「又改过」，不管列表里谁排前面
    const group = changes.filter(o => o.day === day && o.c.level === c.level && o.c.entity_id === c.entity_id && o.c.kind && o.c.kind !== 'other')
    const kind = group.find(o => o.c.kind !== 'activate')?.c.kind
    if (kind === undefined || kind === 'other' || kind === 'activate') { out.skippedActivate += 1; continue }
    const flipped = new Set(group.map(o => o.c.kind)).size > 1 // 同一种改动记了两次（重复抓取）不算来回改

    const facts = unitFacts(ctx, c, snap, input)
    const goal = facts.goal ?? null
    // 暂停要跟目标成本比，只能数客户配的主结果；加减预算只比前后单次成本，数这个单位自己出的结果
    // （例如 CTS 主结果是留资，WhatsApp 组按开聊比前后）
    const step = kind === 'pause' ? input.outcome.primary : (facts.metric ?? null)
    const before = sumSpan(rowsBetween(account, c, shiftDate(day, -CHANGE_REVIEW_WINDOW_DAYS), shiftDate(day, -1)), input, goal, step)
    if (kind === 'pause' && !flipped && before.spend <= 0) { out.skippedNoSpend += 1; continue }
    const after = sumSpan(rowsBetween(account, c, shiftDate(day, 1), input.date), input, goal, step)

    const related = new Set([c.entity_id])
    if (c.level === 'adset' && snap.campaign_id) related.add(snap.campaign_id)
    if (c.level === 'campaign') for (const s of ctx.adsets.values()) if (s.campaign_id === c.entity_id) related.add(s.entity_id)
    const aroundWindow = touchedBetween(changes, self, related, shiftDate(day, -CHANGE_REVIEW_WINDOW_DAYS), input.date)

    let judged: Judged
    if (input.outcome.primary === null) judged = { verdict: 'inconclusive', reason: 'no_outcome_config' }
    else if (!RESULT_ROLES.has(facts.role)) judged = { verdict: 'inconclusive', reason: 'not_result_unit' }
    else if (facts.goal === undefined || facts.metric === undefined) judged = { verdict: 'inconclusive', reason: 'data_missing' }
    // 2026-11-03 回放：CTS 按开聊优化的组被拿「留资」去数，零留资被误判成「止损成立」（魏征）
    else if (facts.metric === null || (kind === 'pause' && facts.metric !== input.outcome.primary)) judged = { verdict: 'inconclusive', reason: 'goal_mismatch' }
    else if (flipped) judged = { verdict: 'inconclusive', reason: 'changed_again' }
    // 暂停只看停之前那 7 天：同一天连系列带组一起停很常见，不影响「停之前在白花钱」这个判断
    else if (kind === 'pause') judged = judgePause(before, input.outcome.targetCostPerPrimary, minPrimary)
    else judged = aroundWindow ? { verdict: 'inconclusive', reason: 'changed_again' } : judgeCostChange(before, after, minPrimary)
    out.reviews.push({ ad_account_id: account.adAccountId, level: c.level, entity_id: c.entity_id, kind, changed_on: day, ...judged, before, after })
  }
  return out
}

export function reviewMaturedChanges(input: DiagnosisInput): ChangeReviewSummary {
  const reviews: ChangeReview[] = []
  let skippedNoSpend = 0
  let skippedActivate = 0
  for (const raw of input.accounts) {
    if (raw.shared) continue // 共用账户分不清是谁的改动
    const scoped = scopeAccountToClient(raw, input.clientPageId, input.date, input.evaluatedAt)
    if (scoped.accountLevelOnly) continue
    const r = reviewAccount(scoped.account, input)
    reviews.push(...r.reviews)
    skippedNoSpend += r.skippedNoSpend
    skippedActivate += r.skippedActivate
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
    skipped_activate: skippedActivate,
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

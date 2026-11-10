import { STAGE_GOAL, STAGE_LABEL, STAGE_SWITCH_MIN_DAYS, STAGE_SWITCH_MIN_LEADS, sharesOf } from './delivery-stage'
import type { PromoSpec } from './spec'

export type CaptureState = 'fresh' | 'stale' | 'incomplete' | 'missing' | 'unreadable'
export interface SwitchEvidence {
  capture: CaptureState
  asOf: string | null
  stableEnd: string | null
  datesSeen: number | null
  leads: number | null
  spendMajor: number | null
  targetMajor: number | null
  currency: string | null
}
export type SwitchVerdict =
  | { kind: 'propose'; text: string }
  | { kind: 'hold'; text: string }
  | { kind: 'steady'; text: string }
  | { kind: 'unreadable'; text: string }
  | { kind: 'not_marked'; text: string }
  | { kind: 'scale_hold'; text: string }
const DAY = 86_400_000
export function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}
export function shiftDate(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY).toISOString().slice(0, 10)
}
function money(amount: number, currency: string | null): string {
  const code = currency && /^[A-Z]{3}$/.test(currency) ? `${currency} ` : ''
  return `${code}${amount.toFixed(2)}`
}
function windowDays(startedOn: string, stableEnd: string): number {
  return dayNumber(stableEnd) - dayNumber(startedOn) + 1
}
function evidenceBlock(evidence: SwitchEvidence, startedOn: string): SwitchVerdict | null {
  if (evidence.capture !== 'fresh') {
    const why = evidence.capture === 'stale' ? '广告快照抓取太旧' : evidence.capture === 'incomplete' ? '广告快照没抓全' : evidence.capture === 'missing' ? '找不到广告快照抓取记录' : '广告快照抓取记录读不出来'
    return { kind: 'unreadable', text: `${why}，不能判断能不能从试投进入放量。过期只看抓取记录，不拿旧快照硬判。` }
  }
  if (!evidence.asOf || !evidence.stableEnd || evidence.datesSeen === null || evidence.leads === null || evidence.spendMajor === null) {
    return { kind: 'unreadable', text: '试投以来的留资或花费没读全，不能把没读到的天当成零。这次不提案。' }
  }
  if (evidence.targetMajor === null) {
    return { kind: 'unreadable', text: '目标单次留资成本还没在设置里填，不能判断能不能放量。不会用一个写死的数字顶上。' }
  }
  const elapsed = dayNumber(evidence.asOf) - dayNumber(startedOn)
  const stableDays = windowDays(startedOn, evidence.stableEnd)
  if (elapsed < STAGE_SWITCH_MIN_DAYS || stableDays < STAGE_SWITCH_MIN_DAYS) {
    return { kind: 'hold', text: `试投还不满 ${STAGE_SWITCH_MIN_DAYS} 天（最近一天的数据平台还会回补，不拿来判断）。先继续试投。` }
  }
  if (evidence.datesSeen < stableDays) {
    return { kind: 'unreadable', text: '有的天没有花费记录，不能把空白当成零留资。这次不提案。' }
  }
  if (evidence.leads < STAGE_SWITCH_MIN_LEADS) {
    return { kind: 'hold', text: `稳定记录里的留资是 ${evidence.leads} 条，还不到 ${STAGE_SWITCH_MIN_LEADS} 条。先继续试投。` }
  }
  return null
}
function costVerdict(evidence: SwitchEvidence): SwitchVerdict {
  const leads = evidence.leads ?? 0
  const spend = evidence.spendMajor ?? 0
  const target = evidence.targetMajor ?? 0
  if (leads <= 0) return { kind: 'unreadable', text: '留资读数不正常，这次不提案。' }
  const cplCents = Math.round((spend / leads) * 100)
  const targetCents = Math.round(target * 100)
  const shown = money(cplCents / 100, evidence.currency)
  const goal = money(target, evidence.currency)
  if (cplCents > targetCents) {
    return { kind: 'hold', text: `单次留资成本 ${shown}，高于设置里的目标 ${goal}。先继续试投，不另起放量计划。` }
  }
  return {
    kind: 'propose',
    text: `试投已满 ${STAGE_SWITCH_MIN_DAYS} 天，留资 ${leads} 条，单次成本 ${shown}，不高于目标 ${goal}。可以另起一份放量草稿。正在跑的计划不会被改，也不会自动重新批准。`,
  }
}
export function judgeSwitch(spec: PromoSpec, evidence: SwitchEvidence): SwitchVerdict {
  const row = spec.delivery
  if (!row) return { kind: 'not_marked', text: '这份计划还没写入试投、放量或稳住。下面按试投来提醒。已批准的计划不会因此被重新批准。' }
  if (row.stage === 'steady') return { kind: 'steady', text: `${STAGE_LABEL.steady}阶段不提案加预算，也不另起计划。` }
  if (row.stage === 'scale') return { kind: 'scale_hold', text: '放量之后，每日检查会按客户目标看要不要提议回到稳住。这里不另起计划，也不改预算。' }
  const blocked = evidenceBlock(evidence, row.started_on)
  return blocked ?? costVerdict(evidence)
}
export interface ScaleDraft { spec: PromoSpec; note: string }
export function buildScaleDraft(spec: PromoSpec, asOf: string): ScaleDraft {
  const next = structuredClone(spec)
  delete next.gate_snapshot
  next.checks = []
  const shares = sharesOf(spec)
  next.delivery = {
    stage: 'scale',
    goal: STAGE_GOAL.scale,
    started_on: asOf,
    test_share: shares.test,
    proven_share: shares.proven,
  }
  return {
    spec: next,
    note: '新草稿沿用原来的每日金额，没有自动加预算。请在草稿里把试投和已证明调成页面上的比例，再决定批不批。正在跑的计划没有改。',
  }
}

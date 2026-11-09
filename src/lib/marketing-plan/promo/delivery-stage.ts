import type { AdsStep, BudgetRole, DeliveryStage, PromoSpec } from './spec'
import { allAdsSteps } from './spec'

export const DEFAULT_TEST_SHARE = 0.3
export const DEFAULT_PROVEN_SHARE = 0.7
export const STAGE_SWITCH_MIN_DAYS = 14
export const STAGE_SWITCH_MIN_LEADS = 30
export const STAGE_LABEL: Record<DeliveryStage, string> = {
  test: '试投',
  scale: '放量',
  steady: '稳住',
}
export const STAGE_GOAL: Record<DeliveryStage, string> = {
  test: '用每天上限里的一小部分，试出单次留资成本能不能压到客户设置的目标以内。',
  scale: '把已经达标的做法放到一份新计划里加大比重。正在跑的计划不改预算。',
  steady: '按已经证明的比例稳住。这次不提案加预算。',
}
export function defaultTestDelivery(startedOn: string): NonNullable<PromoSpec['delivery']> {
  return {
    stage: 'test',
    goal: STAGE_GOAL.test,
    started_on: startedOn,
    test_share: DEFAULT_TEST_SHARE,
    proven_share: DEFAULT_PROVEN_SHARE,
  }
}
export function sharesOf(spec: PromoSpec): { test: number; proven: number } {
  const row = spec.delivery
  if (row?.test_share !== undefined && row.proven_share !== undefined) {
    return { test: row.test_share, proven: row.proven_share }
  }
  return { test: DEFAULT_TEST_SHARE, proven: DEFAULT_PROVEN_SHARE }
}
export interface RatioWarning { level: 'ok' | 'warn' | 'unknown'; text: string }
const SOFT = '这只是提醒，不拦住批准，也不改正在跑的计划。'
function pct(share: number): string {
  return `${Math.round(share * 100)}%`
}
function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}
function ruleLine(spec: PromoSpec): string {
  const shares = sharesOf(spec)
  return `默认把每天总上限分成试投 ${pct(shares.test)}、已证明 ${pct(shares.proven)}。${SOFT}`
}
function sumRole(steps: AdsStep[], role: BudgetRole): number {
  return steps.filter(s => s.settings.budget_role === role).reduce((n, s) => n + s.settings.daily_budget_cents, 0)
}
function taggedWarning(spec: PromoSpec, steps: AdsStep[], cap: number): RatioWarning {
  const shares = sharesOf(spec)
  const rule = ruleLine(spec)
  if (steps.some(s => s.settings.budget_role === undefined)) {
    return { level: 'warn', text: `还有广告没标是试投还是已证明，没法核对比例。${rule}` }
  }
  const testTarget = Math.round(cap * shares.test)
  const provenTarget = cap - testTarget
  const test = sumRole(steps, 'test')
  const proven = sumRole(steps, 'proven')
  if (test !== testTarget || proven !== provenTarget) {
    return {
      level: 'warn',
      text: `现在试投每天 ${yuan(test)}、已证明每天 ${yuan(proven)}，和 ${yuan(testTarget)} / ${yuan(provenTarget)} 不一致。${rule}`,
    }
  }
  return { level: 'ok', text: `试投和已证明的每日金额与 ${pct(shares.test)} / ${pct(shares.proven)} 一致。${rule}` }
}
function untaggedWarning(spec: PromoSpec, steps: AdsStep[], cap: number): RatioWarning {
  const rule = ruleLine(spec)
  const stage = spec.delivery?.stage
  if (stage === 'scale' || stage === 'steady') {
    return { level: 'warn', text: `这份计划还没标哪些广告是试投、哪些是已证明，没法核对比例。${rule}` }
  }
  const spent = steps.reduce((n, s) => n + s.settings.daily_budget_cents, 0)
  const testTarget = Math.round(cap * sharesOf(spec).test)
  if (spent > testTarget) {
    return { level: 'warn', text: `试投阶段，这份计划的广告每天合计 ${yuan(spent)}，建议的试投部分是 ${yuan(testTarget)}。${rule}` }
  }
  return { level: 'ok', text: `试投阶段，这份计划的广告每天合计没有超过建议的试投部分。${rule}` }
}
export function ratioWarning(spec: PromoSpec): RatioWarning {
  const rule = ruleLine(spec)
  const cap = spec.daily_total_cap_cents
  const steps = allAdsSteps(spec).map(row => row.step)
  if (!cap) return { level: 'unknown', text: `还没填每天总上限，没法核对比例。${rule}` }
  if (steps.length === 0) return { level: 'unknown', text: `这份计划里没有广告。${rule}` }
  const tagged = steps.some(s => s.settings.budget_role !== undefined)
  return tagged ? taggedWarning(spec, steps, cap) : untaggedWarning(spec, steps, cap)
}

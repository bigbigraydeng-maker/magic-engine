/**
 * A draft's daily budget may not exceed the server-computed plan seed.
 * Missing suggestion is a rejection, not an open ceiling.
 */

import type { PromoSpec } from '@/lib/marketing-plan/promo/spec'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'

export function seedBudgetProblems(spec: PromoSpec, seed: PlanSeed | null): string[] {
  if (!hasAdsBudget(spec)) return []
  if (!seed) return ['这份处方没有可用的预算建议，不能写入广告预算']
  const ceilings = ceilingsByAccount(seed)
  const problems: string[] = []
  for (const phase of spec.phases) {
    for (const [account, total] of phaseTotals(phase).entries()) {
      const ceiling = ceilings.get(account)
      if (ceiling === undefined) {
        problems.push(`${phase.name}：广告账户 ${account} 不在这次建议里，不能自定预算`)
        continue
      }
      if (total > ceiling) {
        problems.push(`${phase.name}：广告账户 ${account} 本计划日预算合计 ${total} 分，超过建议 ${ceiling} 分`)
      }
    }
  }
  return problems
}

function hasAdsBudget(spec: PromoSpec): boolean {
  return spec.phases.some(phase => phase.steps.some(step => step.kind === 'ads_campaign'))
}

function phaseTotals(phase: PromoSpec['phases'][number]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const step of phase.steps) {
    if (step.kind !== 'ads_campaign') continue
    const account = step.settings.ad_account_id
    totals.set(account, (totals.get(account) ?? 0) + step.settings.daily_budget_cents)
  }
  return totals
}

function ceilingsByAccount(seed: PlanSeed): Map<string, number> {
  const totals = new Map<string, number>()
  for (const step of seed.ad_steps) {
    if (!step.ad_account_id.ok || !step.daily_budget_cents.ok) continue
    const account = step.ad_account_id.value
    totals.set(account, (totals.get(account) ?? 0) + step.daily_budget_cents.value)
  }
  return totals
}

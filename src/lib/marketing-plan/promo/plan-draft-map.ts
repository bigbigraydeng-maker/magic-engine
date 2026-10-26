/**
 * Map a freshly built plan seed into promo_v1.
 * Empty account, budget, country, or audience stays empty. No placeholder values.
 */

import { checkAdsBudget, type AccountCapFacts } from './budget-caps'
import { planDraftMissingPlaysLine, planDraftNoCountryLine, planDraftNoPeriodLine } from './plan-draft-card'
import { parsePromoSpec, type PromoSpec } from './spec'
import type { PlanSeed, PlanSeedStep } from '@/lib/ads-strategy/plan-seed/types'

export interface PlanDraftMapInput {
  goalId: string
  period: { start_date: string; end_date: string } | null
  plays: readonly { step_key: string }[]
  seed: PlanSeed
  country: 'AU' | 'NZ' | null
  accounts: readonly AccountCapFacts[]
  clientCapCents: number | null
}

export type PlanDraftMapResult =
  | { ok: true; spec: PromoSpec; dropped: string[] }
  | { ok: false; code: string; text: string; retryable: boolean }

const UNREADABLE_STEP = '这一步的账户或日预算读不到，不写入。'
const NOT_OWNED_STEP = '这一步的广告账户不属于这个客户，不写入。'
const NO_USABLE_STEP = '账户或日预算读不到，没有可写入的广告步骤。'
const BUDGET_OVER = '日预算超过了这个账户或客户的上限，所以没有生成草稿。'
const SHAPE_REJECTED = '草稿结构和推广计划的校验对不上，所以没有生成。'

function seedLooksBroken(seed: PlanSeed): boolean {
  return seed.read_failed === true
}

function usableBudget(step: PlanSeedStep | undefined): number | null {
  if (!step?.daily_budget_cents.ok) return null
  const value = step.daily_budget_cents.value
  return Number.isInteger(value) && value > 0 ? value : null
}

function usableAccount(step: PlanSeedStep | undefined): string | null {
  if (!step?.ad_account_id.ok) return null
  const value = step.ad_account_id.value.trim()
  return value === '' ? null : value
}

function canonicalSpec(raw: unknown): PromoSpec | null {
  const first = parsePromoSpec(raw)
  if (!first.ok) return null
  const stripped: PromoSpec = { ...first.spec, checks: [] }
  delete stripped.gate_snapshot
  const second = parsePromoSpec(stripped)
  return second.ok ? second.spec : null
}

function reject(code: string, text: string, retryable = false): PlanDraftMapResult {
  return { ok: false, code, text, retryable }
}

interface RawAdsStep {
  id: string
  kind: 'ads_campaign'
  settings: {
    ad_account_id: string
    daily_budget_cents: number
    audience_ref: string
    targeting: { countries: Array<'AU' | 'NZ'>; city_keys: string[]; excluded_audience_refs: string[] }
  }
}

function keptSteps(input: PlanDraftMapInput): { steps: RawAdsStep[]; dropped: string[]; network: boolean } {
  const byKey = new Map(input.seed.ad_steps.map(step => [step.step_key, step]))
  const steps: RawAdsStep[] = []
  const dropped: string[] = []
  let network = seedLooksBroken(input.seed)
  for (const play of input.plays) {
    const seeded = byKey.get(play.step_key)
    const accountId = usableAccount(seeded)
    const budget = usableBudget(seeded)
    if (!accountId || budget === null) {
      dropped.push(UNREADABLE_STEP)
      continue
    }
    const owned = input.accounts.find(account => account.ad_account_id === accountId && account.owned_by_client)
    if (!owned) {
      dropped.push(NOT_OWNED_STEP)
      continue
    }
    if (input.country !== 'AU' && input.country !== 'NZ') {
      dropped.push(planDraftNoCountryLine())
      continue
    }
    steps.push({
      id: play.step_key,
      kind: 'ads_campaign',
      settings: {
        ad_account_id: accountId,
        daily_budget_cents: budget,
        audience_ref: '',
        targeting: { countries: [input.country], city_keys: [], excluded_audience_refs: [] },
      },
    })
  }
  return { steps, dropped, network }
}

function budgetBlocks(spec: PromoSpec, input: PlanDraftMapInput): boolean {
  for (const phase of spec.phases) {
    const ads = phase.steps.flatMap(step => (step.kind === 'ads_campaign' ? [step] : []))
    if (checkAdsBudget(ads, input.accounts, input.clientCapCents).verdict === 'over') return true
  }
  return false
}

/** Pure mapping. Callers skip the seed build when there are no ad plays. */
export function mapSeedToPromo(input: PlanDraftMapInput): PlanDraftMapResult {
  if (input.plays.length === 0) return reject('missing_ad_plays', planDraftMissingPlaysLine())
  if (!input.period || input.period.end_date < input.period.start_date) {
    return reject('no_period', planDraftNoPeriodLine())
  }
  const { steps, dropped, network } = keptSteps(input)
  if (steps.length === 0) {
    if (network) return reject('network', 'network', true)
    const text = dropped.length > 0 ? [...new Set(dropped)].slice(0, 3).join('；') : NO_USABLE_STEP
    return reject('no_usable_step', text)
  }
  const spec = canonicalSpec({
    schema: 'promo_v1',
    goal_id: input.goalId,
    phases: [{
      id: 'phase-1',
      name: '推广',
      start_date: input.period.start_date,
      end_date: input.period.end_date,
      steps,
    }],
  })
  if (!spec) return reject('invalid_spec', SHAPE_REJECTED)
  if (budgetBlocks(spec, input)) return reject('budget_over', BUDGET_OVER)
  return { ok: true, spec, dropped: [...new Set(dropped)] }
}

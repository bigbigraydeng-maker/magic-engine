/**
 * Daily ad scorecard (rulebook v1.1 E-19 / E-20). Pure, read-only.
 *
 * One row per budget unit (spend, its own result type, cost per result, vs target, sample gap),
 * plus a per-role budget verdict that reproduces D5 / O3 math exactly (same units, same counting,
 * same binomial test + Benjamini–Hochberg, same gap filter). The scorecard only writes out what
 * D5 / O3 would conclude — it never judges on its own.
 */

import { countOutcome, isAttributableForBudget, type OutcomeStep } from './outcome-ladder'
import type { FunnelRole } from './roles'
import { resolveCoreMetric, type CoreMetric } from '../rules/core-metric'
import { scopeAccountToClient } from './diagnostics/ownership'
import { adsetRows, buildAccountContext, sumSpend, type AccountContext, type BudgetUnit } from './diagnostics/context'
import { benjaminiHochberg, binomialTwoSidedP } from './diagnostics/d5-budget-result-mismatch'
import { D5_FDR_Q, D5_MIN_SHARE_GAP } from './diagnostics/thresholds'
import type { DiagnosisInput } from './diagnostics/types'

export const BUDGET_GAP_THRESHOLD = D5_MIN_SHARE_GAP

const COMPARABLE_ROLES: readonly FunnelRole[] = ['acquisition', 'retargeting', 'expansion']
const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

export type ScorecardSeparate = 'result_type_differs' | 'not_result_unit' | 'experiment'

export interface ScorecardUnit {
  adAccountId: string
  level: 'campaign' | 'adset'
  id: string
  name: string | null
  role: FunnelRole
  spend: number
  resultType: CoreMetric | null
  results: number | null
  costPerResult: number | null
  targetCost: number | null
  vsTarget: 'at_or_below' | 'above' | 'no_target' | null
  sampleGap: number
  separate: ScorecardSeparate | null
}

export interface BudgetThinUnit { id: string; name: string | null; results: number; need: number; suspicious: boolean }

export interface BudgetVerdict {
  role: FunnelRole
  state: 'mismatch' | 'no_mismatch' | 'insufficient' | 'not_comparable'
  reason: 'single_unit' | 'outcome_not_configured' | 'primary_not_attributable' | null
  threshold: number
  fdrQ: number
  maxGap: number | null
  under: string[]
  over: string[]
  thin: BudgetThinUnit[]
}

export interface AdsScorecard {
  window: { start: string; end: string }
  units: ScorecardUnit[]
  budget: BudgetVerdict[]
  accountsSkipped: Array<{ adAccountId: string; reason: 'shared' | 'account_level_only' }>
}

// ---------- unit result type / counting ----------

function adsetResultType(ctx: AccountContext, adsetId: string, primary: OutcomeStep | null): CoreMetric | null {
  const snap = ctx.adsets.get(adsetId)
  if (!snap) return null
  return resolveCoreMetric({ destinationType: snap.destination_type, optimizationGoal: snap.optimization_goal, clientPrimary: primary })
}

function unitResultType(ctx: AccountContext, u: BudgetUnit, primary: OutcomeStep | null): CoreMetric | null {
  if (u.level === 'adset') return adsetResultType(ctx, u.id, primary)
  const types = u.adsetIds.map(id => adsetResultType(ctx, id, primary))
  if (types.length === 0) return null
  const first = types[0]
  return types.every(t => t === first) ? first : null
}

function countUnitResults(ctx: AccountContext, u: BudgetUnit, step: OutcomeStep | null, input: DiagnosisInput): number | null {
  if (step === null) return null
  const rows = adsetRows(ctx, u.adsetIds)
  let total = 0
  for (const r of rows) {
    const c = countOutcome(step, r, {
      messagingReferralAvailable: input.messagingReferralAvailable,
      optimizationGoal: ctx.adsets.get(r.entity_id)?.optimization_goal ?? null,
    })
    if (c.value === null) return null
    total += c.value
  }
  return total
}

function separateOf(u: BudgetUnit, resultType: CoreMetric | null, primary: OutcomeStep | null, isExperiment: boolean): ScorecardSeparate | null {
  if (isExperiment) return 'experiment'
  if (!COMPARABLE_ROLES.includes(u.role) || resultType === null) return 'not_result_unit'
  if ((primary === 'lead' || primary === 'messaging_started') && resultType !== primary) return 'result_type_differs'
  return null
}

function vsTargetOf(costPerResult: number | null, targetCost: number | null, results: number | null): ScorecardUnit['vsTarget'] {
  if (targetCost === null) return 'no_target'
  if (costPerResult === null) return results === 0 ? 'above' : null
  return costPerResult <= targetCost ? 'at_or_below' : 'above'
}

function buildUnit(ctx: AccountContext, u: BudgetUnit, input: DiagnosisInput, isExperiment: boolean): ScorecardUnit | null {
  const rows = adsetRows(ctx, u.adsetIds)
  const spend = sumSpend(rows)
  if (spend <= 0) return null
  const primary = input.outcome.primary
  const resultType = unitResultType(ctx, u, primary)
  const step: OutcomeStep | null = resultType ?? primary
  const results = countUnitResults(ctx, u, step, input)
  const costPerResult = results !== null && results > 0 ? round2(spend / results) : null
  const targetCost = resultType !== null && resultType === primary ? input.outcome.targetCostPerPrimary : null
  const min = input.outcome.minPrimaryPerUnit
  return {
    adAccountId: ctx.account.adAccountId,
    level: u.level,
    id: u.id,
    name: u.name,
    role: u.role,
    spend: round2(spend),
    resultType,
    results,
    costPerResult,
    targetCost,
    vsTarget: vsTargetOf(costPerResult, targetCost, results),
    sampleGap: Math.max(0, min - (results ?? 0)),
    separate: separateOf(u, resultType, primary, isExperiment),
  }
}

// ---------- budget verdict (mirrors D5 / O3) ----------

interface CountedUnit { u: BudgetUnit; spend: number; results: number; attributable: boolean }

function countForBudget(ctx: AccountContext, u: BudgetUnit, primary: OutcomeStep, input: DiagnosisInput): CountedUnit {
  const rows = adsetRows(ctx, u.adsetIds)
  const counts = rows.map(r => countOutcome(primary, r, {
    messagingReferralAvailable: input.messagingReferralAvailable,
    optimizationGoal: ctx.adsets.get(r.entity_id)?.optimization_goal ?? null,
  }))
  return {
    u,
    spend: sumSpend(rows),
    results: counts.reduce((a, c) => a + (c.value ?? 0), 0),
    attributable: counts.every(isAttributableForBudget),
  }
}

function verdictBase(role: FunnelRole, state: BudgetVerdict['state'], reason: BudgetVerdict['reason'], thin: BudgetThinUnit[] = []): BudgetVerdict {
  return { role, state, reason, threshold: BUDGET_GAP_THRESHOLD, fdrQ: D5_FDR_Q, maxGap: null, under: [], over: [], thin }
}

function thinOf(counted: CountedUnit[], min: number, totalSpend: number, totalResults: number): BudgetThinUnit[] {
  const gapOf = (c: CountedUnit) =>
    Math.abs((totalResults > 0 ? c.results / totalResults : 0) - (totalSpend > 0 ? c.spend / totalSpend : 0))
  return counted
    .filter(c => c.results < min)
    .map(c => ({ id: c.u.id, name: c.u.name, results: c.results, need: min - c.results, suspicious: gapOf(c) >= BUDGET_GAP_THRESHOLD }))
}

function compareEnough(enough: CountedUnit[]): { under: string[]; over: string[]; maxGap: number } {
  const S = enough.reduce((a, c) => a + c.spend, 0)
  const N = enough.reduce((a, c) => a + c.results, 0)
  const stats = enough.map(c => {
    const spendShare = c.spend / S
    const resultShare = c.results / N
    return { id: c.u.id, spendShare, resultShare, p: binomialTwoSidedP(c.results, N, spendShare) }
  })
  const adj = benjaminiHochberg(stats.map(s => s.p))
  const over: string[] = []
  const under: string[] = []
  let maxGap = 0
  stats.forEach((s, i) => {
    const gap = Math.abs(s.resultShare - s.spendShare)
    if (gap > maxGap) maxGap = gap
    if (adj[i] <= D5_FDR_Q && s.resultShare - s.spendShare >= BUDGET_GAP_THRESHOLD) over.push(s.id)
    else if (adj[i] <= D5_FDR_Q && gap >= BUDGET_GAP_THRESHOLD) under.push(s.id)
  })
  return { under, over, maxGap: round3(maxGap) }
}

function budgetVerdictForRole(ctx: AccountContext, role: FunnelRole, input: DiagnosisInput): BudgetVerdict | null {
  const units = ctx.budgetUnits
    .filter(u => u.role === role)
    .map(u => ({ u, rows: adsetRows(ctx, u.adsetIds) }))
    .filter(x => sumSpend(x.rows) > 0)
  if (units.length === 0) return null
  if (units.length === 1) return verdictBase(role, 'not_comparable', 'single_unit')

  const primary = input.outcome.primary
  if (!input.outcomeConfigured || primary === null) return verdictBase(role, 'not_comparable', 'outcome_not_configured')

  const counted = units.map(x => countForBudget(ctx, x.u, primary, input))
  if (counted.some(c => !c.attributable)) return verdictBase(role, 'not_comparable', 'primary_not_attributable')

  const min = input.outcome.minPrimaryPerUnit
  const totalSpend = counted.reduce((a, c) => a + c.spend, 0)
  const totalResults = counted.reduce((a, c) => a + c.results, 0)
  const thin = thinOf(counted, min, totalSpend, totalResults)
  const enough = counted.filter(c => c.results >= min)
  if (enough.length < 2) return verdictBase(role, 'insufficient', null, thin)

  const { under, over, maxGap } = compareEnough(enough)
  const state: BudgetVerdict['state'] = under.length > 0 || over.length > 0 ? 'mismatch' : 'no_mismatch'
  return { role, state, reason: null, threshold: BUDGET_GAP_THRESHOLD, fdrQ: D5_FDR_Q, maxGap, under, over, thin }
}

// ---------- top level ----------

function windowOf(input: DiagnosisInput, firstCtx: AccountContext | null): AdsScorecard['window'] {
  if (!firstCtx) return { start: input.date, end: input.date }
  return { start: firstCtx.window[0], end: firstCtx.date }
}

export function buildAdsScorecard(input: DiagnosisInput): AdsScorecard {
  const units: ScorecardUnit[] = []
  const budget: BudgetVerdict[] = []
  const accountsSkipped: AdsScorecard['accountsSkipped'] = []
  let firstCtx: AccountContext | null = null

  for (const raw of input.accounts) {
    if (raw.shared) { accountsSkipped.push({ adAccountId: raw.adAccountId, reason: 'shared' }); continue }
    const scoped = scopeAccountToClient(raw, input.clientPageId, input.date, input.evaluatedAt)
    if (scoped.accountLevelOnly) { accountsSkipped.push({ adAccountId: raw.adAccountId, reason: 'account_level_only' }); continue }
    const ctx = buildAccountContext(scoped.account, input.date)
    if (!firstCtx) firstCtx = ctx

    const budgetIds = new Set(ctx.budgetUnits.map(u => u.id))
    for (const u of ctx.allBudgetUnits) {
      const unit = buildUnit(ctx, u, input, !budgetIds.has(u.id))
      if (unit) units.push(unit)
    }
    for (const role of COMPARABLE_ROLES) {
      const v = budgetVerdictForRole(ctx, role, input)
      if (v) budget.push(v)
    }
  }

  return { window: windowOf(input, firstCtx), units, budget, accountsSkipped }
}

export function safeBuildAdsScorecard(input: DiagnosisInput): AdsScorecard | { error: string } {
  try {
    return buildAdsScorecard(input)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

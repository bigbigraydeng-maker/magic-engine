/**
 * Daily trend Check rules (pure functions). Triggers / fallback for §3.5 AI layer.
 */

import type { TrendCheckRules } from './config'
import type {
  TrendDailyRow,
  TrendDiagnosisCode,
  TrendEntitySeries,
  TrendFinding,
  TrendRuleId,
  TrendSeverity,
  TrendSubject,
  TrendTuneRemedy,
} from './types'

const CREATIVE_FATIGUE_LABEL = '素材疲劳/走弱'
const COST_CREEP_LABEL = '成本走强/需调方'
const SINGLE_CREATIVE_LABEL = '单创意老化'

export function judgeDailyTrendForEntity(
  entity: TrendEntitySeries,
  evaluationDate: string,
  targetCost: number | null,
  rules: TrendCheckRules,
): TrendFinding[] {
  if (!rowOn(entity.daily, evaluationDate)) return []
  const out: TrendFinding[] = []
  const ctrHit = ruleCtrVsSelf7d(entity, evaluationDate, rules)
  const cplHit = ruleCplVsSelf7d(entity, evaluationDate, targetCost, rules)
  const staleHit = ruleSingleCreativeAge(entity, evaluationDate, rules)
  if (ctrHit && staleHit) {
    out.push(mergeStaleIntoCreativeFatigue(ctrHit, staleHit))
  } else {
    if (ctrHit) out.push(ctrHit)
    if (staleHit) out.push(staleHit)
  }
  if (cplHit) out.push(cplHit)
  return out
}

function mergeStaleIntoCreativeFatigue(primary: TrendFinding, stale: TrendFinding): TrendFinding {
  const flags = [...new Set([...primary.evidence.flags, ...stale.evidence.flags, 'single_creative_stale'])]
  const ruleIds = [...new Set<TrendRuleId>([...primary.evidence.rule_ids, ...stale.evidence.rule_ids])]
  return {
    ...primary,
    severity: stale.severity === 'act_soon' ? 'act_soon' : primary.severity,
    suggested_tune: dedupeTunes([...primary.suggested_tune, ...stale.suggested_tune]),
    evidence: {
      ...primary.evidence,
      single_creative_days: stale.evidence.single_creative_days,
      flags,
      rule_ids: ruleIds,
    },
  }
}

function ruleCtrVsSelf7d(
  entity: TrendEntitySeries,
  evaluationDate: string,
  rules: TrendCheckRules,
): TrendFinding | null {
  const day = rowOn(entity.daily, evaluationDate)
  if (!day || day.impressions < rules.minImpressionsForCtr) return null
  const baselineRows = baselineWindow(entity.daily, evaluationDate, rules.ctrBaselineDays)
  if (baselineRows.length < rules.ctrBaselineDays) return null
  const dayCtr = ctrPct(day)
  const baseCtr = meanCtr(baselineRows)
  if (dayCtr === null || baseCtr === null || baseCtr <= 0) return null
  const dropPct = ((dayCtr - baseCtr) / baseCtr) * 100
  if (dropPct > -rules.ctrDropPct) return null
  const severity: TrendSeverity = dropPct <= -rules.ctrDropPct * 1.5 ? 'act_soon' : 'watch'
  return buildFinding({
    diagnosis_code: 'creative_fatigue',
    rule_id: 'ctr_vs_self_7d',
    label_zh: CREATIVE_FATIGUE_LABEL,
    subject: entity.subject,
    severity,
    suggested_tune: ['swap_creative', 'add_creative'],
    evidence: {
      ctr_day_pct: round1(dayCtr),
      ctr_baseline_7d_pct: round1(baseCtr),
      ctr_drop_pct: round1(dropPct),
      baseline_days: rules.ctrBaselineDays,
      rule_ids: ['ctr_vs_self_7d'],
      flags: ['ctr_slide'],
    },
  })
}

function ruleCplVsSelf7d(
  entity: TrendEntitySeries,
  evaluationDate: string,
  targetCost: number | null,
  rules: TrendCheckRules,
): TrendFinding | null {
  const recent = rollingWindow(entity.daily, evaluationDate, rules.cplBaselineDays)
  const priorEnd = shiftDate(evaluationDate, -rules.cplBaselineDays)
  const prior = rollingWindow(entity.daily, priorEnd, rules.cplBaselineDays)
  if (recent.length < rules.cplBaselineDays || prior.length < rules.cplBaselineDays) return null
  const recentCpl = cplOfRows(recent)
  const priorCpl = cplOfRows(prior)
  if (recentCpl === null || priorCpl === null || priorCpl <= 0) return null
  const recentSpend = sum(recent, 'spend')
  if (recentSpend < rules.minSpendForCpl) return null
  const risePct = ((recentCpl - priorCpl) / priorCpl) * 100
  if (risePct < rules.cplRisePct) return null
  const cpmChange = relativeChange(meanCpm(recent), meanCpm(prior))
  const cvrChange = relativeChange(meanClickToLead(recent), meanClickToLead(prior))
  if (cpmChange !== null && Math.abs(cpmChange) > rules.cpmStableMaxChangePct) return null
  if (cvrChange !== null && Math.abs(cvrChange) > rules.clickToLeadStableMaxChangePct) return null
  const day = rowOn(entity.daily, evaluationDate)
  const dayCpl = day ? cplOfRow(day) : null
  const ratio = targetCost && dayCpl ? dayCpl / targetCost : null
  return buildFinding({
    diagnosis_code: 'cost_creep',
    rule_id: 'cpl_vs_self_7d',
    label_zh: COST_CREEP_LABEL,
    subject: entity.subject,
    severity: risePct >= rules.cplRisePct * 1.5 ? 'act_soon' : 'watch',
    suggested_tune: ['lower_budget', 'narrow_audience'],
    evidence: {
      cpl_day: dayCpl !== null ? round2(dayCpl) : null,
      cpl_rolling_7d: round2(recentCpl),
      cpl_prior_7d: round2(priorCpl),
      cpl_rise_pct: round1(risePct),
      cpl_ratio_to_target: ratio !== null ? round2(ratio) : null,
      cpm_change_pct: cpmChange !== null ? round1(cpmChange) : null,
      click_to_lead_change_pct: cvrChange !== null ? round1(cvrChange) : null,
      rule_ids: ['cpl_vs_self_7d'],
      flags: ['cpl_rise_stable_funnel'],
    },
  })
}

function ruleSingleCreativeAge(
  entity: TrendEntitySeries,
  evaluationDate: string,
  rules: TrendCheckRules,
): TrendFinding | null {
  const structure = entity.structure
  if (!structure || structure.delivering_ad_count !== 1) return null
  if (structure.single_creative_days < rules.singleCreativeMinDays) return null
  return buildFinding({
    diagnosis_code: 'single_creative_stale',
    rule_id: 'single_creative_age',
    label_zh: SINGLE_CREATIVE_LABEL,
    subject: entity.subject,
    severity: structure.single_creative_days >= rules.singleCreativeMinDays + 3 ? 'act_soon' : 'watch',
    suggested_tune: ['swap_creative', 'add_creative'],
    evidence: {
      single_creative_days: structure.single_creative_days,
      rule_ids: ['single_creative_age'],
      flags: ['single_creative_stale'],
    },
  })
}

interface BuildFindingArgs {
  diagnosis_code: TrendDiagnosisCode
  rule_id: TrendRuleId
  label_zh: string
  subject: TrendSubject
  severity: TrendSeverity
  suggested_tune: TrendTuneRemedy[]
  evidence: TrendFinding['evidence']
}

function buildFinding(args: BuildFindingArgs): TrendFinding {
  return {
    diagnosis_code: args.diagnosis_code,
    rule_id: args.rule_id,
    label_zh: args.label_zh,
    subject: args.subject,
    evidence: args.evidence,
    suggested_tune: dedupeTunes(args.suggested_tune),
    severity: args.severity,
    source: 'rules',
  }
}

function dedupeTunes(items: TrendTuneRemedy[]): TrendTuneRemedy[] {
  return [...new Set(items)]
}

function rowOn(rows: readonly TrendDailyRow[], date: string): TrendDailyRow | null {
  return rows.find((r) => r.insight_date === date) ?? null
}

function baselineWindow(rows: readonly TrendDailyRow[], evaluationDate: string, days: number): TrendDailyRow[] {
  const end = shiftDate(evaluationDate, -1)
  const start = shiftDate(evaluationDate, -days)
  return rows.filter((r) => r.insight_date >= start && r.insight_date <= end)
}

function rollingWindow(rows: readonly TrendDailyRow[], endDate: string, days: number): TrendDailyRow[] {
  const start = shiftDate(endDate, -(days - 1))
  return rows.filter((r) => r.insight_date >= start && r.insight_date <= endDate)
}

function shiftDate(isoDate: string, deltaDays: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`) + deltaDays * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function ctrPct(row: TrendDailyRow): number | null {
  if (row.impressions <= 0) return null
  return (row.clicks / row.impressions) * 100
}

function meanCtr(rows: readonly TrendDailyRow[]): number | null {
  const values = rows.map(ctrPct).filter((v): v is number => v !== null)
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function cplOfRow(row: TrendDailyRow): number | null {
  if (row.primary_results <= 0) return null
  return row.spend / row.primary_results
}

function cplOfRows(rows: readonly TrendDailyRow[]): number | null {
  const spend = sum(rows, 'spend')
  const results = sum(rows, 'primary_results')
  if (results <= 0) return null
  return spend / results
}

function sum(rows: readonly TrendDailyRow[], key: 'spend' | 'primary_results'): number {
  let total = 0
  for (const row of rows) total += row[key]
  return total
}

function cpmOfRow(row: TrendDailyRow): number | null {
  if (row.cpm != null && Number.isFinite(row.cpm)) return row.cpm
  if (row.impressions <= 0) return null
  return (row.spend / row.impressions) * 1000
}

function meanCpm(rows: readonly TrendDailyRow[]): number | null {
  const values = rows.map(cpmOfRow).filter((v): v is number => v !== null && v > 0)
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function clickToLeadRate(row: TrendDailyRow): number | null {
  if (row.clicks <= 0) return null
  return row.primary_results / row.clicks
}

function meanClickToLead(rows: readonly TrendDailyRow[]): number | null {
  const values = rows.map(clickToLeadRate).filter((v): v is number => v !== null)
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function relativeChange(recent: number | null, prior: number | null): number | null {
  if (recent === null || prior === null || prior === 0) return null
  return ((recent - prior) / prior) * 100
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

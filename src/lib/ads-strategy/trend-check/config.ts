/**
 * Client overrides for daily trend Check rules (`leads_config.ads_trend_check`).
 */

export const ADS_TREND_CHECK_CONFIG_KEY = 'ads_trend_check'

export interface TrendCheckRules {
  readonly ctrBaselineDays: number
  readonly ctrDropPct: number
  readonly minImpressionsForCtr: number
  readonly cplBaselineDays: number
  readonly cplRisePct: number
  readonly minSpendForCpl: number
  readonly cpmStableMaxChangePct: number
  readonly clickToLeadStableMaxChangePct: number
  readonly singleCreativeMinDays: number
  readonly frequencyGuardEnabled: boolean
  readonly frequency7dMax: number | null
}

export const DEFAULT_TREND_CHECK_RULES: TrendCheckRules = {
  ctrBaselineDays: 7,
  ctrDropPct: 30,
  minImpressionsForCtr: 400,
  cplBaselineDays: 7,
  cplRisePct: 50,
  minSpendForCpl: 5,
  cpmStableMaxChangePct: 20,
  clickToLeadStableMaxChangePct: 25,
  singleCreativeMinDays: 10,
  frequencyGuardEnabled: false,
  frequency7dMax: null,
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

function percentPositive(value: unknown, max = 500): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) return null
  return value
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

export function rulesFromLeadsConfig(leadsConfig: unknown): TrendCheckRules {
  const base = DEFAULT_TREND_CHECK_RULES
  const root = objectOf(leadsConfig)
  const block = objectOf(root?.[ADS_TREND_CHECK_CONFIG_KEY])
  if (!block) return base
  return {
    ctrBaselineDays: whole(block.ctr_baseline_days, 3, 21) ?? base.ctrBaselineDays,
    ctrDropPct: percentPositive(block.ctr_drop_pct) ?? base.ctrDropPct,
    minImpressionsForCtr: whole(block.min_impressions_for_ctr, 50, 1_000_000) ?? base.minImpressionsForCtr,
    cplBaselineDays: whole(block.cpl_baseline_days, 3, 21) ?? base.cplBaselineDays,
    cplRisePct: percentPositive(block.cpl_rise_pct) ?? base.cplRisePct,
    minSpendForCpl: percentPositive(block.min_spend_for_cpl, 1_000_000) ?? base.minSpendForCpl,
    cpmStableMaxChangePct: percentPositive(block.cpm_stable_max_change_pct, 200) ?? base.cpmStableMaxChangePct,
    clickToLeadStableMaxChangePct:
      percentPositive(block.click_to_lead_stable_max_change_pct, 200) ?? base.clickToLeadStableMaxChangePct,
    singleCreativeMinDays: whole(block.single_creative_min_days, 1, 90) ?? base.singleCreativeMinDays,
    frequencyGuardEnabled: bool(block.frequency_guard_enabled) ?? base.frequencyGuardEnabled,
    frequency7dMax: percentPositive(block.frequency_7d_max, 100),
  }
}

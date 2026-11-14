/**
 * Daily trend Check (PR-2): pure inputs/outputs for rule engine + future AI layer trigger.
 * Daily table only; intraday hook wires PR-1 columns in this repo (Ray §7.2：先旧版补列，后迁新版).
 */

export type TrendSubjectLevel = 'ad' | 'adset' | 'campaign'

export type TrendDiagnosisCode =
  | 'creative_fatigue'
  | 'cost_creep'
  | 'single_creative_stale'

export type TrendSeverity = 'watch' | 'act_soon'

export type TrendTuneRemedy =
  | 'swap_creative'
  | 'add_creative'
  | 'narrow_audience'
  | 'lower_budget'

export type TrendRuleId =
  | 'ctr_vs_self_7d'
  | 'cpl_vs_self_7d'
  | 'single_creative_age'
  | 'frequency_guard'

/** One day of entity-level metrics aligned with ad_daily_insights semantics (no Meta IDs in fixtures). */
export interface TrendDailyRow {
  readonly insight_date: string
  readonly impressions: number
  readonly clicks: number
  readonly spend: number
  readonly primary_results: number
  /** Optional; derived from spend/impressions*1000 when absent. */
  readonly cpm?: number | null
}

export interface TrendSubject {
  readonly level: TrendSubjectLevel
  readonly id: string
  readonly name: string
}

export interface TrendStructureFacts {
  /** Count of ads currently delivering in this ad set (evaluation day). */
  readonly delivering_ad_count: number
  /** Days the sole delivering ad has been live (0 when not single-creative). */
  readonly single_creative_days: number
}

/**
 * Optional intraday sequence (10-minute buckets). Not used by v1 rules; reserved for PR-6 / PR-1.
 */
export interface TrendIntradayHook {
  readonly buckets?: ReadonlyArray<{
    readonly local_minute: number
    readonly impressions: number
    readonly clicks: number
  }>
}

export interface TrendEntitySeries {
  readonly subject: TrendSubject
  readonly daily: readonly TrendDailyRow[]
  readonly structure?: TrendStructureFacts
  readonly intraday?: TrendIntradayHook
}

export interface TrendCheckRunInput {
  readonly client_slug: string
  readonly evaluation_date: string
  readonly target_cost_per_primary: number | null
  readonly entities: readonly TrendEntitySeries[]
}

export interface TrendFindingEvidence {
  readonly ctr_day_pct?: number
  readonly ctr_baseline_7d_pct?: number
  readonly ctr_drop_pct?: number
  readonly baseline_days?: number
  readonly cpl_day?: number | null
  readonly cpl_rolling_7d?: number | null
  readonly cpl_prior_7d?: number | null
  readonly cpl_rise_pct?: number | null
  readonly cpl_ratio_to_target?: number | null
  readonly cpm_change_pct?: number | null
  readonly click_to_lead_change_pct?: number | null
  readonly single_creative_days?: number
  readonly rule_ids: readonly TrendRuleId[]
  readonly flags: readonly string[]
}

export interface TrendFinding {
  readonly diagnosis_code: TrendDiagnosisCode
  readonly rule_id: TrendRuleId
  readonly label_zh: string
  readonly subject: TrendSubject
  readonly evidence: TrendFindingEvidence
  readonly suggested_tune: readonly TrendTuneRemedy[]
  readonly severity: TrendSeverity
  readonly source: 'rules'
}

export interface TrendCheckRunResult {
  readonly client_slug: string
  readonly evaluation_date: string
  readonly findings: readonly TrendFinding[]
  readonly entity_count: number
  readonly rules_evaluated: number
}

/** Shape for cron_run_logs / dry-run receipts (no DB write in PR-2). */
export interface TrendCheckRunReceipt {
  readonly kind: 'ads_daily_trend_check'
  readonly client_slug: string
  readonly evaluation_date: string
  readonly findings_count: number
  readonly diagnosis_codes: readonly TrendDiagnosisCode[]
  readonly rule_ids: readonly TrendRuleId[]
}

/**
 * Per-client ads automation switches stored on leads_config.
 * Missing values stay off. Writes merge only these three keys.
 *
 * Read shapes stay aligned with the callers that already exist or are in flight:
 * - ads_predictive_early_warning: exactly true (predictiveEarlyWarningEnabled)
 * - ads_trend_check: true or { enabled: true } (trendCheckPatrolEnabled, PR #3907)
 * - ads_tune_cards: exactly true (tuneCardsEnabled, PR #3909). This file does not
 *   copy that PR's planner; it only reserves the same boolean key.
 */

export const ADS_PREDICTIVE_EARLY_WARNING_KEY = 'ads_predictive_early_warning'
export const ADS_TREND_CHECK_KEY = 'ads_trend_check'
export const ADS_TUNE_CARDS_KEY = 'ads_tune_cards'

export const ADS_AUTOMATION_SWITCH_KEYS = [
  ADS_PREDICTIVE_EARLY_WARNING_KEY,
  ADS_TREND_CHECK_KEY,
  ADS_TUNE_CARDS_KEY,
] as const

export type AdsAutomationSwitchKey = (typeof ADS_AUTOMATION_SWITCH_KEYS)[number]

export interface AdsAutomationSwitches {
  ads_predictive_early_warning: boolean
  ads_trend_check: boolean
  ads_tune_cards: boolean
}

const LABELS: Record<AdsAutomationSwitchKey, string> = {
  ads_predictive_early_warning: '日内预警',
  ads_trend_check: '日趋势检查',
  ads_tune_cards: '调优确认卡',
}

export function readAdsAutomationSwitches(leadsConfig: unknown): AdsAutomationSwitches {
  const root = objectOf(leadsConfig)
  return {
    ads_predictive_early_warning: root?.[ADS_PREDICTIVE_EARLY_WARNING_KEY] === true,
    ads_trend_check: trendCheckOn(root?.[ADS_TREND_CHECK_KEY]),
    ads_tune_cards: root?.[ADS_TUNE_CARDS_KEY] === true,
  }
}

export function mergeAdsAutomationSwitches(
  leadsConfig: unknown,
  patch: Partial<AdsAutomationSwitches>,
): Record<string, unknown> {
  const next = { ...(objectOf(leadsConfig) ?? {}) }
  if (patch.ads_predictive_early_warning !== undefined) {
    next[ADS_PREDICTIVE_EARLY_WARNING_KEY] = patch.ads_predictive_early_warning
  }
  if (patch.ads_tune_cards !== undefined) {
    next[ADS_TUNE_CARDS_KEY] = patch.ads_tune_cards
  }
  if (patch.ads_trend_check !== undefined) {
    next[ADS_TREND_CHECK_KEY] = nextTrendValue(next[ADS_TREND_CHECK_KEY], patch.ads_trend_check)
  }
  return next
}

/** Null when nothing actually flipped. The work log is only for a real change. */
export function automationSwitchAuditSummary(
  before: AdsAutomationSwitches,
  after: AdsAutomationSwitches,
): string | null {
  const parts: string[] = []
  for (const key of ADS_AUTOMATION_SWITCH_KEYS) {
    if (before[key] === after[key]) continue
    parts.push(`${LABELS[key]} ${before[key] ? '开' : '关'}→${after[key] ? '开' : '关'}`)
  }
  if (parts.length === 0) return null
  return `【Meta 广告】广告自动化开关：${parts.join('；')}。`
}

function trendCheckOn(value: unknown): boolean {
  if (value === true) return true
  return objectOf(value)?.enabled === true
}

function nextTrendValue(current: unknown, enabled: boolean): boolean | Record<string, unknown> {
  const block = objectOf(current)
  if (!block) return enabled
  return { ...block, enabled }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

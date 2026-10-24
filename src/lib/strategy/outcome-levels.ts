/**
 * Goal outcome levels for IMPACT Check.
 *
 * Platform map: magic-engine-platform `app/impact` Check — whether a catalog
 * metric may count as this goal's outcome evidence. No fetch, no orchestrator.
 *
 * Order: exposure/clicks < contact success < qualified lead < closed deal.
 * Keys are PRIMARY_METRIC_CATALOG keys only. `contact_success` has none:
 * the catalog does not split "contacted" from "qualified lead".
 * `signups_count` counts purchase rows, not seats and not leads.
 * CTS deposit / seat rules stay out of this shared module.
 *
 * Not wired. Next call site: `src/app/api/cron/goal-current-value-refresh/route.ts`
 * before a fetched number is stored, and `createGoal` in `src/lib/strategy/goals.ts`
 * before insert. Do not treat a rejected key as zero.
 */

import {
  GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
  PRIMARY_METRIC_CATALOG,
  type GoalIntent,
  type MetricCandidate,
} from '@/types/strategy'

export const OUTCOME_LEVELS = [
  'exposure_or_clicks',
  'contact_success',
  'qualified_lead',
  'closed_deal',
] as const

export type OutcomeLevel = (typeof OUTCOME_LEVELS)[number]

export const OUTCOME_LEVEL_LABEL_ZH: Readonly<Record<OutcomeLevel, string>> = {
  exposure_or_clicks: '曝光/点击',
  contact_success: '联系成功',
  qualified_lead: '合格线索',
  closed_deal: '成交',
}

/** Click keys inside the exposure rung. Other keys on that rung are exposure, not clicks. */
const CLICK_METRIC_KEYS = new Set<string>(['seo_gsc_clicks_28d'])

/**
 * One catalog key, one level. Contact success stays empty on purpose.
 * `phone_calls` sits with the other acquisition counts: the catalog does not
 * mark it as "contacted but not yet qualified".
 */
export const METRIC_KEYS_BY_OUTCOME_LEVEL: Readonly<Record<OutcomeLevel, readonly string[]>> = {
  exposure_or_clicks: [
    'seo_gsc_clicks_28d',
    'organic_traffic',
    'brand_search_volume',
    'social_followers_growth',
    'media_mentions',
    'ai_visibility_score',
    GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
  ],
  contact_success: [],
  qualified_lead: [
    'leads_count',
    'messaging_started',
    'form_submissions',
    'phone_calls',
  ],
  closed_deal: [
    'signups_count',
    'pre_orders_count',
    'orders_count',
    'monthly_revenue',
    'contract_value_signed',
  ],
}

/**
 * Catalog keys that are not an outcome rung. A sales goal may still use one
 * when the catalog recommends `sales`, but it is not a closed deal.
 */
export const CATALOG_KEYS_OUTSIDE_OUTCOME_LEVELS: readonly string[] = [
  'avg_order_value',
  'inventory_units_remaining',
  'inventory_value_remaining',
  'conversion_rate',
  'cart_abandonment_rate',
]

export const SIGNUPS_COUNT_METRIC_KEY = 'signups_count'

/** Purchase-row count. Not seats. Not leads. Not an industry-wide seat rule. */
export const SIGNUPS_COUNT_CAVEAT =
  'signups_count 数的是成交笔数，不是座位数，也不是线索。'

export const OUTCOME_EVIDENCE_REASON_CODES = [
  'unknown_metric',
  'exposure_cannot_replace_deal',
  'lead_cannot_replace_deal',
  'contact_cannot_replace_deal',
  'accepted_closed_deal',
  'accepted_sales_metric_not_deal_count',
  'accepted_for_intent',
  'level_cannot_evidence_intent',
  'not_recommended_for_intent',
] as const

export type OutcomeEvidenceReasonCode = (typeof OUTCOME_EVIDENCE_REASON_CODES)[number]

export interface OutcomeEvidenceJudgement {
  metricKey: string
  intent: GoalIntent
  level: OutcomeLevel | null
  accepted: boolean
  /** True only on the closed-deal rung. A sales rate or stock figure is not a deal. */
  countsAsClosedDeal: boolean
  reasonCode: OutcomeEvidenceReasonCode
  reason: string
  caveat: string | null
}

const LEVEL_OF_KEY: ReadonlyMap<string, OutcomeLevel> = new Map(
  OUTCOME_LEVELS.flatMap((level) =>
    METRIC_KEYS_BY_OUTCOME_LEVEL[level].map((key) => [key, level] as const),
  ),
)

export function outcomeLevelOf(metricKey: string): OutcomeLevel | null {
  return LEVEL_OF_KEY.get(metricKey) ?? null
}

export function compareOutcomeLevels(left: OutcomeLevel, right: OutcomeLevel): -1 | 0 | 1 {
  const delta = OUTCOME_LEVELS.indexOf(left) - OUTCOME_LEVELS.indexOf(right)
  if (delta < 0) return -1
  if (delta > 0) return 1
  return 0
}

/** A rung stands only for itself. A lower rung does not replace a higher one. */
export function levelMayStandFor(candidate: OutcomeLevel, required: OutcomeLevel): boolean {
  return candidate === required
}

function catalogEntry(metricKey: string): MetricCandidate | null {
  return PRIMARY_METRIC_CATALOG.find((metric) => metric.key === metricKey) ?? null
}

function judgement(
  partial: Omit<OutcomeEvidenceJudgement, 'caveat'> & { caveat?: string | null },
): OutcomeEvidenceJudgement {
  return { caveat: null, ...partial }
}

function intentLabel(intent: GoalIntent): string {
  if (intent === 'sales') return '销售'
  if (intent === 'acquisition') return '获客'
  return '曝光'
}

function rejectLowerSalesRung(
  metricKey: string,
  level: 'exposure_or_clicks' | 'qualified_lead' | 'contact_success',
): OutcomeEvidenceJudgement {
  if (level === 'exposure_or_clicks') {
    const noun = CLICK_METRIC_KEYS.has(metricKey) ? '点击' : '曝光'
    return judgement({
      intent: 'sales',
      metricKey,
      level,
      accepted: false,
      countsAsClosedDeal: false,
      reasonCode: 'exposure_cannot_replace_deal',
      reason: `${noun}（${metricKey}）不能代替成交。`,
    })
  }
  if (level === 'qualified_lead') {
    return judgement({
      intent: 'sales',
      metricKey,
      level,
      accepted: false,
      countsAsClosedDeal: false,
      reasonCode: 'lead_cannot_replace_deal',
      reason: `线索（${metricKey}）不能代替成交。`,
    })
  }
  return judgement({
    intent: 'sales',
    metricKey,
    level,
    accepted: false,
    countsAsClosedDeal: false,
    reasonCode: 'contact_cannot_replace_deal',
    reason: `联系成功（${metricKey}）不能代替成交。`,
  })
}

function judgeSales(
  metricKey: string,
  level: OutcomeLevel | null,
  entry: MetricCandidate,
): OutcomeEvidenceJudgement {
  if (level === 'exposure_or_clicks' || level === 'qualified_lead' || level === 'contact_success') {
    return rejectLowerSalesRung(metricKey, level)
  }
  if (level === 'closed_deal') {
    const caveat = metricKey === SIGNUPS_COUNT_METRIC_KEY ? SIGNUPS_COUNT_CAVEAT : null
    return judgement({
      intent: 'sales',
      metricKey,
      level,
      accepted: true,
      countsAsClosedDeal: true,
      reasonCode: 'accepted_closed_deal',
      reason: `「${entry.label_zh}」可以作为销售目标的成交证据。`,
      caveat,
    })
  }
  if (entry.recommended_for.includes('sales')) {
    return judgement({
      intent: 'sales',
      metricKey,
      level: null,
      accepted: true,
      countsAsClosedDeal: false,
      reasonCode: 'accepted_sales_metric_not_deal_count',
      reason: `指标目录把「${entry.label_zh}」标给销售目标，但它不是成交，不能把它读成成交。`,
    })
  }
  return judgement({
    intent: 'sales',
    metricKey,
    level: null,
    accepted: false,
    countsAsClosedDeal: false,
    reasonCode: 'not_recommended_for_intent',
    reason: `「${metricKey}」不是销售目标的结果证据，也不能代替成交。`,
  })
}

function acceptForIntent(
  intent: GoalIntent,
  metricKey: string,
  level: OutcomeLevel | null,
  reason: string,
): OutcomeEvidenceJudgement {
  return judgement({
    intent,
    metricKey,
    level,
    accepted: true,
    countsAsClosedDeal: false,
    reasonCode: 'accepted_for_intent',
    reason,
  })
}

function rejectLevelMismatch(
  intent: GoalIntent,
  metricKey: string,
  level: OutcomeLevel,
  entry: MetricCandidate,
): OutcomeEvidenceJudgement {
  const label = OUTCOME_LEVEL_LABEL_ZH[level]
  return judgement({
    intent,
    metricKey,
    level,
    accepted: false,
    countsAsClosedDeal: false,
    reasonCode: 'level_cannot_evidence_intent',
    reason: `「${entry.label_zh}」属于${label}，不能当作${intentLabel(intent)}目标的结果证据。两层要分开计。`,
  })
}

function judgeAcquisitionOrAwareness(
  intent: 'acquisition' | 'awareness',
  metricKey: string,
  level: OutcomeLevel | null,
  entry: MetricCandidate,
): OutcomeEvidenceJudgement {
  if (level === 'qualified_lead' && intent === 'acquisition') {
    return acceptForIntent(intent, metricKey, level, `「${entry.label_zh}」可以作为获客目标的线索证据。它不是成交。`)
  }
  if (level === 'exposure_or_clicks' && intent === 'awareness') {
    return acceptForIntent(
      intent,
      metricKey,
      level,
      `「${entry.label_zh}」可以作为曝光目标的结果证据。它不是线索，也不是成交。`,
    )
  }
  if (level === 'exposure_or_clicks' && intent === 'acquisition' && entry.recommended_for.includes('acquisition')) {
    return acceptForIntent(
      intent,
      metricKey,
      level,
      `指标目录把「${entry.label_zh}」标给获客目标。它仍是曝光/点击，不是线索，也不是成交。`,
    )
  }
  if (level !== null) return rejectLevelMismatch(intent, metricKey, level, entry)
  if (entry.recommended_for.includes(intent)) {
    return acceptForIntent(
      intent,
      metricKey,
      null,
      `指标目录把「${entry.label_zh}」标给${intentLabel(intent)}目标。它不在曝光、线索或成交这几层上。`,
    )
  }
  return judgement({
    intent,
    metricKey,
    level: null,
    accepted: false,
    countsAsClosedDeal: false,
    reasonCode: 'not_recommended_for_intent',
    reason: `「${entry.label_zh}」不是${intentLabel(intent)}目标的结果证据。`,
  })
}

/**
 * Whether `metricKey` may be the outcome evidence for a goal of `intent`.
 * Unknown keys are rejected. Missing evidence is not zero.
 */
export function judgeOutcomeEvidence(
  intent: GoalIntent,
  metricKey: string,
): OutcomeEvidenceJudgement {
  const entry = catalogEntry(metricKey)
  if (entry === null) {
    return judgement({
      intent,
      metricKey,
      level: null,
      accepted: false,
      countsAsClosedDeal: false,
      reasonCode: 'unknown_metric',
      reason: `「${metricKey}」不在指标目录里，结果未知，不能当成 0，也不能当成证据。`,
    })
  }
  const level = outcomeLevelOf(metricKey)
  if (intent === 'sales') return judgeSales(metricKey, level, entry)
  return judgeAcquisitionOrAwareness(intent, metricKey, level, entry)
}

/**
 * Which metric should an ads action be judged on?
 *
 * The old answer was "ROAS, always" (hard-coded in package-publish.ts and
 * zhuge/action-persister.ts). That is right for a shop and meaningless for
 * everyone else: 30 Kiteroa is a Messenger-objective property lead-gen
 * campaign, so Meta reports no purchase and no purchase_roas — the metric could
 * never arrive, and every action written against it was unattributable from the
 * moment it was created.
 *
 * So the metric follows the objective:
 *   sells something          → ROAS
 *   collects form leads      → cost per lead
 *   starts conversations     → cost per conversation
 *   anything else / unknown  → null, and say so in the log
 *
 * Never guess. A wrong metric is worse than no metric: no metric leaves the
 * action honestly unmeasured, a wrong one buries it as "skipped" forever.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_METRIC_KEY, type AdsMetricKey } from './vocabulary'
import { isAdsMetricPulled } from './metric-registry'

/** Campaign context available at the moment an action is written. */
export interface AdsObjectiveContext {
  /**
   * Platform campaign objective as reported by the platform.
   * Meta: `objective` (OUTCOME_SALES / OUTCOME_LEADS / …).
   * TikTok: `objective_type` (CONVERSIONS / LEAD_GENERATION / REACH / …).
   */
  objective?: string | null
  /**
   * Meta ad-set `destination_type` when known (WEBSITE / MESSENGER / WHATSAPP /
   * ON_AD). OUTCOME_LEADS covers both Instant Forms and click-to-Messenger, and
   * this is the only field that tells them apart.
   */
  destinationType?: string | null
}

export interface AdsExpectedMetricResolution {
  /** The metric to promise, or null when the objective does not imply one. */
  metricKey: AdsMetricKey | null
  /** Human-readable why — logged whenever metricKey is null. */
  reason: string
}

const SALES_OBJECTIVES = new Set([
  'OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES', 'CATALOG_SALES',
])

const LEAD_OBJECTIVES = new Set([
  'OUTCOME_LEADS', 'LEAD_GENERATION',
])

const MESSAGE_OBJECTIVES = new Set([
  'MESSAGES', 'OUTCOME_ENGAGEMENT',
])

/** Ad-set destinations that mean "the outcome is a conversation, not a form". */
const MESSAGING_DESTINATIONS = new Set([
  'MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT', 'MESSAGING_APPS',
])

/**
 * Map a platform campaign objective to the metric its actions should be judged
 * on. Pure — no I/O, safe to call before touching the ad platform.
 */
export function resolveAdsExpectedMetric(
  ctx: AdsObjectiveContext,
): AdsExpectedMetricResolution {
  const objective = ctx.objective?.trim().toUpperCase() ?? ''
  const destination = ctx.destinationType?.trim().toUpperCase() ?? ''

  if (!objective) {
    return { metricKey: null, reason: 'no campaign objective available from the platform' }
  }

  // Destination wins over objective: OUTCOME_LEADS + MESSENGER is a
  // conversation campaign, and its leads arrive as conversations, not forms.
  if (destination && MESSAGING_DESTINATIONS.has(destination)) {
    return {
      metricKey: ADS_METRIC_KEY.COST_PER_CONVERSATION,
      reason: `destination ${destination} — outcome is a conversation`,
    }
  }

  if (SALES_OBJECTIVES.has(objective)) {
    return { metricKey: ADS_METRIC_KEY.ROAS, reason: `objective ${objective} — outcome is a purchase` }
  }
  if (MESSAGE_OBJECTIVES.has(objective)) {
    return {
      metricKey: ADS_METRIC_KEY.COST_PER_CONVERSATION,
      reason: `objective ${objective} — outcome is a conversation`,
    }
  }
  if (LEAD_OBJECTIVES.has(objective)) {
    return { metricKey: ADS_METRIC_KEY.COST_PER_LEAD, reason: `objective ${objective} — outcome is a form lead` }
  }

  return {
    metricKey: null,
    reason: `objective ${objective} has no outcome metric (awareness / traffic objectives are not attributable)`,
  }
}

/**
 * Resolve and log in one step — the shape every action writer wants.
 *
 * A null result is logged rather than swallowed: "we wrote an action nobody can
 * grade" is precisely the event that went unnoticed for three months.
 */
export function resolveAndLogAdsExpectedMetric(
  ctx: AdsObjectiveContext,
  context: string,
): AdsMetricKey | null {
  const { metricKey, reason } = resolveAdsExpectedMetric(ctx)
  if (metricKey === null) {
    console.warn(`[${context}] no expected_metric for this ads action: ${reason}`)
  }
  return metricKey
}

// ── Client-level fallback ─────────────────────────────────────────────────────

/**
 * Outcome metrics in the order we would rather grade a client on.
 * Revenue beats cost-per-outcome; a purchase-driven account should be judged on
 * ROAS even if it also runs a lead form.
 */
const CLIENT_OUTCOME_PRIORITY: readonly AdsMetricKey[] = [
  ADS_METRIC_KEY.ROAS,
  ADS_METRIC_KEY.COST_PER_LEAD,
  ADS_METRIC_KEY.COST_PER_CONVERSATION,
  ADS_METRIC_KEY.CPA,
]

/** How far back a metric row still counts as "this client is measured on it". */
const LOOKBACK_DAYS = 90

/**
 * Pick an outcome metric for an ads action that has no campaign context —
 * a published production package, or a 诸葛亮 prescription at the client level.
 *
 * Answers from data rather than from a guess: whichever outcome metric this
 * client has actually accumulated rows for, highest priority first. A client
 * with no ads outcome data at all gets null — an unmeasured action recorded
 * honestly, instead of a ROAS promise that will never resolve.
 */
export async function resolveClientAdsExpectedMetric(
  supabase: Pick<SupabaseClient, 'from'>,
  clientId: string,
): Promise<AdsMetricKey | null> {
  const since = new Date()
  since.setDate(since.getDate() - LOOKBACK_DAYS)

  const { data, error } = await supabase
    .from('flywheel_metrics')
    .select('metric_key')
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .in('metric_key', CLIENT_OUTCOME_PRIORITY as string[])
    .gte('measured_at', since.toISOString())

  if (error) {
    console.warn(
      `[resolveClientAdsExpectedMetric] ${clientId}: metric lookup failed (${error.message}) — ` +
        'writing the action without an expected_metric rather than guessing one',
    )
    return null
  }

  const present = new Set((data ?? []).map(row => (row as { metric_key: string }).metric_key))
  const hit = CLIENT_OUTCOME_PRIORITY.find(key => present.has(key) && isAdsMetricPulled(key))

  if (!hit) {
    console.warn(
      `[resolveClientAdsExpectedMetric] ${clientId}: no ads outcome metric collected in the ` +
        `last ${LOOKBACK_DAYS} days — action recorded without an expected_metric`,
    )
    return null
  }
  return hit
}

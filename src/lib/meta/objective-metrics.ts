/**
 * Meta action-stat parsing — the objective-aware half of an insights row.
 *
 * Meta reports outcome volume in `actions` and outcome cost in
 * `cost_per_action_type`, both as arrays of `{ action_type, value }`. Which
 * action_type carries the real outcome depends on the campaign objective:
 * a sales campaign reports `purchase`, a lead-form campaign reports `lead`,
 * a click-to-Messenger campaign reports
 * `onsite_conversion.messaging_conversation_started_7d`.
 *
 * Two rules this module never breaks:
 *   1. NEVER sum across action types. Meta's action list is HIERARCHICAL —
 *      parent and child both appear for the same conversions (`lead` is the
 *      aggregate, `onsite_conversion.lead_grouped` its Instant-Form child), so
 *      summing double-counts. Each metric picks ONE type by priority.
 *   2. NEVER substitute 0 for "Meta did not report this". A Messenger campaign
 *      has no purchase ROAS and no cost-per-purchase; the honest value is null,
 *      and a null must not become a data point that attribution then trusts.
 *
 * Ref: https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
 */

/** One entry of Meta's `actions` / `cost_per_action_type` array. */
export interface MetaActionStat {
  action_type: string
  value: string
}

/**
 * `lead` is the aggregate; `onsite_conversion.lead_grouped` is its Instant-Form
 * child. Priority order, never summed.
 */
export const LEAD_ACTION_PRIORITY = ['lead', 'onsite_conversion.lead_grouped']

/** Click-to-WhatsApp / Messenger conversations started. */
export const MESSAGING_ACTION_PRIORITY = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
]

/** Pixel purchases. `purchase` is the aggregate of the offsite variant. */
export const PURCHASE_ACTION_PRIORITY = [
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
]

/** Return the value of the first action type present, by priority. Never sums. */
export function pickAction(
  actions: MetaActionStat[] | undefined,
  priority: string[],
): number {
  if (!actions) return 0
  for (const wanted of priority) {
    const hit = actions.find(a => a.action_type === wanted)
    if (hit) return parseInt(hit.value, 10) || 0
  }
  return 0
}

/**
 * Cost of the first action type present, by priority — as REPORTED by Meta, not
 * derived from spend/count. Returns null when Meta reported no cost for any of
 * them, which is the normal answer for an objective that cannot produce that
 * action (a Messenger campaign has no cost-per-purchase).
 */
export function pickActionCost(
  costPerActionType: MetaActionStat[] | undefined,
  priority: string[],
): number | null {
  if (!costPerActionType) return null
  for (const wanted of priority) {
    const hit = costPerActionType.find(a => a.action_type === wanted)
    if (!hit) continue
    const parsed = parseFloat(hit.value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** Objective-dependent cost metrics of one insights row. All nullable. */
export interface MetaObjectiveCosts {
  /** Cost per purchase / pixel conversion. Null unless the account sells. */
  cpa: number | null
  /** Cost per lead-form submission. Null unless the account runs lead forms. */
  cost_per_lead: number | null
  /** Cost per messaging conversation started. Null unless CTWA / Messenger. */
  cost_per_conversation: number | null
}

/**
 * Extract the objective-dependent cost metrics from a raw insights row.
 *
 * Every field is null when Meta did not report the matching action cost — no
 * fallback to spend/volume arithmetic, no zeros. Callers must skip nulls rather
 * than persist them.
 */
export function parseObjectiveCosts(row: {
  cost_per_action_type?: MetaActionStat[]
}): MetaObjectiveCosts {
  const costs = row.cost_per_action_type
  return {
    cpa:                   pickActionCost(costs, PURCHASE_ACTION_PRIORITY),
    cost_per_lead:         pickActionCost(costs, LEAD_ACTION_PRIORITY),
    cost_per_conversation: pickActionCost(costs, MESSAGING_ACTION_PRIORITY),
  }
}

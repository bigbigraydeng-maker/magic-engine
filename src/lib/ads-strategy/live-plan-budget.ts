/**
 * A live plan's budget stays as approved.
 * A higher budget is a new plan, not an edit of the one already delivering.
 */

export const LIVE_PLAN_INCREASE_REFUSED =
  '在投计划的预算不能在这里加。要加预算，请新开一份计划。这次没有改预算。'

export function refuseLivePlanIncrease(): {
  wroteMeta: false
  readbackCents: null
  reason: string
} {
  return { wroteMeta: false, readbackCents: null, reason: LIVE_PLAN_INCREASE_REFUSED }
}

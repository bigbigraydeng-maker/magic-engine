/**
 * Attribution windows — per-channel measurement timing.
 *
 * Two distinct numbers, previously conflated into one hard-coded `windowDays`:
 *
 *   maturationDays — how long we WAIT after an action before we are willing to
 *     measure it at all. Before this existed, a blog published today was scored
 *     against a window starting today, so a page Google had not even crawled yet
 *     was already on its own report card.
 *
 *   maxWindowDays — how far out we are still willing to look for a reading. It
 *     is a tolerance, not a requirement: we take the FIRST snapshot at or after
 *     the maturation point and give up beyond this bound.
 *
 * Why SEO maturation is 28 days
 * -----------------------------
 * `gsc_performance_snapshots` rows are 28-day ROLLING aggregates (verified in
 * production: every row has period_end - period_start = 28). With any lag under
 * 28 days the "after" reading still contains days from BEFORE the action, so
 * baseline and after overlap and the comparison is contaminated. 28 days is the
 * smallest lag that guarantees a clean, non-overlapping comparison, and it sits
 * at the top of the 14–28 day range Google typically needs to crawl, index and
 * settle rankings for new content.
 *
 * Other channels keep their existing behaviour (measure immediately, 14-day
 * window): pausing an ad set or publishing a post shows its effect within days,
 * and there is no indexing lag to wait out.
 */

export interface AttributionWindow {
  /** Days to wait after the action before a reading counts. */
  maturationDays: number
  /** Furthest out we will still accept a reading. */
  maxWindowDays: number
}

/** Channels not listed keep the historical behaviour. */
export const DEFAULT_ATTRIBUTION_WINDOW: AttributionWindow = {
  maturationDays: 0,
  maxWindowDays: 14,
}

export const ATTRIBUTION_WINDOW_BY_FLYWHEEL: Record<string, AttributionWindow> = {
  seo: { maturationDays: 28, maxWindowDays: 90 },
}

export function getAttributionWindow(flywheel?: string | null): AttributionWindow {
  if (!flywheel) return DEFAULT_ATTRIBUTION_WINDOW
  return ATTRIBUTION_WINDOW_BY_FLYWHEEL[flywheel] ?? DEFAULT_ATTRIBUTION_WINDOW
}

/** Add whole days to an ISO date/timestamp, returning a YYYY-MM-DD string. */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days between two ISO dates (b - a), floored at 0. */
export function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso.slice(0, 10)).getTime()
  const b = new Date(bIso.slice(0, 10)).getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

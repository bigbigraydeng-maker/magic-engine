/**
 * One click-through rate for every ads surface.
 *
 * CTR is clicks ÷ impressions, as a ratio (0.028 = 2.8%).
 * Null only when nothing was served. Zero clicks on served impressions is 0,
 * the worst real day, not a missing value.
 *
 * Never use Meta's outbound_clicks_ctr. That field is "clicks that left Meta",
 * returned as a percent (~0.1 for lead / Messenger campaigns whose clicks stay
 * inside Meta). Mixing it with all-clicks made the account total read 2.8%
 * while the same campaigns, with thousands of clicks, read 0.0% / 0.1%.
 */
export function clickThroughRate(
  clicks: number | null | undefined,
  impressions: number | null | undefined,
): number | null {
  if (clicks == null || impressions == null) return null
  if (!Number.isFinite(clicks) || !Number.isFinite(impressions) || impressions <= 0) return null
  return clicks / impressions
}

export function formatCtr(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

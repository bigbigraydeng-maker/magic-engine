/**
 * Client-safe view of an ad_health_narratives row.
 *
 * The payload column also carries internal-only data written by later jobs
 * (e.g. `portfolio_diagnoses`, with D11 findings and evidence). Whitelist the keys
 * the ads-health page reads so anything added to the payload later stays internal
 * by default. Same fail-closed idea as toClientGrowthView.
 */

export interface NarrativeRowForClient {
  insight_date: string
  overall_verdict: string
  headline: string
  payload: Record<string, unknown> | null
}

/** Keys of `payload` that the ads-health page renders. */
export const CLIENT_NARRATIVE_PAYLOAD_KEYS = [
  'overall_verdict',
  'headline',
  'campaigns',
  'evaluated',
  'generated_for',
] as const

export function toClientNarrativeView<T extends NarrativeRowForClient>(
  row: T | null,
): T | null {
  if (!row) return null
  const source = row.payload ?? {}
  const payload: Record<string, unknown> = {}
  for (const key of CLIENT_NARRATIVE_PAYLOAD_KEYS) {
    if (key in source) payload[key] = source[key]
  }
  return {
    insight_date: row.insight_date,
    overall_verdict: row.overall_verdict,
    headline: row.headline,
    payload,
  } as T
}

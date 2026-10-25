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

/** Keys of each `campaigns[]` item that the ads-health page reads (CampaignNarrative). */
export const CLIENT_CAMPAIGN_KEYS = [
  'campaign_id',
  'campaign_name',
  'verdict',
  'headline',
  'latest_spend_7d',
  'latest_results_7d',
  'frequency_7d',
] as const

const CLIENT_METRIC_KEYS = ['metric', 'verdict', 'baseline', 'ratio'] as const
const CLIENT_CTR_POINT_KEYS = ['date', 'ctr'] as const
const CLIENT_PRESCRIPTION_KEYS = ['kind', 'title', 'why', 'executable', 'execute_hint'] as const

function pick(source: unknown, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!source || typeof source !== 'object') return out
  const src = source as Record<string, unknown>
  for (const key of keys) {
    if (key in src) out[key] = src[key]
  }
  return out
}

function pickAll(list: unknown, keys: readonly string[]): Record<string, unknown>[] {
  return Array.isArray(list) ? list.map(item => pick(item, keys)) : []
}

function toClientCampaign(campaign: unknown): Record<string, unknown> {
  const src = (campaign && typeof campaign === 'object' ? campaign : {}) as Record<string, unknown>
  const out = pick(src, CLIENT_CAMPAIGN_KEYS)
  out.metrics = pickAll(src.metrics, CLIENT_METRIC_KEYS)
  out.ctr_series = pickAll(src.ctr_series, CLIENT_CTR_POINT_KEYS)
  if ('prescription' in src) {
    out.prescription = src.prescription ? pick(src.prescription, CLIENT_PRESCRIPTION_KEYS) : null
  }
  return out
}

export function toClientNarrativeView<T extends NarrativeRowForClient>(
  row: T | null,
): T | null {
  if (!row) return null
  const source = row.payload ?? {}
  const payload: Record<string, unknown> = {}
  for (const key of CLIENT_NARRATIVE_PAYLOAD_KEYS) {
    if (key in source) payload[key] = source[key]
  }
  if (Array.isArray(source.campaigns)) payload.campaigns = source.campaigns.map(toClientCampaign)
  return {
    insight_date: row.insight_date,
    overall_verdict: row.overall_verdict,
    headline: row.headline,
    payload,
  } as T
}

export const LANDSCAPE_FIELD_SOURCE_TYPES = ['meta_ad_library', 'google_maps_rating', 'tripadvisor', 'ai_answer'] as const
export type LandscapeFieldSourceType = (typeof LANDSCAPE_FIELD_SOURCE_TYPES)[number]

export type LandscapeFieldObservation = {
  source_type: LandscapeFieldSourceType
  source_name: string
  source_url: string
  title: string
  excerpt: string
  observed_at: string
  competitor_domain: string | null
  payload: Record<string, unknown>
}

type FieldRow = {
  source_type?: unknown
  source_name?: unknown
  source_url?: unknown
  title?: unknown
  excerpt?: unknown
  observed_at?: unknown
  competitor_domain?: unknown
  payload?: unknown
}

function isSource(value: unknown): value is LandscapeFieldSourceType {
  return typeof value === 'string' && (LANDSCAPE_FIELD_SOURCE_TYPES as readonly string[]).includes(value)
}

export function toLandscapeFieldObservation(row: FieldRow): LandscapeFieldObservation | null {
  if (!isSource(row.source_type)) return null
  if (typeof row.source_name !== 'string' || typeof row.source_url !== 'string' || typeof row.observed_at !== 'string') return null
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {}
  return {
    source_type: row.source_type,
    source_name: row.source_name,
    source_url: row.source_url,
    title: typeof row.title === 'string' ? row.title : '',
    excerpt: typeof row.excerpt === 'string' ? row.excerpt : '',
    observed_at: row.observed_at,
    competitor_domain: typeof row.competitor_domain === 'string' ? row.competitor_domain : null,
    payload,
  }
}

export function clipLandscapeFieldObservations(rows: FieldRow[] | null | undefined): LandscapeFieldObservation[] {
  return (rows ?? []).flatMap(row => {
    const observation = toLandscapeFieldObservation(row)
    return observation ? [observation] : []
  }).slice(0, 12)
}

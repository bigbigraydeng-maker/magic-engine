import { createHash } from 'node:crypto'
import { externalSourceTierSchema, externalSourceTypeSchema, type ExternalObservation, type ExternalSourceTier, type ExternalSourceType } from './contracts'

export type ExternalSourceDefinition = {
  id: string; name: string; type: ExternalSourceType; tier: ExternalSourceTier; market: string
  requires_authorization?: boolean
  default_urls?: readonly string[]
  validity_hours?: number
}

/** Initial source registry. Domains and selectors remain provider configuration, not runtime assumptions. */
export const externalSourceRegistry: readonly ExternalSourceDefinition[] = [
  { id: 'seek-nz', name: 'SEEK', type: 'jobs', tier: 'B', market: 'NZ', validity_hours: 168 },
  { id: 'indeed-nz', name: 'Indeed', type: 'jobs', tier: 'B', market: 'NZ', validity_hours: 168 },
  { id: 'travel-today', name: 'Travel Today', type: 'industry_media', tier: 'B', market: 'NZ/AU', default_urls: ['https://traveltoday.co.nz/news/'], validity_hours: 168 },
  { id: 'travelinc-memo', name: 'TRAVELinc Memo', type: 'industry_media', tier: 'B', market: 'NZ/AU', default_urls: ['https://travelinc.co.nz/'], validity_hours: 168 },
  { id: 'tourism-new-zealand-news', name: 'Tourism New Zealand News', type: 'industry_news', tier: 'B', market: 'NZ', default_urls: ['https://www.tourismnewzealand.com/news-and-activity/'], validity_hours: 168 },
  { id: 'facebook-group-public', name: 'Facebook Group（公开）', type: 'facebook_group', tier: 'B', market: 'public-only', validity_hours: 72 },
  // Controlled source only: authorised export or Meta-approved integration.
  { id: 'facebook-group-authorized', name: 'Facebook Group（授权）', type: 'facebook_group', tier: 'C', market: 'customer-authorized', requires_authorization: true, validity_hours: 72 },
  { id: 'competitor-traffic-apify', name: '竞品网站流量方向（Apify）', type: 'website', tier: 'C', market: 'public-estimate', validity_hours: 720 },
]

export function sourceDefinition(id: string): ExternalSourceDefinition | null {
  return externalSourceRegistry.find(source => source.id === id) ?? null
}

export function sourceDefaultUrls(id: string): readonly string[] {
  return sourceDefinition(id)?.default_urls ?? []
}

export function sourceDefaultValidUntil(id: string, observedAt: string): string | null {
  const hours = sourceDefinition(id)?.validity_hours
  if (!hours) return null
  const observed = Date.parse(observedAt)
  return Number.isFinite(observed) ? new Date(observed + hours * 60 * 60 * 1000).toISOString() : null
}

export function canonicalExternalUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key)
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString()
}

export function observationContentHash(title: string, excerpt: string): string {
  return createHash('sha256').update(`${title.trim()}\n${excerpt.trim()}`).digest('hex')
}

export function normalisePublishedAt(value: string | null | undefined): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function buildExternalObservation(input: {
  client_id: string; source_id: string; source_url: string; title?: string; excerpt: string
  competitor_domain?: string | null; published_at?: string | null; observed_at: string; valid_until?: string | null
  authorization_confirmed?: boolean
  analysis?: ExternalObservation['analysis']
}): ExternalObservation {
  const source = sourceDefinition(input.source_id)
  if (!source) throw new Error('unknown_external_source')
  if (source.requires_authorization && input.authorization_confirmed !== true) throw new Error('source_authorization_required')
  const canonical_url = canonicalExternalUrl(input.source_url)
  const title = input.title?.trim() ?? ''
  const excerpt = input.excerpt.trim()
  return {
    client_id: input.client_id, source_type: externalSourceTypeSchema.parse(source.type), source_tier: externalSourceTierSchema.parse(source.tier),
    source_name: source.name, source_url: input.source_url, canonical_url, title, excerpt,
    competitor_domain: input.competitor_domain ?? null, published_at: normalisePublishedAt(input.published_at),
    observed_at: new Date(input.observed_at).toISOString(),
    valid_until: input.valid_until === undefined ? sourceDefaultValidUntil(input.source_id, input.observed_at) : normalisePublishedAt(input.valid_until),
    content_hash: observationContentHash(title, excerpt), status: 'observed', ...(input.analysis ? { analysis: input.analysis } : {}),
  }
}

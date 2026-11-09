/**
 * Competitor domains — unified read layer.
 *
 * Resolves the canonical competitor list for a client by merging three sources
 * in priority order, then normalising (strip protocol, trailing slash, lowercase).
 *
 * Priority (highest → lowest):
 *   1. clients.competitor_domains              — FDE hand-picked authoritative list
 *   2. master_briefs.competitor_domains        — Brand Brief / Discovery inferred
 *   3. (optional) DataForSEO auto-discovery    — caller supplies fallback list
 *
 * All consumers (SEO Intelligence gap analysis, AI Tracker question generation,
 * GEO Composer, CompetitorSnapshotAdapter, future Competitor Monitor) MUST use
 * this resolver instead of reading clients.competitor_domains / master_briefs
 * directly. This guarantees a single source of truth and consistent priority.
 *
 * Write entry is also single: PATCH /api/clients/[id]/competitor-domains.
 * Direct writes to either table by other code paths are prohibited.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface ResolvedCompetitors {
  /** Final merged + deduplicated list, normalised */
  domains: string[]
  /** Where each domain came from (for UI / debugging) */
  sources: Record<string, 'fde' | 'brief' | 'auto'>
}

/**
 * Normalise a single competitor domain string.
 * "https://Example.COM/" → "example.com"
 * "  https://www.foo.com/path  " → "www.foo.com"  (path stripped, www preserved)
 */
export function normaliseDomain(raw: string): string {
  if (typeof raw !== 'string') return ''
  let d = raw.trim().toLowerCase()
  if (!d) return ''
  // strip scheme
  d = d.replace(/^https?:\/\//, '')
  // strip path / query / fragment
  d = d.split('/')[0]
  d = d.split('?')[0]
  d = d.split('#')[0]
  return d
}

function normaliseList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(d => (typeof d === 'string' ? normaliseDomain(d) : ''))
    .filter(d => d.length > 0)
}

/**
 * Resolve the authoritative competitor list for a client.
 *
 * @param clientId    Client UUID
 * @param autoDomains Optional auto-discovered list (DataForSEO, etc.). Lowest priority.
 * @param max         Cap on returned list size (default 5).
 */
export async function getClientCompetitors(
  clientId: string,
  autoDomains: string[] = [],
  max: number = 5,
  strict = false,
): Promise<ResolvedCompetitors> {
  // Fetch the two persisted sources in parallel.
  const [clientResult, briefResult] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('competitor_domains')
      .eq('id', clientId)
      .maybeSingle(),
    supabaseAdmin
      .from('master_briefs')
      .select('competitor_domains')
      .eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (strict && (clientResult.error || briefResult.error)) throw new Error('competitor_source_read_failed')

  const fdeDomains   = normaliseList(clientResult.data?.competitor_domains)
  const briefDomains = normaliseList(briefResult.data?.competitor_domains)
  const autoNormal   = normaliseList(autoDomains)

  const merged: string[] = []
  const sources: Record<string, 'fde' | 'brief' | 'auto'> = {}

  const add = (domains: string[], source: 'fde' | 'brief' | 'auto') => {
    for (const d of domains) {
      if (merged.length >= max) break
      if (sources[d]) continue   // already added by higher-priority source
      merged.push(d)
      sources[d] = source
    }
  }

  add(fdeDomains, 'fde')
  add(briefDomains, 'brief')
  add(autoNormal, 'auto')

  return { domains: merged, sources }
}

/**
 * Plain string-array variant for legacy callers that don't need source attribution.
 */
export async function getClientCompetitorDomains(
  clientId: string,
  autoDomains: string[] = [],
  max: number = 5,
): Promise<string[]> {
  const resolved = await getClientCompetitors(clientId, autoDomains, max)
  return resolved.domains
}

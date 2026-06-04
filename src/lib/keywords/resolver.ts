/**
 * Primary keywords — unified read layer.
 *
 * Resolves the canonical primary-keyword list for a client by merging two
 * persisted sources in priority order, then normalising (lowercase + trim).
 *
 * Priority (highest → lowest):
 *   1. clients.primary_keywords          — FDE hand-picked authoritative list
 *   2. master_briefs.keyword_seeds       — Brand Brief / Discovery inferred
 *
 * All consumers (SEO Intelligence main metrics, AI Tracker question generation,
 * GEO Composer, Blog topic selection, future modules) MUST use this resolver
 * instead of reading clients.primary_keywords / master_briefs.keyword_seeds
 * directly. This guarantees a single source of truth and consistent priority.
 *
 * Write entry is also single: PATCH /api/clients/[id]/primary-keywords.
 * Direct writes to either table by other code paths are prohibited.
 *
 * Mirrors src/lib/competitors/resolver.ts.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface ResolvedKeywords {
  /** Final merged + deduplicated list, normalised */
  keywords: string[]
  /** Where each keyword came from (for UI / debugging) */
  sources: Record<string, 'fde' | 'brief'>
}

/**
 * Normalise a single keyword string.
 *   "  Vinyl Flooring  " → "vinyl flooring"
 *   "Carpet"             → "carpet"
 */
export function normaliseKeyword(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

function normaliseList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(k => (typeof k === 'string' ? normaliseKeyword(k) : ''))
    .filter(k => k.length > 0)
}

/**
 * Resolve the authoritative primary-keyword list for a client.
 *
 * @param clientId Client UUID
 * @param max      Cap on returned list size (default 10).
 */
export async function getClientKeywords(
  clientId: string,
  max: number = 10,
): Promise<ResolvedKeywords> {
  // Fetch the two persisted sources in parallel.
  const [clientResult, briefResult] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('primary_keywords')
      .eq('id', clientId)
      .maybeSingle(),
    supabaseAdmin
      .from('master_briefs')
      .select('keyword_seeds')
      .eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const fdeKeywords   = normaliseList(clientResult.data?.primary_keywords)
  const briefKeywords = normaliseList(briefResult.data?.keyword_seeds)

  const merged: string[] = []
  const sources: Record<string, 'fde' | 'brief'> = {}

  const add = (keywords: string[], source: 'fde' | 'brief') => {
    for (const k of keywords) {
      if (merged.length >= max) break
      if (sources[k]) continue   // already added by higher-priority source
      merged.push(k)
      sources[k] = source
    }
  }

  add(fdeKeywords, 'fde')
  add(briefKeywords, 'brief')

  return { keywords: merged, sources }
}

/**
 * Plain string-array variant for legacy callers that don't need source attribution.
 */
export async function getClientPrimaryKeywords(
  clientId: string,
  max: number = 10,
): Promise<string[]> {
  const resolved = await getClientKeywords(clientId, max)
  return resolved.keywords
}

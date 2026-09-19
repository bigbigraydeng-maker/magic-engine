/**
 * SEO Meta-Cycle v1 — candidate discovery + merge (step 2 of the six-step
 * chain). New code (spec §3 "无法复用" list): patrol findings and GSC pages
 * come from two different shapes and neither existing module merges/dedupes
 * them.
 *
 * PM 2026-09-20 精简拍板: dropped the third source (DataForSEO gap
 * keywords) entirely — gap candidates have no existing page, and the only
 * action they could map to (new_page) was cut (seo-patrol already routes
 * "build a new page" work to 诸葛亮's kanban). Keeping gap sourcing here
 * would just mean paying for DataForSEO calls whose only possible outcome
 * was always going to be discarded.
 *
 * 魏征 finding #9: a dedup bug here can multiply DataForSEO spend across
 * every enabled client, so URL normalisation (trailing slash, casing) is
 * pulled into one pure, directly-unit-tested function.
 */

import type { MetaCycleCandidate, MetaCycleCandidateSource } from './types'

/** Same normalisation shape as seo/post-publish-monitor.ts's canonicalPageUrl,
 *  reimplemented here (not imported) because that file's normalisation is
 *  tied to its own page-probe pipeline — see spec §3, this is new code. */
export function normaliseCandidateUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    let pathname = url.pathname.replace(/\/+$/, '')
    if (pathname === '') pathname = '/'
    return `${url.protocol}//${url.hostname.toLowerCase()}${pathname}${url.search}`
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, '')
  }
}

function slugFromUrl(pageUrl: string): string | null {
  try {
    const path = new URL(pageUrl).pathname.replace(/\/+$/, '')
    const slug = path.split('/').pop() ?? ''
    return slug && !slug.includes('.') ? slug : null
  } catch {
    return null
  }
}

/** Dedup key: prefer the normalised URL (same page); fall back to slug, then keyword. */
function dedupeKey(c: MetaCycleCandidate): string {
  if (c.pageUrl) return `url:${normaliseCandidateUrl(c.pageUrl)}`
  if (c.slug) return `slug:${c.slug.toLowerCase()}`
  return `kw:${c.keyword.trim().toLowerCase()}`
}

/** Priority when the same page shows up from both sources — patrol already
 *  ran real rule evaluation, so its IDENTITY fields (keyword match, position
 *  source) win. Numeric fields are merged field-by-field regardless (see
 *  mergeCandidates) rather than an all-or-nothing pick, so a low-priority
 *  source's data isn't thrown away just because a higher-priority source
 *  also found the page (子牙+魏征 both flagged this as a real dropped-field
 *  bug in the original all-or-nothing merge). */
const SOURCE_PRIORITY: Record<MetaCycleCandidateSource, number> = {
  patrol: 2,
  gsc: 1,
}

export interface RawPatrolFinding {
  keyword: string | null
  url: string | null
  position: number | null
  ctr: number | null
  searchVolume: number | null
  keywordDifficulty: number | null
}

export interface RawGscPage {
  page?: string
  impressions?: number
  position?: number
  ctr?: number
}
export interface RawGscQuery {
  query?: string
  impressions?: number
}

const MIN_POSITION = 4
const MAX_POSITION = 20
const MIN_IMPRESSIONS = 10

/** Generalised, client-agnostic version of cts-meta-pr.ts's pickCandidates
 *  (that one stays CTS-narrow-lane specific — see its docstring). Same
 *  GSC 4-20/impressions≥10 window, but no CTS branding, reusable per client. */
export function fromGscPages(
  topPages: RawGscPage[],
  topQueries: RawGscQuery[],
): MetaCycleCandidate[] {
  const out: MetaCycleCandidate[] = []
  for (const page of topPages) {
    if (
      !page.page ||
      (page.position ?? 0) < MIN_POSITION ||
      (page.position ?? 0) > MAX_POSITION ||
      (page.impressions ?? 0) < MIN_IMPRESSIONS
    ) {
      continue
    }
    const slug = slugFromUrl(page.page)
    if (!slug) continue

    const tokens = slug.split('-').filter((t) => t.length > 3)
    const match = topQueries
      .map((q) => ({
        q,
        score: q.query ? tokens.filter((t) => q.query!.toLowerCase().includes(t)).length : 0,
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || (b.q.impressions ?? 0) - (a.q.impressions ?? 0))[0]?.q

    out.push({
      pageUrl: page.page,
      slug,
      keyword: match?.query ?? slug.replace(/-/g, ' '),
      source: 'gsc',
      position: page.position ?? null,
      impressions: page.impressions ?? null,
      ctr: page.ctr ?? null,
      searchVolume: null,
      keywordDifficulty: null,
    })
  }
  return out
}

export function fromPatrolFindings(findings: RawPatrolFinding[]): MetaCycleCandidate[] {
  return findings
    .filter((f) => f.url || f.keyword)
    .map((f) => ({
      pageUrl: f.url,
      slug: f.url ? slugFromUrl(f.url) : null,
      keyword: f.keyword ?? (f.url ? slugFromUrl(f.url)?.replace(/-/g, ' ') ?? f.url : ''),
      source: 'patrol' as const,
      position: f.position,
      impressions: null,
      ctr: f.ctr,
      searchVolume: f.searchVolume,
      keywordDifficulty: f.keywordDifficulty,
    }))
}

/** Field-level merge of two candidates that dedupe to the same key: identity
 *  and position come from the higher-priority one, but any numeric field
 *  the higher-priority candidate is missing gets filled from the
 *  lower-priority one instead of being silently dropped. */
function mergeFields(winner: MetaCycleCandidate, loser: MetaCycleCandidate): MetaCycleCandidate {
  return {
    ...winner,
    impressions: winner.impressions ?? loser.impressions,
    ctr: winner.ctr ?? loser.ctr,
    searchVolume: winner.searchVolume ?? loser.searchVolume,
    keywordDifficulty: winner.keywordDifficulty ?? loser.keywordDifficulty,
  }
}

/**
 * Merge the two candidate sources, dedupe by normalised URL/slug/keyword
 * (field-level merge on collision — see mergeFields), exclude the cooldown
 * set, and cap to `max`.
 *
 * Pure — no DB/network access — so the dedup logic is directly unit-testable
 * per 魏征 finding #9.
 */
export function mergeCandidates(
  sources: { patrol: MetaCycleCandidate[]; gsc: MetaCycleCandidate[] },
  cooldownSlugs: ReadonlySet<string>,
  max: number,
): MetaCycleCandidate[] {
  const byKey = new Map<string, MetaCycleCandidate>()

  for (const source of [sources.patrol, sources.gsc]) {
    for (const candidate of source) {
      if (candidate.slug && cooldownSlugs.has(candidate.slug)) continue

      const key = dedupeKey(candidate)
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, candidate)
      } else if (SOURCE_PRIORITY[candidate.source] > SOURCE_PRIORITY[existing.source]) {
        byKey.set(key, mergeFields(candidate, existing))
      } else {
        byKey.set(key, mergeFields(existing, candidate))
      }
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, max)
}

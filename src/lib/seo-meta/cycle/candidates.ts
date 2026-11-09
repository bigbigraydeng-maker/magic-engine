/**
 * SEO Meta-Cycle v1 — candidate discovery (step 2).
 *
 * 复审 2026-09-20（第三轮）item A.1: candidates now come ONLY from GSC page
 * data — patrol was dropped entirely. Two reasons, both from real code
 * inspection, not speculation:
 *   1. seo-patrol's `low_ctr_title` rule (rules.ts:117) scores CTR against a
 *      single KEYWORD's CTR, but this cycle's T+14 Check compares whole-PAGE
 *      CTR (gsc_performance_snapshots.top_pages, matching readPageMetrics).
 *      Mixing the two units into one baseline would misjudge "improved"/
 *      "regressed" against a metric the candidate was never scored on.
 *   2. A patrol finding with a `url` but no ranking `position` most often
 *      means "not indexed" or "missing internal link" (see rules.ts), not
 *      "this page's title has room to improve." Treating every url-bearing
 *      patrol finding as a title_rewrite candidate risked auto-editing and
 *      auto-merging a title change onto the WRONG page for the wrong reason.
 *
 * GSC-only means impressions and CTR are always a matched pair from the
 * SAME page-level GSC row — no cross-source unit mismatch is possible.
 *
 * 事故 2026-09-20（W38 首次上线）根因: this file used to also guess a target
 * keyword by token-overlap against the client's SITE-WIDE top_queries list.
 * That guess is GONE — `keyword` below is now only ever a slug-derived
 * placeholder. The real keyword comes exclusively from gate.ts's
 * deriveTopicMatchedKeyword(), which asks GSC what THIS page's own queries
 * are, never a site-wide list a different page's query could leak in from.
 */

import type { MetaCycleCandidate } from './types'

/** Same normalisation shape as seo/post-publish-monitor.ts's canonicalPageUrl,
 *  reimplemented here (not imported) because that file's normalisation is
 *  tied to its own page-probe pipeline. */
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

export interface RawGscPage {
  page?: string
  impressions?: number
  position?: number
  ctr?: number
}

const MIN_POSITION = 4
const MAX_POSITION = 20
const MIN_IMPRESSIONS = 10

/** Generalised, client-agnostic version of cts-meta-pr.ts's pickCandidates
 *  (that one stays CTS-narrow-lane specific — see its docstring, and it has
 *  no ctr field, which this cycle needs for baseline_ctr). Same GSC 4-20/
 *  impressions≥10 window, but no CTS branding, reusable per client.
 *
 *  No `topQueries` parameter anymore — see file header. `keyword` is a
 *  slug-derived placeholder only; gate.ts overwrites it with a real,
 *  page-verified one before anything gets written. */
export function fromGscPages(topPages: RawGscPage[]): MetaCycleCandidate[] {
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

    out.push({
      pageUrl: page.page,
      slug,
      keyword: slug.replace(/-/g, ' '),
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

/**
 * Dedupe by normalised URL (defensive — a GSC snapshot should not carry two
 * rows for the same page, but trailing-slash/case variants are cheap to
 * guard against), exclude the cooldown set, sort by impressions desc, cap
 * to `max`.
 *
 * Pure — no DB/network access — so the dedup logic is directly unit-testable
 * per 魏征 finding #9.
 */
export function mergeCandidates(
  candidates: MetaCycleCandidate[],
  cooldownSlugs: ReadonlySet<string>,
  max: number,
): MetaCycleCandidate[] {
  const byKey = new Map<string, MetaCycleCandidate>()

  for (const candidate of candidates) {
    if (candidate.slug && cooldownSlugs.has(candidate.slug)) continue
    const key = candidate.pageUrl ? normaliseCandidateUrl(candidate.pageUrl) : candidate.keyword.trim().toLowerCase()
    if (!byKey.has(key)) byKey.set(key, candidate)
  }

  return Array.from(byKey.values())
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, max)
}

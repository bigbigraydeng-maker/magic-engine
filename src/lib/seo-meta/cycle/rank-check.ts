/**
 * SEO Meta-Cycle — target-keyword rank reading (2026-10-04 rank-verification redesign).
 *
 * Why this exists: the T+14 page-CTR before/after check cannot separate a real
 * effect from noise at a small client's traffic (placebo over a window with no
 * title changes: 41% of eligible pages got called "improved"/"regressed"). The
 * rank of the TARGET keyword is a much steadier ruler, but only if every reading
 * is taken the same way — see the three traps this module encodes:
 *
 *  1. "Not in the top N" is a STATUS, never a number. Storing 0 would read as
 *     "ranked first"; storing N+1 would manufacture a fake move.
 *  2. Rank = organic `rank_group`, not `rank_absolute`. The latter counts AI
 *     Overview / People-also-ask / video blocks, so it shifts when Google adds a
 *     block even though nothing about the page changed.
 *  3. If a DIFFERENT page of the same domain ranks for the keyword, that is not
 *     "the target page's rank" — it is recorded as `other_own_page`.
 *
 * Pure extraction + one fetch wrapper that never throws (a failed fetch is a
 * `fetch_failed` reading, not a missing one — the verdict logic treats the two
 * very differently).
 */

import { getOrganicRanks, type OrganicRankItem, type OrganicRankSnapshot } from '@/lib/dataforseo/serp'

export type RankStatus = 'ranked' | 'not_in_top_n' | 'other_own_page' | 'fetch_failed'

/**
 * SERP depth for every baseline and sample: the first three result pages. The
 * old gate fetch only saw the top 10, which would blind this ruler for any
 * keyword the client ranks 11–30 for. Persisted per row (baseline_serp_depth),
 * so changing this constant later cannot make old and new rows silently
 * comparable.
 */
export const RANK_SERP_DEPTH = 30

export interface RankReading {
  status: RankStatus
  /** Organic rank_group of the target page. Non-null only when status === 'ranked'. */
  rankGroup: number | null
  /** The URL that ranked: the target page when ranked, the other own page when other_own_page. */
  url: string | null
  depth: number
  fetchedAt: string
  /** The target URL appeared more than once in the SERP; the best (lowest) rank was used. */
  duplicateUrl: boolean
  /** DataForSEO per-task cost in USD when reported. */
  cost: number | null
  error?: string
}

/** Lower-case hostname without a leading "www." — tolerates a bare domain, a full URL, or a trailing slash. */
export function hostOf(domainOrUrl: string): string {
  const raw = domainOrUrl.trim()
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0].toLowerCase()
  }
}

/** host + path with no scheme, query, fragment or trailing slash — what "the same page" means for rank matching. */
export function pageKeyOf(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path === '' ? '/' : path}`
  } catch {
    return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function isOwnDomain(item: OrganicRankItem, ownHost: string): boolean {
  const itemHost = item.domain ? hostOf(item.domain) : hostOf(item.url)
  return itemHost === ownHost
}

/**
 * Pure: read the client's rank for the target page out of an organic SERP snapshot.
 *
 * - target page present            → ranked (best rank_group; duplicateUrl flags a repeated URL)
 * - only some other own page ranks → other_own_page (NOT the target's rank)
 * - own domain absent              → not_in_top_n (absent from the first `depth` results — it does
 *   NOT mean "does not rank at all")
 */
export function extractTargetRank(snapshot: OrganicRankSnapshot, domain: string, targetUrl: string): RankReading {
  const ownHost = hostOf(domain)
  const targetKey = pageKeyOf(targetUrl)
  const own = snapshot.items.filter((it) => isOwnDomain(it, ownHost))
  const base = { depth: snapshot.depth, fetchedAt: snapshot.fetchedAt, cost: snapshot.cost }

  const targetHits = own.filter((it) => pageKeyOf(it.url) === targetKey)
  if (targetHits.length > 0) {
    const best = targetHits.reduce((a, b) => (b.rankGroup < a.rankGroup ? b : a))
    return { status: 'ranked', rankGroup: best.rankGroup, url: best.url, duplicateUrl: targetHits.length > 1, ...base }
  }
  if (own.length > 0) {
    const best = own.reduce((a, b) => (b.rankGroup < a.rankGroup ? b : a))
    return { status: 'other_own_page', rankGroup: null, url: best.url, duplicateUrl: false, ...base }
  }
  return { status: 'not_in_top_n', rankGroup: null, url: null, duplicateUrl: false, ...base }
}

export interface FetchTargetRankInput {
  keyword: string
  countryCode: 'au' | 'nz'
  /** The client's domain (bare or with scheme). */
  domain: string
  targetUrl: string
  /** Defaults to RANK_SERP_DEPTH. A sample compared against a stored baseline must pass that baseline's depth. */
  depth?: number
}

export type FetchTargetRankFn = (input: FetchTargetRankInput) => Promise<RankReading>

/** Never throws: a provider/network/config failure is returned as a `fetch_failed` reading. */
export const fetchTargetRank: FetchTargetRankFn = async (input) => {
  const depth = input.depth ?? RANK_SERP_DEPTH
  try {
    const snapshot = await getOrganicRanks(input.keyword, input.countryCode, { depth })
    return extractTargetRank(snapshot, input.domain, input.targetUrl)
  } catch (err) {
    return {
      status: 'fetch_failed',
      rankGroup: null,
      url: null,
      depth,
      fetchedAt: new Date().toISOString(),
      duplicateUrl: false,
      cost: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

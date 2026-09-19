/**
 * SEO Meta-Cycle v1 — information-completeness gate (PM 2026-09-20, incident
 * follow-up after CTS W38's first real run auto-merged two factually wrong
 * title/description changes: chinatravel #199 assigned "how many days in
 * chongqing" — another page's query — to the Liziba station guide, and #200
 * assigned an "application steps" query to a page whose real content is
 * "visa-free, no application needed", producing a description that
 * contradicted the page).
 *
 * PM's hard rule: if ANY of these five checks fails, the candidate is
 * SKIPPED — never degraded, never falls back to a different keyword. Every
 * check's failure is returned as a MetaCycleGateFailure so nothing goes
 * silently missing from the receipt (root cause #4 below).
 *
 * Root causes this file fixes (confirmed by code inspection of the shipped
 * v1, not speculation — see the PR description for the full write-up):
 *   1. candidates.ts's fromGscPages picked a target keyword by token-overlap
 *      against the client's SITE-WIDE top_queries list, not queries GSC
 *      actually attributes to THAT page — a low-traffic page with no
 *      strongly-matching query in the top-N list would fall back to
 *      whatever OTHER page's query happened to share one token. Fixed by
 *      deriveTopicMatchedKeyword() below, which asks GSC for this page's
 *      OWN queries (fetchGscQueriesForPage) instead of guessing.
 *   2. keyword_snapshots (DataForSEO-sourced) rarely has an exact-string
 *      match for a raw GSC query phrase (different vocabularies/casing/
 *      phrasing) — search volume/difficulty silently stayed null, and
 *      action-mapping.ts's `(candidate.keywordDifficulty ?? 0)` treated a
 *      null difficulty as 0 (i.e. "definitely fine"), so missing data never
 *      blocked anything. Fixed by checkKeywordSnapshot() below, which is a
 *      hard requirement, not a best-effort enrichment.
 *   3. Even when DataForSEO data WAS available, apply-adapter.ts's PR body
 *      template never included it — a template omission, not a failed call.
 *      Fixed by threading MetaCycleGateEvidence through to the PR body (see
 *      apply-adapter.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchGscQueriesForPage } from '@/lib/gsc/client'
import { getSerpPage } from '@/lib/dataforseo/serp'
import type { MetaCycleCandidate, MetaCycleClientConfig, MetaCycleGateEvidence, MetaCycleGateFailure } from './types'

export const GATE_REASON = {
  NO_PAGE_SCOPED_KEYWORD: 'no_page_scoped_keyword_match',
  SNAPSHOT_MISSING_OR_STALE: 'keyword_snapshot_missing_or_stale',
  KEYWORD_REUSED: 'keyword_reused_by_another_page_90d',
  SERP_SELF_CANNIBALIZATION: 'serp_shows_different_own_page_ranking',
  DIFFICULTY_TOO_HIGH: 'difficulty_above_floor',
} as const

/** Same floor action-mapping.ts used pre-gate — kept as part of the gate now that difficulty is a hard-required field, not a best-effort one. */
export const SKIP_DIFFICULTY_FLOOR = 70

const KEYWORD_SNAPSHOT_MAX_AGE_DAYS = 14
const KEYWORD_REUSE_WINDOW_DAYS = 90

/**
 * Which of a page's own GSC queries counts as "on-topic". The page's most
 * distinctive slug token (longest word >3 chars) must appear in the query —
 * e.g. "liziba" for liziba-station-chongqing-guide. Picking the LONGEST
 * token, not just any token, is what stops "chongqing" (shared by many CTS
 * pages) from qualifying a query on its own — the exact collision that
 * caused the incident.
 */
function coreTopicToken(slug: string): string | null {
  const tokens = slug.split('-').filter((t) => t.length > 3)
  if (tokens.length === 0) return null
  return tokens.reduce((longest, t) => (t.length > longest.length ? t : longest), tokens[0])
}

/**
 * Step 1 of the gate: derive the REAL target keyword from this page's own
 * live GSC queries — never from a site-wide list. Returns null (→ skip) if
 * GSC has no queries for this page, or none contain the page's core topic
 * token.
 */
export async function deriveTopicMatchedKeyword(
  siteUrl: string,
  candidate: MetaCycleCandidate,
  clientId: string,
): Promise<{ keyword: string; impressions: number } | { failure: MetaCycleGateFailure }> {
  const fail = (detail: string): { failure: MetaCycleGateFailure } => ({
    failure: { candidate, reason: GATE_REASON.NO_PAGE_SCOPED_KEYWORD, detail },
  })

  if (!candidate.pageUrl || !candidate.slug) return fail('candidate has no page URL/slug to query GSC for')
  const coreToken = coreTopicToken(candidate.slug)
  if (!coreToken) return fail(`slug "${candidate.slug}" has no token long enough to use as a topic check`)

  const rows = await fetchGscQueriesForPage(siteUrl, candidate.pageUrl, clientId).catch(() => null)
  if (!rows || rows.length === 0) {
    return fail(`GSC returned no page-scoped queries for ${candidate.pageUrl} — cannot verify topic match`)
  }

  const onTopic = rows
    .filter((r) => typeof r.query === 'string' && r.query.toLowerCase().includes(coreToken))
    .sort((a, b) => b.impressions - a.impressions)[0]

  if (!onTopic || typeof onTopic.query !== 'string') {
    return fail(`none of this page's own GSC queries contain its core topic word "${coreToken}" — refusing to borrow a query from another page`)
  }

  return { keyword: onTopic.query, impressions: onTopic.impressions }
}

/**
 * Step 2: search volume + difficulty MUST come from a fresh (≤14 day)
 * keyword_snapshots row — a hard requirement, not a best-effort fill.
 */
export async function checkKeywordSnapshot(
  supabase: SupabaseClient,
  clientId: string,
  keyword: string,
): Promise<{ searchVolume: number; keywordDifficulty: number; snapshotDate: string } | { failure: string }> {
  const { data, error } = await supabase
    .from('keyword_snapshots')
    .select('search_volume, keyword_difficulty, snapshot_date')
    .eq('client_id', clientId)
    .ilike('keyword', keyword)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { failure: `keyword_snapshots lookup failed: ${error.message}` }
  const row = data as { search_volume: number | null; keyword_difficulty: number | null; snapshot_date: string } | null
  if (!row) return { failure: `no keyword_snapshots row for "${keyword}"` }

  const ageDays = (Date.now() - new Date(row.snapshot_date).getTime()) / 86_400_000
  if (ageDays > KEYWORD_SNAPSHOT_MAX_AGE_DAYS) {
    return { failure: `keyword_snapshots row for "${keyword}" is ${Math.round(ageDays)} days old (floor ${KEYWORD_SNAPSHOT_MAX_AGE_DAYS})` }
  }
  if (row.search_volume === null || row.keyword_difficulty === null) {
    return { failure: `keyword_snapshots row for "${keyword}" is missing search_volume or keyword_difficulty` }
  }

  return { searchVolume: row.search_volume, keywordDifficulty: row.keyword_difficulty, snapshotDate: row.snapshot_date }
}

/** Step 3: the SAME keyword must not have been assigned to a DIFFERENT page in the last 90 days (excludes reverted rows — those were never a real, standing assignment). */
export async function checkNoRecentReuse(
  supabase: SupabaseClient,
  clientId: string,
  keyword: string,
  slug: string,
): Promise<{ ok: true } | { failure: string }> {
  const cutoff = new Date(Date.now() - KEYWORD_REUSE_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select('page_slug')
    .eq('client_id', clientId)
    .ilike('keyword', keyword)
    .neq('page_slug', slug)
    .is('reverted_at', null)
    .gte('optimised_at', cutoff)
    .limit(1)

  if (error) return { failure: `seo_meta_log reuse lookup failed: ${error.message}` }
  const other = (data ?? [])[0] as { page_slug: string } | undefined
  if (other) return { failure: `"${keyword}" was already used for /${other.page_slug} within the last ${KEYWORD_REUSE_WINDOW_DAYS} days` }
  return { ok: true }
}

/**
 * Step 4: live SERP check for the keyword — if this client ranks for it
 * ANYWHERE in the results, that URL must be THIS candidate's page. A
 * different one of the client's own pages ranking instead is exactly the
 * self-cannibalization shape the incident hit (assigning a query to a page
 * that isn't actually the one competing for it).
 */
export async function checkSerpOwnership(
  keyword: string,
  countryCode: 'au' | 'nz',
  candidate: MetaCycleCandidate,
  domain: string,
): Promise<{ top3Titles: string[]; ctsRankingUrl: string | null } | { failure: string }> {
  const serp = await getSerpPage(keyword, countryCode).catch((err: unknown) => {
    throw new Error(`SERP fetch failed for "${keyword}": ${err instanceof Error ? err.message : String(err)}`)
  })
  const host = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '').toLowerCase()
  const ownResult = serp.organic_results.find((r) => {
    try {
      return new URL(r.url).hostname.replace(/^www\./, '').toLowerCase() === host
    } catch {
      return false
    }
  })

  if (ownResult && candidate.pageUrl) {
    const normalise = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase()
    if (normalise(ownResult.url) !== normalise(candidate.pageUrl)) {
      return { failure: `SERP shows a DIFFERENT own page (${ownResult.url}) ranking for "${keyword}", not this candidate (${candidate.pageUrl}) — would be self-cannibalization` }
    }
  }

  return {
    top3Titles: serp.organic_results.slice(0, 3).map((r) => r.title).filter((t): t is string => Boolean(t)),
    ctsRankingUrl: ownResult?.url ?? null,
  }
}

/**
 * GSC's registered property URL for this client — NOT simply "https://" +
 * clients.domain (properties are often registered with a different exact
 * form, e.g. www vs apex, or a domain-property). Read from the same
 * `client_connectors` (anchor='gsc') row every other GSC caller in this
 * codebase uses (src/lib/seo-patrol/index-check.ts, the GSC pullback cron)
 * — resolved ONCE per client run, not per-candidate.
 */
export async function resolveGscSiteUrl(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('client_connectors')
    .select('config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .maybeSingle()
  const siteUrl = (data as { config?: { site_url?: unknown } } | null)?.config?.site_url
  return typeof siteUrl === 'string' && siteUrl.trim().length > 0 ? siteUrl.trim() : null
}

/**
 * Runs the full gate for one candidate. Returns either a complete
 * MetaCycleGateEvidence (every check passed) or the FIRST failure
 * encountered (checks run in the order PM specified: topic → snapshot →
 * reuse → SERP → difficulty).
 */
export async function runGateForCandidate(
  supabase: SupabaseClient,
  config: MetaCycleClientConfig,
  candidate: MetaCycleCandidate,
  siteUrl: string,
): Promise<{ evidence: MetaCycleGateEvidence; candidate: MetaCycleCandidate } | MetaCycleGateFailure> {
  const topicResult = await deriveTopicMatchedKeyword(siteUrl, candidate, config.clientId)
  if ('failure' in topicResult) return topicResult.failure
  const { keyword } = topicResult

  const snapshotResult = await checkKeywordSnapshot(supabase, config.clientId, keyword)
  if ('failure' in snapshotResult) return { candidate, reason: GATE_REASON.SNAPSHOT_MISSING_OR_STALE, detail: snapshotResult.failure }

  if (snapshotResult.keywordDifficulty > SKIP_DIFFICULTY_FLOOR) {
    return { candidate, reason: GATE_REASON.DIFFICULTY_TOO_HIGH, detail: `difficulty ${snapshotResult.keywordDifficulty} > ${SKIP_DIFFICULTY_FLOOR} for "${keyword}"` }
  }

  const reuseResult = await checkNoRecentReuse(supabase, config.clientId, keyword, candidate.slug ?? '')
  if ('failure' in reuseResult) return { candidate, reason: GATE_REASON.KEYWORD_REUSED, detail: reuseResult.failure }

  const countryCode = config.semrushDb === 'nz' ? 'nz' : 'au'
  let serpResult: Awaited<ReturnType<typeof checkSerpOwnership>>
  try {
    serpResult = await checkSerpOwnership(keyword, countryCode, candidate, config.domain)
  } catch (err) {
    return { candidate, reason: GATE_REASON.SERP_SELF_CANNIBALIZATION, detail: err instanceof Error ? err.message : String(err) }
  }
  if ('failure' in serpResult) return { candidate, reason: GATE_REASON.SERP_SELF_CANNIBALIZATION, detail: serpResult.failure }

  const evidence: MetaCycleGateEvidence = {
    keyword,
    searchVolume: snapshotResult.searchVolume,
    keywordDifficulty: snapshotResult.keywordDifficulty,
    snapshotDate: snapshotResult.snapshotDate,
    competitorTitles: serpResult.top3Titles,
    ctsRankingUrl: serpResult.ctsRankingUrl,
    chosenReason: `page's own GSC queries include "${keyword}" (${topicResult.impressions} impressions), which contains this page's core topic word`,
  }

  return { evidence, candidate: { ...candidate, keyword } }
}

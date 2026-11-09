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
 *
 * PM 2026-09-20, second follow-up (after the fixed gate's first real dry run
 * against W38's 9 candidates surfaced 3 more gaps, none of them wrong writes
 * — the gate correctly blocked everything, but blocked too eagerly or too
 * late):
 *   4. 7 of 9 candidates hit keyword_snapshot_missing_or_stale — the weekly
 *      snapshot job only tracks each client's ~200 currently-RANKED
 *      keywords (snapshotRankedKeywordsForClient), so a page-scoped GSC
 *      query this gate just derived is very often not in that set yet.
 *      Fixed: checkKeywordSnapshot() now falls back to ONE live DataForSEO
 *      call per candidate when the snapshot is missing/stale — labs.ts's
 *      bulkKeywordVolume (keyword_overview/live, fixed 2026-08-26, see that
 *      function's header — NOT search-volume.ts's getSearchVolume, which
 *      doesn't return difficulty at all). PM's hard rule (2026-09-20, third
 *      pass): search volume AND difficulty must BOTH be present, from
 *      either source — a partial live result (e.g. volume but no
 *      difficulty) is exactly as unusable as no result, and must be
 *      skipped with reason keyword_data_unavailable, never let through with
 *      a null/assumed difficulty. A thrown lookup error (including
 *      DataForSeoTaskError) is caught and turned into the same skip — never
 *      swallowed into a silent "continue as if it passed".
 *   5. The forbidden-city-travel-guide candidate burned a full gate run
 *      (GSC + DataForSEO + SERP) before failing in apply-adapter.ts with
 *      skipReason:'slug_not_in_any_data_file' — a check that was always
 *      going to fail regardless of what the gate found. Fixed: ApplyAdapter
 *      now exposes canEditSlug(), checked FIRST in runStep3Gate (runner.ts)
 *      before any live call.
 *   6. The leshan-giant-buddha page's highest-impression on-topic query was
 *      the French "leshan au départ de chengdu" — CTS's audience is NZ
 *      English readers. Fixed: deriveTopicMatchedKeyword() now filters
 *      on-topic queries to ASCII-only (isEnglishQuery) before ranking by
 *      impressions, so it naturally falls through to the page's own
 *      next-best English query instead of borrowing a non-English one.
 *
 * PM 2026-09-20, fourth pass (still zero wrong writes — DataForSEO simply
 * doesn't index many small-market long-tail queries at all, primary market
 * or not, so keyword_data_unavailable was blocking candidates that had
 * perfectly real demand, just not DataForSEO-visible demand): resolving
 * search volume/difficulty is now a 3-tier waterfall (resolveKeywordData),
 * available to every client (not CTS-specific), each tier requiring BOTH
 * fields non-null before it counts as a pass:
 *   1. dataforseo_primary  — the client's own market (keyword_snapshots row,
 *      or a live bulkKeywordVolume call at that location).
 *   2. dataforseo_fallback — client-configured location_codes (PM: CTS
 *      configures [2036]/AU because "AU↔NZ 数据互补" doesn't hold for every
 *      industry/client, so this is per-client config —
 *      MetaCycleClientConfig.keywordFallbackLocations — never a shared
 *      default).
 *   3. gsc_serp            — neither DataForSEO location had data at all.
 *      searchVolume becomes this page's own GSC impressions for the keyword
 *      (already fetched by deriveTopicMatchedKeyword — reused, not
 *      re-queried), gated at the SAME ≥30 floor outcome-classifier.ts uses
 *      for "is this even a real sample". keywordDifficulty becomes the
 *      average DataForSEO domain-authority score (getDomainMetrics,
 *      backlink-rank-derived, 0–100) of the SERP's top-3 competitor domains
 *      — reusing the SAME live SERP call checkSerpOwnership already makes
 *      for the self-cannibalization check, not a second one. No hardcoded
 *      "big site" domain list anywhere — authority comes from DataForSEO's
 *      own backlink data per domain, generically, for any client/industry.
 * Every tier's failure reason is recorded; if all three fail, the failure
 * detail lists what each one tried and why it didn't work. Every result
 * carries keywordDataSource + keywordDataLocation + a human-readable
 * keywordDataNote (PM: "都用人话标来源") into the PR body, dry-run JSON, and
 * the step-4 receipt.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchGscQueriesForPage } from '@/lib/gsc/client'
import { getSerpPage } from '@/lib/dataforseo/serp'
import { bulkKeywordVolume, getDomainMetrics } from '@/lib/dataforseo/labs'
import { locationCodeForDb } from '@/lib/seo-intelligence/keyword-snapshots'
import { MIN_IMPRESSIONS_FOR_CLASSIFICATION } from './outcome-classifier'
import type { MetaCycleCandidate, MetaCycleClientConfig, MetaCycleGateEvidence, MetaCycleGateFailure, MetaCycleKeywordDataSource } from './types'

export const GATE_REASON = {
  NO_PAGE_SCOPED_KEYWORD: 'no_page_scoped_keyword_match',
  KEYWORD_DATA_UNAVAILABLE: 'keyword_data_unavailable',
  KEYWORD_REUSED: 'keyword_reused_by_another_page_90d',
  SERP_SELF_CANNIBALIZATION: 'serp_shows_different_own_page_ranking',
  DIFFICULTY_TOO_HIGH: 'difficulty_above_floor',
  SLUG_NOT_EDITABLE: 'slug_not_in_any_data_file',
  /** PM 2026-09-23 incident follow-up: this client has flagged the slug as a protected conversion page (clients.seo_config.meta_cycle_protected_slugs) — checked before any other gate step, before any spend. */
  PROTECTED_PAGE: 'protected_conversion_page',
} as const

/** Difficulty floor — only enforced when a difficulty number is actually known (see checkKeywordSnapshot's live-fallback path, which can legitimately return keywordDifficulty: null). */
export const SKIP_DIFFICULTY_FLOOR = 70

const KEYWORD_SNAPSHOT_MAX_AGE_DAYS = 14
const KEYWORD_REUSE_WINDOW_DAYS = 90

/**
 * 2026-09-28 事故（第二次撞上同一类碰撞）: the previous version of this
 * function picked a single "core" token — whichever slug token was
 * LONGEST — on the theory that the longest word is the most distinctive
 * one. For a compound China-city slug that reasoning inverts: the city
 * name itself ("chongqing", 9 chars) is almost always the LONGEST token in
 * every one of that city's pages' slugs, and it's also the LEAST
 * distinctive one — shared by every Chongqing page on the site. Requiring
 * only that single shared token to appear in a GSC query let
 * "how many days in chongqing" (a real query, genuinely showing a handful
 * of impressions against the Liziba page's URL — GSC legitimately
 * attributes a broad query to more than one of a site's pages) qualify as
 * `liziba-monorail-chongqing-guide`'s "own" on-topic query, even though
 * "liziba"/"monorail" — the tokens that actually distinguish this page from
 * every other Chongqing page — are absent from it.
 *
 * Fix: return ALL slug tokens long enough to matter, and require a query to
 * match at least two of them (or the one it has, for a single-token slug)
 * before it counts as on-topic. A shared geography word alone is no longer
 * enough; the query must also touch something that is actually specific to
 * this page.
 */
export function coreTopicTokens(slug: string): string[] {
  return slug.split('-').filter((t) => t.length > 3)
}

const MIN_ON_TOPIC_TOKEN_MATCHES = 2

/**
 * Second, independent layer against the same 2026-09-28 incident's OTHER
 * failure shape (chongqing-night-city-lights → "The Forbidden City &
 * China's Best Cities"): even with a correctly on-topic `keyword`, the AI
 * generation step can still drift onto an unrelated place/topic — neither
 * the hard fact-check nor the AI judge catch this, because both only look
 * for CONTRADICTIONS between old and new text, never "is the new text about
 * the same place at all". This is a cheap, non-AI floor: the generated
 * title+description must mention at least one of the page's own distinctive
 * slug words. It cannot verify the copy is GOOD, only that it did not
 * wander onto a different page's subject entirely.
 */
export function checkTitleOnTopic(slug: string, newTitle: string, newDesc: string): { onTopic: true } | { onTopic: false; reason: string } {
  const tokens = coreTopicTokens(slug)
  if (tokens.length === 0) return { onTopic: true }
  const text = `${newTitle} ${newDesc}`.toLowerCase()
  if (tokens.some((t) => text.includes(t))) return { onTopic: true }
  return { onTopic: false, reason: `generated title/description mentions none of this page's own topic words (${tokens.join(', ')}) — looks like it drifted onto a different page's subject` }
}

function onTopicTokenMatchCount(tokens: string[], query: string): number {
  const lower = query.toLowerCase()
  return tokens.filter((t) => lower.includes(t)).length
}

/**
 * PM 2026-09-20 (data-completeness follow-up): CTS's audience is NZ English
 * readers (see reference-cts-target-customer-mainstream-nz memory) — a GSC
 * query in another language must never become the target keyword, even if
 * it's this page's highest-impression on-topic query. e.g. leshan-... page's
 * top query was the French "leshan au départ de chengdu". ASCII-only is a
 * blunt but sufficient filter: it catches accented Latin (French/Spanish/
 * German/Vietnamese) and any non-Latin script, at the cost of rejecting the
 * rare genuinely-English query that happens to contain a loanword written
 * with a diacritic — an acceptable false-skip, never a false-accept.
 */
function isEnglishQuery(query: string): boolean {
  return !/[^\x00-\x7F]/.test(query)
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
  const tokens = coreTopicTokens(candidate.slug)
  if (tokens.length === 0) return fail(`slug "${candidate.slug}" has no token long enough to use as a topic check`)
  const requiredMatches = Math.min(MIN_ON_TOPIC_TOKEN_MATCHES, tokens.length)

  const rows = await fetchGscQueriesForPage(siteUrl, candidate.pageUrl, clientId).catch(() => null)
  if (!rows || rows.length === 0) {
    return fail(`GSC returned no page-scoped queries for ${candidate.pageUrl} — cannot verify topic match`)
  }

  const onTopicRows = rows.filter(
    (r): r is typeof r & { query: string } =>
      typeof r.query === 'string' && onTopicTokenMatchCount(tokens, r.query) >= requiredMatches,
  )
  const onTopic = onTopicRows
    .filter((r) => isEnglishQuery(r.query))
    .sort((a, b) => onTopicTokenMatchCount(tokens, b.query) - onTopicTokenMatchCount(tokens, a.query) || b.impressions - a.impressions)[0]

  if (!onTopic || typeof onTopic.query !== 'string') {
    if (onTopicRows.length > 0) {
      return fail(`this page's on-topic GSC queries are all non-English (highest-impression example: "${onTopicRows[0].query}") — NZ audience requires an English target keyword, refusing to use it`)
    }
    return fail(`none of this page's own GSC queries match at least ${requiredMatches} of its distinctive slug words (${tokens.join(', ')}) — refusing to borrow a query that only shares a generic/shared word (e.g. a city name) with another page`)
  }

  return { keyword: onTopic.query, impressions: onTopic.impressions }
}

const GSC_SERP_MIN_IMPRESSIONS = MIN_IMPRESSIONS_FOR_CLASSIFICATION

/** Numeric DataForSEO location_code → the label PM's human-readable notes use. Generic (any AU/NZ client), not CTS-specific. */
function locationLabel(code: number): string {
  if (code === 2036) return 'AU'
  if (code === 2554) return 'NZ'
  return `location ${code}`
}

type TierData = { searchVolume: number; keywordDifficulty: number; snapshotDate: string }

/** Reads a fresh (≤14 day) keyword_snapshots row for this EXACT client+keyword+location — location-scoped so a fallback-location attempt can never accidentally reuse the primary market's row. */
async function lookupSnapshotRow(
  supabase: SupabaseClient,
  clientId: string,
  keyword: string,
  locationCode: number,
): Promise<TierData | null> {
  const { data } = await supabase
    .from('keyword_snapshots')
    .select('search_volume, keyword_difficulty, snapshot_date')
    .eq('client_id', clientId)
    .eq('location_code', locationCode)
    .ilike('keyword', keyword)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as { search_volume: number | null; keyword_difficulty: number | null; snapshot_date: string } | null
  if (!row) return null
  const ageDays = (Date.now() - new Date(row.snapshot_date).getTime()) / 86_400_000
  if (ageDays > KEYWORD_SNAPSHOT_MAX_AGE_DAYS || row.search_volume === null || row.keyword_difficulty === null) return null
  return { searchVolume: row.search_volume, keywordDifficulty: row.keyword_difficulty, snapshotDate: row.snapshot_date }
}

/** One live bulkKeywordVolume call at one location — both fields required, a thrown error is caught and reported, never swallowed into a false pass. */
async function lookupLiveVolume(keyword: string, locationCode: number): Promise<TierData | { error: string }> {
  try {
    const live = await bulkKeywordVolume([keyword], locationCode)
    const r = live[0]
    if (r && r.search_volume !== null && r.keyword_difficulty !== null) {
      return { searchVolume: r.search_volume, keywordDifficulty: r.keyword_difficulty, snapshotDate: new Date().toISOString().slice(0, 10) }
    }
    return { error: 'missing search_volume and/or keyword_difficulty' }
  } catch (err) {
    return { error: `lookup threw: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Tier 3: neither DataForSEO location had data. searchVolume becomes this
 * page's own GSC impressions for the keyword (already fetched by
 * deriveTopicMatchedKeyword — passed in, not re-queried), gated at the same
 * ≥30 floor outcome-classifier.ts uses. keywordDifficulty becomes the
 * average DataForSEO domain-authority score of the SERP's top-3 competitor
 * domains (reusing the SAME live SERP call checkSerpOwnership already made
 * — not a second SERP call). A domain whose authority lookup fails is
 * simply excluded from the average (never scored as 0); if EVERY domain
 * fails, tier 3 fails too — "拿不到域名强度 → 跳过，不许当 0".
 */
async function lookupGscSerpEstimate(
  gscImpressions: number,
  serpTop3Domains: string[],
  primaryLocationCode: number,
): Promise<TierData | { error: string }> {
  if (gscImpressions < GSC_SERP_MIN_IMPRESSIONS) {
    return { error: `this page's own GSC impressions for the keyword (${gscImpressions}) are below the ${GSC_SERP_MIN_IMPRESSIONS} floor` }
  }
  const uniqueDomains = [...new Set(serpTop3Domains)]
  if (uniqueDomains.length === 0) {
    return { error: 'no SERP competitor domains available to estimate difficulty from' }
  }

  const results = await Promise.allSettled(uniqueDomains.map((d) => getDomainMetrics(d, primaryLocationCode)))
  const scores = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.authority_score] : []))
  if (scores.length === 0) {
    return { error: `domain-authority lookup failed for all ${uniqueDomains.length} SERP competitor domain(s)` }
  }

  return {
    searchVolume: gscImpressions,
    keywordDifficulty: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    snapshotDate: new Date().toISOString().slice(0, 10),
  }
}

function buildKeywordDataNote(source: MetaCycleKeywordDataSource, location: number | null, primaryLocationCode: number, searchVolume: number, keywordDifficulty: number): string {
  if (source === 'dataforseo_primary') return `搜索量/难度来自 ${locationLabel(location ?? primaryLocationCode)} 市场的 DataForSEO 数据`
  if (source === 'dataforseo_fallback') return `搜索量/难度来自 ${locationLabel(location ?? primaryLocationCode)} 数据（${locationLabel(primaryLocationCode)} 没有数据）`
  return `需求来自谷歌后台真实曝光 ${searchVolume} 次；难度按谷歌前三名网站强度估算为 ${keywordDifficulty}（非 DataForSEO 难度分）`
}

/**
 * Step 2: search volume + difficulty via a 3-tier waterfall (PM 2026-09-20,
 * fourth pass — see this file's header comment for the full rationale).
 * Tries the client's primary market, then any configured fallback
 * location_codes, then a GSC-impressions + SERP-domain-authority estimate.
 * Every tier requires BOTH fields non-null to count as a pass; every
 * attempted tier's failure reason is recorded so a total miss explains
 * exactly what was tried.
 */
export async function resolveKeywordData(
  supabase: SupabaseClient,
  clientId: string,
  keyword: string,
  primaryLocationCode: number,
  fallbackLocationCodes: number[],
  gscImpressions: number,
  serpTop3Domains: string[],
): Promise<(TierData & { keywordDataSource: MetaCycleKeywordDataSource; keywordDataLocation: number | null; keywordDataNote: string }) | { failure: string }> {
  const attempts: string[] = []
  const succeed = (data: TierData, source: MetaCycleKeywordDataSource, location: number | null) => ({
    ...data,
    keywordDataSource: source,
    keywordDataLocation: location,
    keywordDataNote: buildKeywordDataNote(source, location, primaryLocationCode, data.searchVolume, data.keywordDifficulty),
  })

  // Tier 1: primary market
  const snapshotRow = await lookupSnapshotRow(supabase, clientId, keyword, primaryLocationCode)
  if (snapshotRow) return succeed(snapshotRow, 'dataforseo_primary', primaryLocationCode)
  const primaryLive = await lookupLiveVolume(keyword, primaryLocationCode)
  if (!('error' in primaryLive)) return succeed(primaryLive, 'dataforseo_primary', primaryLocationCode)
  attempts.push(`dataforseo_primary(${locationLabel(primaryLocationCode)}): no fresh snapshot row, and ${primaryLive.error}`)

  // Tier 2: client-configured fallback markets (live only — the weekly snapshot job never writes a non-primary-location row for this client)
  for (const locationCode of fallbackLocationCodes) {
    const fallbackLive = await lookupLiveVolume(keyword, locationCode)
    if (!('error' in fallbackLive)) return succeed(fallbackLive, 'dataforseo_fallback', locationCode)
    attempts.push(`dataforseo_fallback(${locationLabel(locationCode)}): ${fallbackLive.error}`)
  }

  // Tier 3: GSC impressions + SERP domain-authority estimate
  const gscSerp = await lookupGscSerpEstimate(gscImpressions, serpTop3Domains, primaryLocationCode)
  if (!('error' in gscSerp)) return succeed(gscSerp, 'gsc_serp', null)
  attempts.push(`gsc_serp: ${gscSerp.error}`)

  return { failure: `no keyword data available for "${keyword}" from any tier — ${attempts.join('; ')}` }
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
 *
 * Also returns top3Domains (hostnames, deduped-capable) alongside
 * top3Titles — PM 2026-09-20 (fourth pass): resolveKeywordData's gsc_serp
 * tier reuses THIS SAME SERP call for its domain-authority difficulty
 * estimate, rather than making a second live SERP request per candidate.
 */
export async function checkSerpOwnership(
  keyword: string,
  countryCode: 'au' | 'nz',
  candidate: MetaCycleCandidate,
  domain: string,
): Promise<{ top3Titles: string[]; top3Domains: string[]; ctsRankingUrl: string | null } | { failure: string }> {
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

  const top3 = serp.organic_results.slice(0, 3)
  return {
    top3Titles: top3.map((r) => r.title).filter((t): t is string => Boolean(t)),
    top3Domains: top3.flatMap((r) => {
      try {
        return [new URL(r.url).hostname.replace(/^www\./, '').toLowerCase()]
      } catch {
        return []
      }
    }),
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
 * encountered. Order: topic → SERP (self-cannibalization) → keyword data
 * (3-tier waterfall, reusing the SERP call's top-3 domains for its gsc_serp
 * tier) → difficulty ceiling → reuse.
 *
 * PM 2026-09-20, fourth pass: SERP moved BEFORE data resolution (it used to
 * run last) because resolveKeywordData's gsc_serp tier needs that same
 * SERP call's top-3 competitor domains — running SERP twice per candidate
 * to preserve the old ordering would double live SERP spend for no reason.
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

  const countryCode = config.semrushDb === 'nz' ? 'nz' : 'au'
  let serpResult: Awaited<ReturnType<typeof checkSerpOwnership>>
  try {
    serpResult = await checkSerpOwnership(keyword, countryCode, candidate, config.domain)
  } catch (err) {
    return { candidate, reason: GATE_REASON.SERP_SELF_CANNIBALIZATION, detail: err instanceof Error ? err.message : String(err) }
  }
  if ('failure' in serpResult) return { candidate, reason: GATE_REASON.SERP_SELF_CANNIBALIZATION, detail: serpResult.failure }

  const primaryLocationCode = locationCodeForDb(config.semrushDb)
  const dataResult = await resolveKeywordData(
    supabase, config.clientId, keyword, primaryLocationCode, config.keywordFallbackLocations,
    topicResult.impressions, serpResult.top3Domains,
  )
  if ('failure' in dataResult) return { candidate, reason: GATE_REASON.KEYWORD_DATA_UNAVAILABLE, detail: dataResult.failure }

  if (dataResult.keywordDifficulty > SKIP_DIFFICULTY_FLOOR) {
    return { candidate, reason: GATE_REASON.DIFFICULTY_TOO_HIGH, detail: `difficulty ${dataResult.keywordDifficulty} > ${SKIP_DIFFICULTY_FLOOR} for "${keyword}" (source: ${dataResult.keywordDataSource})` }
  }

  const reuseResult = await checkNoRecentReuse(supabase, config.clientId, keyword, candidate.slug ?? '')
  if ('failure' in reuseResult) return { candidate, reason: GATE_REASON.KEYWORD_REUSED, detail: reuseResult.failure }

  const evidence: MetaCycleGateEvidence = {
    keyword,
    searchVolume: dataResult.searchVolume,
    keywordDifficulty: dataResult.keywordDifficulty,
    snapshotDate: dataResult.snapshotDate,
    keywordDataSource: dataResult.keywordDataSource,
    keywordDataLocation: dataResult.keywordDataLocation,
    keywordDataNote: dataResult.keywordDataNote,
    competitorTitles: serpResult.top3Titles,
    ctsRankingUrl: serpResult.ctsRankingUrl,
    chosenReason: `page's own GSC queries include "${keyword}" (${topicResult.impressions} impressions), which contains this page's core topic word`,
  }

  return { evidence, candidate: { ...candidate, keyword } }
}

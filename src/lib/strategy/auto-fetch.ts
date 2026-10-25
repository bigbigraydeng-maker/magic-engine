/**
 * P31.X.2 — Goal primary metric auto-fetch
 *
 * Resolves a current_value for Goals whose primary_metric_key has
 * measurement='auto' (or 'hybrid'), by reading from already-cached ME data
 * sources or — for brand_search_volume — calling DataForSEO live as a fallback.
 *
 * Supported metric keys (MVP):
 *   - organic_traffic    → ga4_traffic_snapshots.total_sessions (latest)
 *   - brand_search_volume→ GSC rolling-28-day clicks for brand-tagged queries
 *                          (PRIMARY, A2.2). DataForSEO bulkKeywordVolume is
 *                          the FALLBACK when GSC is not connected or empty.
 *   - form_submissions   → SUM(ga4_traffic_snapshots.top_sources[].conversions)
 *                          Conversions = key events. Requires client to mark
 *                          form_submit or generate_lead as key event in GA4.
 *                          See docs/sops/ga4-lead-gen-key-event-setup.md
 *   - leads_count        → dated goal: Meta lead actions inside the goal
 *                          window, end clamped to today (auto.meta_leads).
 *                          Undated: GA4 conversions, then the ads ladder only
 *                          when that read fails. FDE still tops up phone/wechat.
 *   - ai_visibility_score→ industry_ai_visibility_snapshots: client's top-3 AI
 *                          mention share × 100 (A2.1-γ). Has a same-day freshness
 *                          gate — returns ok:false if the snapshot isn't today's.
 *
 *   - seo_gsc_clicks_28d → SUM(gsc_page_daily.clicks) over the 28 days ending at
 *                          the client's latest loaded day (all pages, not the
 *                          top-50 snapshot). Fails closed on stale / partial data.
 *
 * Not yet supported (data source missing or complex):
 *   - conversion_rate    → derived GA4 (events/sessions)
 *   - social_followers_growth → no data source
 *   - cart_abandonment_rate → no data source
 *
 * Returns ok:false when unsupported or no data found.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { bulkKeywordVolume } from '@/lib/dataforseo/labs'
import { locationCodeForDb } from '@/lib/seo-intelligence/keyword-snapshots'
import {
  MIN_FULL_COVERAGE_RATIO,
  groupQuestionCoverage,
  partitionConclusiveSnapshots,
  summariseFailureCodes,
} from '@/lib/industry-ai-visibility/snapshot-conclusive'
import { resolveIndustryCode, matchAliases } from './industry-mapping'
import { countOutcome, type OutcomeStep } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import type { SeatDeparture } from '@/lib/crm/sales-progress/deposited-seats'
import { fetchDepositedSeatProgress } from '@/lib/strategy/deposited-seat-fetch'

export type AutoFetchResult =
  | { ok: true;  value: number; source: string; snapshot_date: string; label: string }
  | { ok: false; reason: string }
  /**
   * 归属数据不足，不是 0 —— callers must never display 0 for this variant.
   * `noData`: the source answered fine and simply has no records yet (e.g. no
   * bookings logged). Not a system fault — schedulers must not count it as a
   * failed run. Every other unknown (query error, ambiguous goal) stays a fault.
   */
  | { ok: false; reason: string; unknown: true; noData?: true }

export interface AutoFetchOptions {
  /**
   * The period of the goal this value is for. Period-scoped metrics
   * (leads_count via ads, messaging_started, signups_count) count inside it.
   *
   * 🔴 Pass it whenever you have the goal row: a client may run several active
   *    goals at once (seen 2026-09-24: signups_count + leads_count), and without
   *    it we can only fall back to "the client's single active goal" — which
   *    fails for every goal of that client.
   */
  goalPeriod?: GoalPeriod
  /**
   * When set on a signups_count goal, count deposited seats on these
   * departures instead of purchase rows. Absent = the original deal count.
   */
  depositedSeatScope?: readonly SeatDeparture[]
  /** goals.created_at. The later of its NZ day and period_start is the cutoff. */
  goalCreatedAt?: string | null
  /** goals.baseline_value. New seats are published only when this is 0. */
  baselineValue?: unknown
  /**
   * Clock for clamping a dated leads_count window to today.
   * Defaults to the current time. Tests pass a fixed instant.
   */
  now?: Date
}

/**
 * Attempt to auto-fetch a current value for the given metric key.
 *
 * @param supabase  Admin client
 * @param clientId  Client UUID
 * @param metricKey e.g. 'organic_traffic'
 * @param options   goalPeriod — see AutoFetchOptions
 */
export async function autoFetchMetricValue(
  supabase: SupabaseClient,
  clientId: string,
  metricKey: string,
  options: AutoFetchOptions = {},
): Promise<AutoFetchResult> {
  const { goalPeriod, now } = options
  switch (metricKey) {
    case 'organic_traffic':
      return fetchOrganicTraffic(supabase, clientId)
    case 'brand_search_volume':
      return fetchBrandSearchVolume(supabase, clientId)
    case 'form_submissions':
      return fetchFormSubmissions(supabase, clientId)
    case 'leads_count': {
      // Hybrid: this returns only the auto half. CurrentValueCell tells FDE
      // to top up phone/wechat. A dated goal must not use the latest GA4
      // snapshot — that sum ignores the start date. Count Meta leads in the
      // window first (fetchAdsOutcome). No dates → old order, unchanged.
      const dated = explicitGoalPeriod(goalPeriod)
      if (dated) return fetchDatedLeadCount(supabase, clientId, dated, now ?? new Date())
      const ga = await fetchFormSubmissions(supabase, clientId)
      return ga.ok ? ga : fetchAdsOutcome(supabase, clientId, 'lead', goalPeriod)
    }
    // 🔴 「报名/预订数」是真成交，不是广告留资。WP0 一度把它接到 fetchAdsOutcome('lead')
    //    上——那会让「33 个报名」的目标拿留资数去填，数字看着漂亮但名不符实。
    case 'signups_count':
      // A goal that lists departures wants seats, not deal rows.
      // Goals without that list keep the purchase-row count.
      if (options.depositedSeatScope) {
        return fetchDepositedSeatProgress(supabase, clientId, {
          depositedSeatScope: options.depositedSeatScope,
          goalPeriod,
          goalCreatedAt: options.goalCreatedAt,
          baselineValue: options.baselineValue,
        })
      }
      return fetchBookings(supabase, clientId, goalPeriod)
    case 'messaging_started':
      return fetchAdsOutcome(supabase, clientId, 'messaging_started', goalPeriod)
    case 'ai_visibility_score':
      return fetchAiVisibilityScore(supabase, clientId)
    case 'seo_gsc_clicks_28d':
      return fetchSeoGscClicks28d(supabase, clientId)
    default:
      return { ok: false, reason: `metric '${metricKey}' does not have an auto-fetch source yet` }
  }
}

// ── organic_traffic ────────────────────────────────────────────────────────
//
// A1 fix (2026-06-08): organic_traffic = ONLY medium='organic' sessions.
// Previously summed total_sessions (direct + organic + paid + referral all
// mixed). That made a paid_social spike look like organic growth and pollutes
// SEO-only Goal verdicts. Now we sum top_sources[] where medium='organic',
// matching the Goal label semantics ("自然流增长" = SEO-driven traffic only).

async function fetchOrganicTraffic(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  const { data, error } = await supabase
    .from('ga4_traffic_snapshots')
    .select('top_sources, total_sessions, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle<{
      top_sources: Ga4SourceRow[] | null
      total_sessions: number | null
      period_start: string
      period_end: string
    }>()

  if (error) {
    return { ok: false, reason: `GA4 query failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'No GA4 snapshot found — run GA4 Sync first' }
  }

  const sources = Array.isArray(data.top_sources) ? data.top_sources : []
  if (sources.length === 0) {
    return { ok: false, reason: 'GA4 snapshot missing top_sources breakdown — cannot isolate organic traffic' }
  }

  const organicSessions = sources.reduce(
    (sum, src) => sum + (src.medium === 'organic' && typeof src.sessions === 'number' ? src.sessions : 0),
    0,
  )

  return {
    ok: true,
    value: organicSessions,
    source: 'auto.ga4_organic_sessions',
    snapshot_date: data.period_end,
    label: `${organicSessions.toLocaleString()} organic sessions (${formatDate(data.period_start)} → ${formatDate(data.period_end)})`,
  }
}

// ── seo_gsc_clicks_28d ─────────────────────────────────────────────────────
//
// North-star SEO metric (playbook-seo-general §十): real Google clicks for the
// whole site, summed from gsc_page_daily (every page, every day) — NOT the
// top-50 gsc_performance_snapshots, which truncates the long tail.
//
// Window = the 28 days ending at the client's LATEST loaded day. GSC data lags
// by days (observed 3–5), so anchoring on "today" would count empty trailing
// days as zero. Fails closed (never returns a partial sum as a number):
//   · no rows            → noData
//   · latest day too old → unknown (the daily pull is broken, not "zero clicks")
//   · < MIN days present → unknown (partial window)
//   · row cap hit        → unknown (refuse to sum a truncated read)

const GSC_WINDOW_DAYS = 28
const GSC_MIN_DAYS_PRESENT = 26
const GSC_MAX_STALENESS_DAYS = 10
const GSC_PAGE_SIZE = 1000
const GSC_MAX_PAGES = 40

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function fetchSeoGscClicks28d(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<AutoFetchResult> {
  const { data: latest, error: latestErr } = await supabase
    .from('gsc_page_daily')
    .select('day')
    .eq('client_id', clientId)
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle<{ day: string }>()

  if (latestErr) {
    return { ok: false, reason: `gsc_page_daily query failed: ${latestErr.message}`, unknown: true }
  }
  if (!latest) {
    return { ok: false, reason: 'No gsc_page_daily rows yet — GSC daily pull has not loaded this client', unknown: true, noData: true }
  }

  const endDay = latest.day
  const staleDays = Math.floor((now.getTime() - Date.parse(`${endDay}T00:00:00Z`)) / 86_400_000)
  if (staleDays > GSC_MAX_STALENESS_DAYS) {
    return { ok: false, reason: `gsc_page_daily latest day ${endDay} is ${staleDays} days old — daily pull looks broken`, unknown: true }
  }
  const startDay = addDaysIso(endDay, -(GSC_WINDOW_DAYS - 1))

  let total = 0
  const daysPresent = new Set<string>()
  for (let page = 0; page < GSC_MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from('gsc_page_daily')
      .select('day, clicks')
      .eq('client_id', clientId)
      .gte('day', startDay)
      .lte('day', endDay)
      .order('day', { ascending: true })
      .order('page_key', { ascending: true })
      .range(page * GSC_PAGE_SIZE, (page + 1) * GSC_PAGE_SIZE - 1)
    if (error) {
      return { ok: false, reason: `gsc_page_daily read failed: ${error.message}`, unknown: true }
    }
    const rows = (data ?? []) as Array<{ day: string; clicks: number | null }>
    for (const row of rows) {
      total += typeof row.clicks === 'number' ? row.clicks : 0
      daysPresent.add(row.day)
    }
    if (rows.length < GSC_PAGE_SIZE) {
      if (daysPresent.size < GSC_MIN_DAYS_PRESENT) {
        return {
          ok: false,
          reason: `gsc_page_daily has only ${daysPresent.size}/${GSC_WINDOW_DAYS} days in ${startDay} → ${endDay} — refusing a partial sum`,
          unknown: true,
        }
      }
      return {
        ok: true,
        value: total,
        source: 'auto.gsc_clicks_28d',
        snapshot_date: endDay,
        label: `${total.toLocaleString()} Google clicks (${formatDate(startDay)} → ${formatDate(endDay)}, ${daysPresent.size} days)`,
      }
    }
  }
  return { ok: false, reason: `gsc_page_daily read hit the ${GSC_MAX_PAGES * GSC_PAGE_SIZE}-row cap — refusing to sum a truncated read`, unknown: true }
}

// ── brand_search_volume ────────────────────────────────────────────────────
//
// A2.2 — Two-tier resolution:
//
//   1. PRIMARY: GSC rolling-28-day clicks for brand-tagged queries.
//      Reads gsc_performance_snapshots (latest row, written by daily cron),
//      filters top_queries[] with isBrandQueryMatch(), sums the clicks.
//      "Brand search volume" is rendered as ACTUAL CLICKS on brand-related
//      searches — real behaviour, not impressions / not third-party estimate.
//
//   2. FALLBACK: DataForSEO bulkKeywordVolume live (the pre-A2.2 behaviour).
//      Used when GSC connector is not yet hooked up or the snapshot table
//      has no row for this client yet. Returns monthly search-volume
//      ESTIMATE for the brand name — coarser but always available.
//
// Brand recognition (A2.2 P0 fix, after CTS live-data audit):
//   The naive identifier is the domain root ("ctstours" from "ctstours.co.nz")
//   matched as a substring (NOT token equality — see below). For multi-word
//   brands ("CTS Tours" → real GSC queries "cts tours", "china travel
//   service nz", "cts travel") the domain root alone misses ~80% of brand
//   searches. clients.brand_aliases TEXT[] lets FDE supply additional
//   substrings to widen recognition.
//
//   Why substring (not token equality):
//     - Token equality: "cts tours" → tokens ["cts","tours"], neither equals
//       "ctstours" → MISS (CTS would surface ~0 brand clicks).
//     - Substring:      "cts tours" contains alias "cts tours" → HIT.
//     - Domain-root substring is also safer for compound brands where the
//       GSC query happens to spell brand together: "ctstours" inside
//       "ctstoursnz" → HIT (token equality would also miss this).

interface GscQuerySnapshotRow {
  query?: string
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

function extractBrandRootFromDomain(domain: string | null): string | null {
  if (!domain) return null
  const cleaned = domain.replace(/^www\./, '').split('.')[0]?.toLowerCase()
  return cleaned && cleaned.length > 0 ? cleaned : null
}

/**
 * Normalise a string for brand matching: lowercase + collapse whitespace.
 * Keeps inner spaces (we want "cts tours" to stay 2 words for whole-term
 * matching against query "cts tours auckland").
 */
function normaliseBrandTerm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Whole-term match: `needle` must appear in `haystack` at word boundaries.
 * Both args are pre-normalised (lowercased, whitespace-collapsed).
 *
 * Word boundaries (rather than bare substring) keep short single-token brand
 * terms honest: "cts" matches "cts" / "cts tours" but NOT the "cts" buried
 * inside ordinary words like "products" / "facts". Used for the human-curated
 * brand_aliases. Mirrors the matcher used by isBrandedKeywordWithAliases in
 * seo-intelligence/intent-strategy (kept as a local copy to avoid importing
 * server-side strategy code into client bundles).
 */
function matchesWholeTerm(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(haystack)
}

/**
 * Test whether a GSC query counts as a brand search.
 *
 * Two matcher paths (any hit = brand):
 *   1. brand_aliases — human-curated terms, matched at WORD BOUNDARIES.
 *      Multi-word brands ("cts tours") match inside "cts tours auckland", and
 *      a short alias ("cts") matches its own token but NOT the "cts" buried
 *      in "products" / "facts" (regression guard from PR #454 review).
 *   2. brandRoot (concatenated domain root, e.g. "ctstours") — matched as a
 *      plain SUBSTRING. This is deliberate: a compound domain root must still
 *      catch concatenated brand queries where the brand is spelled together
 *      ("ctstours" inside "ctstoursnz"), which a word-boundary match would
 *      miss. The root is always a long concatenated token, so substring
 *      false-positives are not a practical concern (unlike short aliases).
 *
 * Both checks are case-insensitive with whitespace collapsed.
 *
 * @param query        GSC top_queries[i].query
 * @param brandRoot    domain root or null
 * @param brandAliases optional alias array from clients.brand_aliases
 */
export function isBrandQueryMatch(
  query: string,
  brandRoot: string | null,
  brandAliases: string[] | null,
): boolean {
  const q = normaliseBrandTerm(query)
  if (!q) return false

  if (Array.isArray(brandAliases)) {
    for (const alias of brandAliases) {
      if (typeof alias !== 'string') continue
      const a = normaliseBrandTerm(alias)
      if (a.length >= 2 && matchesWholeTerm(q, a)) return true
    }
  }

  if (brandRoot) {
    const r = normaliseBrandTerm(brandRoot)
    if (r.length >= 2 && q.includes(r)) return true
  }

  return false
}

async function fetchBrandSearchVolume(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  // Schema reality (2026-06-03 audit + 2026-06-04 P0 fix): clients table has
  // `name`, `semrush_db` (au/nz), `domain`, and (new) `brand_aliases` text[].
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('name, semrush_db, domain, brand_aliases')
    .eq('id', clientId)
    .maybeSingle<{
      name: string | null
      semrush_db: string | null
      domain: string | null
      brand_aliases: string[] | null
    }>()

  if (clientErr) {
    return { ok: false, reason: `Client query failed: ${clientErr.message}` }
  }
  if (!client) {
    return { ok: false, reason: 'Client not found' }
  }

  // ── Tier 1: GSC rolling-28-day brand-tagged clicks ─────────────────────
  const brandRoot     = extractBrandRootFromDomain(client.domain)
  const brandAliases  = Array.isArray(client.brand_aliases) && client.brand_aliases.length > 0
    ? client.brand_aliases
    : null
  const canMatchBrand = brandRoot !== null || brandAliases !== null
  if (canMatchBrand) {
    const gscResult = await fetchBrandClicksFromGsc(supabase, clientId, brandRoot, brandAliases)
    if (gscResult.ok) return gscResult
    // gscResult.ok === false → fall through to DataForSEO with the reason
    // preserved for diagnostics (logged below if fallback also fails).
  }

  // ── Tier 2: DataForSEO live keyword-volume estimate ────────────────────
  const brandKeyword = client.name
  if (!brandKeyword) {
    return {
      ok: false,
      reason: brandRoot
        ? 'No GSC data for this client yet, and client.name is missing — cannot fall back to DataForSEO'
        : 'Client has no domain or name — cannot look up brand search volume',
    }
  }

  const locationCode = locationCodeForDb(client.semrush_db)
  let labsResults
  try {
    labsResults = await bulkKeywordVolume([brandKeyword], locationCode)
  } catch (err) {
    return {
      ok: false,
      reason: `DataForSEO bulkKeywordVolume failed: ${(err as Error).message}`,
    }
  }

  const hit = labsResults.find(r => r.keyword.toLowerCase() === brandKeyword.toLowerCase())
    ?? labsResults[0]
  if (!hit || hit.search_volume == null) {
    return {
      ok: false,
      reason: `DataForSEO returned no search_volume for "${brandKeyword}" (location ${locationCode})`,
    }
  }

  return {
    ok: true,
    value: hit.search_volume,
    source: 'auto.dataforseo_keyword_volume',
    snapshot_date: new Date().toISOString(),
    label: `~${hit.search_volume.toLocaleString()} searches/mo for "${hit.keyword}"`,
  }
}

async function fetchBrandClicksFromGsc(
  supabase: SupabaseClient,
  clientId: string,
  brandRoot: string | null,
  brandAliases: string[] | null,
): Promise<AutoFetchResult> {
  const { data, error } = await supabase
    .from('gsc_performance_snapshots')
    .select('top_queries, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle<{ top_queries: GscQuerySnapshotRow[] | null; period_start: string; period_end: string }>()

  if (error) {
    return { ok: false, reason: `GSC snapshot query failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'No GSC snapshot found — client may not have connected Google Search Console yet' }
  }

  const queries = Array.isArray(data.top_queries) ? data.top_queries : []
  if (queries.length === 0) {
    return { ok: false, reason: 'GSC snapshot has no top_queries — possibly an empty site or sync issue' }
  }

  let brandedClicks = 0
  let brandedQueryCount = 0
  for (const row of queries) {
    if (!row.query) continue
    if (typeof row.clicks !== 'number') continue
    if (isBrandQueryMatch(row.query, brandRoot, brandAliases)) {
      brandedClicks += row.clicks
      brandedQueryCount += 1
    }
  }

  if (brandedQueryCount === 0) {
    // GSC snapshot exists but no brand-tagged queries surface in the top_queries
    // window. Likely causes:
    //   1. Tiny brand awareness (real signal — long-tail informational only)
    //   2. Multi-word brand without brand_aliases configured (e.g. CTS Tours
    //      with only domain-root "ctstours" set; queries are "cts tours",
    //      "china travel service" → all miss)
    // Fall back to DataForSEO; log the alias-config hint in the reason.
    const aliasHint = brandAliases
      ? ''
      : ' (no brand_aliases configured — add aliases on clients.brand_aliases for multi-word brands)'
    return {
      ok: false,
      reason: `No branded queries found in GSC top_queries for brand "${brandRoot ?? '(no domain)'}"${aliasHint}. Falling back to DataForSEO estimate.`,
    }
  }

  return {
    ok: true,
    value: brandedClicks,
    source: 'auto.gsc_brand_clicks',
    snapshot_date: data.period_end,
    label: `${brandedClicks.toLocaleString()} brand-search clicks (${brandedQueryCount} ${brandedQueryCount === 1 ? 'query' : 'queries'} · ${formatDate(data.period_start)} → ${formatDate(data.period_end)})`,
  }
}

// ── form_submissions / leads_count ─────────────────────────────────────────
//
// Reads the latest ga4_traffic_snapshots row and sums `conversions` across
// every top_source. In GA4 terms, conversions = key event count. Requires the
// client to have marked `form_submit` / `generate_lead` as key event in GA4
// Admin → Events (see docs/sops/ga4-lead-gen-key-event-setup.md).
//
// Hard truth: if the client hasn't configured key events in GA4, the sum will
// be 0 and we return ok:false with a hint pointing FDE at the SOP. We do NOT
// return ok:true with value:0 — that would mislead FDE into thinking they
// have 0 form submissions when really they just haven't wired up the tracking.

interface Ga4SourceRow {
  source: string
  medium: string
  sessions: number
  conversions: number
}

async function fetchFormSubmissions(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  const { data, error } = await supabase
    .from('ga4_traffic_snapshots')
    .select('top_sources, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle<{ top_sources: Ga4SourceRow[] | null; period_start: string; period_end: string }>()

  if (error) {
    return { ok: false, reason: `GA4 query failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'No GA4 snapshot found — run GA4 Sync first' }
  }

  const sources = Array.isArray(data.top_sources) ? data.top_sources : []
  const totalConversions = sources.reduce(
    (sum, src) => sum + (typeof src.conversions === 'number' ? src.conversions : 0),
    0,
  )

  if (totalConversions === 0) {
    // 0 is structurally valid but operationally meaningless — almost always
    // means key events aren't configured in GA4 yet. Point FDE at the SOP.
    return {
      ok: false,
      reason:
        'GA4 reported 0 conversions. Mark `form_submit` or `generate_lead` as a key event in GA4 ' +
        '(see docs/sops/ga4-lead-gen-key-event-setup.md). After configuration wait 24-48h for data to flow back.',
    }
  }

  return {
    ok: true,
    value: totalConversions,
    source: 'auto.ga4_conversions',
    snapshot_date: data.period_end,
    label: `${totalConversions.toLocaleString()} conversions (${formatDate(data.period_start)} → ${formatDate(data.period_end)})`,
  }
}

// ── ai_visibility_score ────────────────────────────────────────────────────
//
// Score = (questions where client brand appears in top3 / total questions
//         in client's industry) * 100, computed against the LATEST collected
// snapshot for that industry only.
//
// Guards (fail-fast order):
//   - client.name missing → ok:false 'client has no name'
//   - industry not in mapping table → ok:false 'industry "X" not mapped...'
//   - no snapshot for this industry yet → ok:false 'no AI visibility snapshots'
//   - latest snapshot < today → ok:false 'not refreshed today' (魏征 P1-2)
//   - fully-measured question count < 5 → ok:false 'insufficient fully-measured'
//   - fully-measured share < 60% → ok:false 'coverage too low'
//   - 0 hits among fully-measured questions → ok:true value:0
//     (REAL value, brand genuinely absent)
//
// 2026-09-23 红线修复 (docs/PITFALLS.md D12, 同一个病的第二处):
// Snapshot rows whose probe FAILED (OpenAI quota exhausted, DataForSEO error)
// carry empty top3_brands. Counting them in the denominator silently drags the
// client's score DOWN and makes "我们没测成" look like "AI 从来不提我们" —
// the strategy layer then prescribes off a number that was never measured.
//
// The fix is complete-case analysis at QUESTION level, not just row level:
// a question is scored only when every platform row for it completed. Scoring
// partially-measured questions biases down by up to 46% (measured on
// 2026-09-20 production data); keeping their hits but dropping their misses
// biases up to 100%. On top of that a 60% coverage floor, because probe
// failures are systematic (city-scoped questions fail, national ones do not),
// so a thin surviving sample is a skewed one.
//
// See src/lib/industry-ai-visibility/snapshot-conclusive.ts for why the
// row predicate is NOT simply `error_code IS NULL` ('no_ai_overview' means
// the probe completed and Google showed no AI Overview — a genuine zero).

interface ClientRow {
  name: string | null
  industry: string | null
  brand_aliases: string[] | null
}

interface SnapshotRow {
  question_id: string
  top3_brands: string[] | null
  error_code: string | null
}

async function fetchAiVisibilityScore(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  // 1. Client lookup
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('name, industry, brand_aliases')
    .eq('id', clientId)
    .single()

  if (clientErr) return { ok: false, reason: `Client query failed: ${clientErr.message}` }
  if (!client) return { ok: false, reason: 'Client not found' }

  const c = client as ClientRow
  if (!c.name) return { ok: false, reason: 'client has no name' }

  // 2. Resolve industry (free text → controlled enum)
  const industryCode = resolveIndustryCode(c.industry)
  if (!industryCode) {
    return {
      ok: false,
      reason: `industry "${c.industry ?? 'null'}" not mapped to AI visibility question set. ` +
              `Supported: travel / real_estate / restaurant / migration / flooring`,
    }
  }

  // 3. Latest collected_date for THIS industry (魏征 P1-3: filter before max)
  const { data: latestRow } = await supabase
    .from('industry_ai_visibility_snapshots')
    .select('collected_date, industry_ai_visibility_questions!inner(industry_code)')
    .eq('industry_ai_visibility_questions.industry_code', industryCode)
    .order('collected_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestRow) {
    return { ok: false, reason: `no AI visibility snapshots for industry "${industryCode}" yet` }
  }

  const latestDate = (latestRow as { collected_date: string }).collected_date
  const today = new Date().toISOString().slice(0, 10)

  // 4. Stale data guard (魏征 P1-2).
  // NOTE: step 3 picks latestDate from ALL rows, failed ones included. That is
  // safe ONLY because this gate refuses anything older than today: a day whose
  // entire batch failed gets latestDate=today, passes here, and is then caught
  // by the coverage gates below. If this freshness gate is ever relaxed, step 3
  // must start picking the latest date that has conclusive rows.
  if (latestDate < today) {
    return {
      ok: false,
      reason: `industry "${industryCode}" snapshot not refreshed today ` +
              `(latest: ${latestDate}, expected: ${today}). ` +
              `Wait for industry-ai-visibility-daily cron (02:30 UTC).`,
    }
  }

  // 5. Pull today's snapshots for this industry
  const { data: snaps, error: snapsErr } = await supabase
    .from('industry_ai_visibility_snapshots')
    .select('question_id, top3_brands, error_code, industry_ai_visibility_questions!inner(industry_code)')
    .eq('industry_ai_visibility_questions.industry_code', industryCode)
    .eq('collected_date', latestDate)

  if (snapsErr) return { ok: false, reason: `snapshot query failed: ${snapsErr.message}` }

  const snapshots = (snaps ?? []) as SnapshotRow[]
  const { failed } = partitionConclusiveSnapshots(snapshots)

  // 5b. Complete-case analysis: score ONLY questions whose every platform row
  // completed. A question measured on one platform but not the others is
  // evidence we do not have — see groupQuestionCoverage() for why keeping
  // either half of a partial question biases the score (down, then up).
  const coverage = groupQuestionCoverage(snapshots)
  const scorable = coverage.fullyMeasured
  const incompleteCount = coverage.partialQuestionIds.length + coverage.failedQuestionIds.length

  const failureNote = failed.length > 0
    ? ` ${incompleteCount}/${coverage.totalQuestions} questions were left incomplete by ` +
      `${failed.length} failed platform probes (${summariseFailureCodes(failed)}) — ` +
      `the score is NOT COMPUTABLE, not zero.`
    : ''

  if (scorable.size < 5) {
    return {
      ok: false,
      reason: `insufficient fully-measured AI visibility questions for industry "${industryCode}" ` +
              `(n=${scorable.size} < 5 on ${latestDate}).${failureNote}`,
    }
  }

  // 5c. Coverage gate. Probe failures are NOT random — city-scoped questions
  // fail at the SERP provider while national ones succeed — so a thin surviving
  // sample is a skewed sample, not just a small one.
  const coverageRatio = scorable.size / coverage.totalQuestions
  if (coverageRatio < MIN_FULL_COVERAGE_RATIO) {
    return {
      ok: false,
      reason: `AI visibility coverage too low for industry "${industryCode}" on ${latestDate}: ` +
              `only ${scorable.size}/${coverage.totalQuestions} questions ` +
              `(${Math.round(coverageRatio * 100)}%) were measured on every platform, below the ` +
              `${Math.round(MIN_FULL_COVERAGE_RATIO * 100)}% minimum. Probe failures skew towards ` +
              `city-scoped questions, so the surviving sample is biased, not merely small.` +
              `${failureNote}`,
    }
  }

  // 6. Count fully-measured questions where the brand appears in a top3
  let hits = 0
  for (const questionRows of scorable.values()) {
    const matched = questionRows.some(s =>
      (s.top3_brands ?? []).some(b => matchAliases(b, c.name as string, c.brand_aliases)),
    )
    if (matched) hits++
  }

  const score = Math.round((hits / scorable.size) * 100)

  // Disclose partial coverage in the same unit as the score (questions, not
  // rows), so 5/18 never reads like a full measurement.
  const coverageNote = incompleteCount > 0
    ? ` (${incompleteCount}/${coverage.totalQuestions} questions excluded — incomplete evidence)`
    : ''

  return {
    ok: true,
    value: score,
    source: 'auto.ai_visibility_top3',
    snapshot_date: latestDate,
    label: `${score}/100 — top3 in ${hits}/${scorable.size} fully-measured ${industryCode} questions${coverageNote}`,
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

// ── ads outcomes（spec 2026-09-24 ads IMPACT §3 G1）────────────────────────────
// 广告结果从 ad_daily_insights 按 outcome-ladder 口径累计；任何一行归不上（M2）→ unknown，绝不当 0。

export interface GoalPeriod {
  period_start: string
  period_end: string
}

/** Both dates present → the caller named a window. Blank dates stay undated. */
function explicitGoalPeriod(period: GoalPeriod | undefined): GoalPeriod | null {
  if (!period) return null
  const start = typeof period.period_start === 'string' ? period.period_start.trim() : ''
  const end = typeof period.period_end === 'string' ? period.period_end.trim() : ''
  if (start.length === 0 || end.length === 0) return null
  return { period_start: start, period_end: end }
}

function clampPeriodEndToToday(period: GoalPeriod, today: string): GoalPeriod {
  if (period.period_end <= today) return period
  return { period_start: period.period_start, period_end: today }
}

/** The exact columns InsightForOutcome needs — never select '*'. */
interface AdsetInsightRow {
  reach: number | null
  video_thruplays: number | null
  actions: ReadonlyArray<{ action_type: string; value: string }> | null
}

const ADSET_INSIGHT_COLUMNS = 'reach, video_thruplays, actions'
const ADSET_PAGE_SIZE = 1000

/**
 * Use the caller's goal period; only when none was passed, fall back to the
 * client's single active goal. With 2+ active goals the fallback cannot know
 * which one is meant, so it says so instead of guessing.
 */
async function resolveGoalPeriod(
  supabase: SupabaseClient,
  clientId: string,
  goalPeriod: GoalPeriod | undefined,
): Promise<{ ok: true; period: GoalPeriod } | { ok: false; reason: string; unknown: true }> {
  if (goalPeriod) return { ok: true, period: goalPeriod }

  const { data, error } = await supabase
    .from('goals')
    .select('period_start, period_end')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .limit(2)

  if (error) return { ok: false, reason: error.message, unknown: true }
  const rows = (data ?? []) as GoalPeriod[]
  if (rows.length === 0) return { ok: false, reason: 'no active goal', unknown: true }
  if (rows.length > 1) {
    return { ok: false, reason: 'client has several active goals — caller must pass goalPeriod', unknown: true }
  }
  return { ok: true, period: rows[0] }
}

/**
 * Page through ad_daily_insights with .range() until a short page arrives.
 * PostgREST silently caps a single response at 1000 rows, so a single read
 * would under-count without ever erroring.
 */
async function loadAdsetRowsPaged(
  supabase: SupabaseClient,
  clientId: string,
  period: GoalPeriod,
): Promise<{ ok: true; rows: AdsetInsightRow[] } | { ok: false; reason: string; unknown: true }> {
  const rows: AdsetInsightRow[] = []
  for (let from = 0; ; from += ADSET_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('ad_daily_insights')
      .select(ADSET_INSIGHT_COLUMNS)
      .eq('client_id', clientId)
      .eq('level', 'adset')
      .gte('insight_date', period.period_start)
      .lte('insight_date', period.period_end)
      .range(from, from + ADSET_PAGE_SIZE - 1)

    if (error) return { ok: false, reason: error.message, unknown: true }
    const page = (data ?? []) as AdsetInsightRow[]
    rows.push(...page)
    if (page.length < ADSET_PAGE_SIZE) break
  }
  return { ok: true, rows }
}

/**
 * Sum one outcome step across rows. Any row that cannot be attributed (M2)
 * makes the whole total UNKNOWN — never 0.
 */
function sumOutcome(
  step: OutcomeStep,
  rows: AdsetInsightRow[],
): { ok: true; value: number } | { ok: false; reason: string; unknown: true } {
  let sum = 0
  for (const row of rows) {
    const count = countOutcome(step, row, { messagingReferralAvailable: false, optimizationGoal: undefined })
    if (count.value === null) {
      return { ok: false, reason: '主结果归不到广告（§14 M2）', unknown: true }
    }
    sum += count.value
  }
  return { ok: true, value: sum }
}

/**
 * 真成交数（报名/预订）——读 `me_sale_outcomes` 的 purchase 行。
 *
 * 这些行由 CRM 表格同步流水线写入（`cts-crm-sheet-sync`），它的唯一输入是
 * 客户 CRM 表「阶段Stage」那一列填了 `4-已订金` / `5-已出行归来`。
 *
 * 🔴 一条 purchase 都没有时返回 `unknown`，**绝不返回 0**：
 *    「还没有人成交」和「没人填阶段那一列」在库里长得一模一样，
 *    报 0 等于替客户断言生意没做成。2026-09-24 实测：613 条 lead、0 条 purchase，
 *    而同期 CRM 表 1599 行里只有 1 行填了阶段——正是后者。
 *    日报会显示「未判」并带上原因，这本身就是在催那一格被填上。
 */
async function fetchBookings(
  supabase: SupabaseClient,
  clientId: string,
  goalPeriod: GoalPeriod | undefined,
): Promise<AutoFetchResult> {
  const goal = await resolveGoalPeriod(supabase, clientId, goalPeriod)
  if (!goal.ok) return goal

  // head:true → 不取行只取计数，计数在 `count` 里（`data` 是 null，别去读它的 length）。
  const { count, error } = await supabase
    .from('me_sale_outcomes')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('outcome_kind', 'purchase')
    .is('redacted_at', null)
    .neq('review_status', 'rejected')
    .gte('occurred_at', `${goal.period.period_start}T00:00:00Z`)
    .lte('occurred_at', `${goal.period.period_end}T23:59:59Z`)

  if (error) return { ok: false, reason: error.message, unknown: true }

  if (!count) {
    return {
      ok: false,
      unknown: true,
      noData: true,
      reason: '成交数还没有任何记录 —— 可能是真的还没成交，也可能是 CRM「阶段」那一列没人填（两者在库里长得一样，不猜）',
    }
  }
  return { ok: true, value: count, source: 'me_sale_outcomes', snapshot_date: goal.period.period_end, label: '报名/预订' }
}

async function fetchAdsOutcome(
  supabase: SupabaseClient,
  clientId: string,
  step: OutcomeStep,
  goalPeriod: GoalPeriod | undefined,
): Promise<AutoFetchResult> {
  const goal = await resolveGoalPeriod(supabase, clientId, goalPeriod)
  if (!goal.ok) return goal

  const loaded = await loadAdsetRowsPaged(supabase, clientId, goal.period)
  if (!loaded.ok) return loaded

  const summed = sumOutcome(step, loaded.rows)
  if (!summed.ok) return summed

  return {
    ok: true,
    value: summed.value,
    source: 'ad_daily_insights',
    snapshot_date: goal.period.period_end,
    label: step,
  }
}

/**
 * Dated leads_count. Reuses fetchAdsOutcome on the goal window with the end
 * clamped to today, so days before the start (and days that have not happened)
 * are not part of the sum.
 */
async function fetchDatedLeadCount(
  supabase: SupabaseClient,
  clientId: string,
  period: GoalPeriod,
  now: Date,
): Promise<AutoFetchResult> {
  const today = now.toISOString().slice(0, 10)
  if (period.period_start > today) {
    return {
      ok: true,
      value: 0,
      source: 'auto.meta_leads',
      snapshot_date: today,
      label: `0 Meta leads (starts ${formatDate(period.period_start)}; nothing before the start date counts)`,
    }
  }
  const window = clampPeriodEndToToday(period, today)
  const ads = await fetchAdsOutcome(supabase, clientId, 'lead', window)
  if (!ads.ok) return ads
  return {
    ...ads,
    source: 'auto.meta_leads',
    label: `${ads.value.toLocaleString()} Meta leads (${formatDate(window.period_start)} → ${formatDate(window.period_end)})`,
  }
}

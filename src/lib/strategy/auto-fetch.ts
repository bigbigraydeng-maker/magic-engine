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
 *   - leads_count        → same source as form_submissions (hybrid metric — auto
 *                          half from GA4 conversions, FDE tops up phone/wechat
 *                          leads manually via Submit Verdict)
 *
 * Not yet supported (data source missing or complex):
 *   - ai_visibility_score→ ai_visibility_snapshots (no 0-100 column yet)
 *   - conversion_rate    → derived GA4 (events/sessions)
 *   - social_followers_growth → no data source
 *   - cart_abandonment_rate → no data source
 *
 * Returns ok:false when unsupported or no data found.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { bulkKeywordVolume } from '@/lib/dataforseo/labs'
import { locationCodeForDb } from '@/lib/seo-intelligence/keyword-snapshots'
import { resolveIndustryCode, matchAliases } from './industry-mapping'

export type AutoFetchResult =
  | { ok: true;  value: number; source: string; snapshot_date: string; label: string }
  | { ok: false; reason: string }

/**
 * Attempt to auto-fetch a current value for the given metric key.
 *
 * @param supabase  Admin client
 * @param clientId  Client UUID
 * @param metricKey e.g. 'organic_traffic'
 */
export async function autoFetchMetricValue(
  supabase: SupabaseClient,
  clientId: string,
  metricKey: string,
): Promise<AutoFetchResult> {
  switch (metricKey) {
    case 'organic_traffic':
      return fetchOrganicTraffic(supabase, clientId)
    case 'brand_search_volume':
      return fetchBrandSearchVolume(supabase, clientId)
    case 'form_submissions':
    case 'leads_count':
      // leads_count is hybrid (catalog.measurement='hybrid'): GA4 conversions
      // are the auto half; FDE adds phone/wechat counts via Submit Verdict.
      // We surface only the auto half here — the hybrid hint in CurrentValueCell
      // tells FDE to top up the rest.
      return fetchFormSubmissions(supabase, clientId)
    case 'ai_visibility_score':
      return fetchAiVisibilityScore(supabase, clientId)
    default:
      return { ok: false, reason: `metric '${metricKey}' does not have an auto-fetch source yet` }
  }
}

// ── organic_traffic ────────────────────────────────────────────────────────

async function fetchOrganicTraffic(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutoFetchResult> {
  const { data, error } = await supabase
    .from('ga4_traffic_snapshots')
    .select('total_sessions, period_start, period_end')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: `GA4 query failed: ${error.message}` }
  }
  if (!data) {
    return { ok: false, reason: 'No GA4 snapshot found — run GA4 Sync first' }
  }
  if (typeof data.total_sessions !== 'number') {
    return { ok: false, reason: 'GA4 snapshot missing total_sessions value' }
  }

  return {
    ok: true,
    value: data.total_sessions,
    source: 'GA4 (28-day sessions)',
    snapshot_date: data.period_end as string,
    label: `${data.total_sessions.toLocaleString()} sessions (${formatDate(data.period_start as string)} → ${formatDate(data.period_end as string)})`,
  }
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
 * Keeps inner spaces (we want "cts tours" to stay 2 words for substring
 * matching against query "cts tours auckland").
 */
function normaliseBrandTerm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Test whether a GSC query counts as a brand search.
 *
 * Matcher candidates (any hit = brand):
 *   1. Any entry in brand_aliases appears as a substring of the query.
 *      Use case: multi-word brands ("CTS Tours" aliases: ["cts tours",
 *      "cts travel", "china travel service"]).
 *   2. brandRoot (from domain) appears as a substring of the query.
 *      Use case: legacy / no-alias clients where the brand is one word
 *      that happens to appear inline in queries ("oztop" inside
 *      "oztop building supplies").
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
      if (a.length >= 2 && q.includes(a)) return true
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
    source: 'DataForSEO bulk keyword volume (estimate · GSC not yet connected)',
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
    source: 'GSC clicks (28-day brand searches)',
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
    source: 'GA4 conversions (key events)',
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
//   - question count < 5 → ok:false 'insufficient questions (n<5)'
//   - 0 hits → ok:true value:0 (REAL value, brand genuinely absent)

interface ClientRow {
  name: string | null
  industry: string | null
  brand_aliases: string[] | null
}

interface SnapshotRow {
  question_id: string
  top3_brands: string[] | null
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

  // 4. Stale data guard (魏征 P1-2)
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
    .select('question_id, top3_brands, industry_ai_visibility_questions!inner(industry_code)')
    .eq('industry_ai_visibility_questions.industry_code', industryCode)
    .eq('collected_date', latestDate)

  if (snapsErr) return { ok: false, reason: `snapshot query failed: ${snapsErr.message}` }

  const snapshots = (snaps ?? []) as SnapshotRow[]
  const uniqueQuestions = new Set(snapshots.map(s => s.question_id))

  if (uniqueQuestions.size < 5) {
    return {
      ok: false,
      reason: `insufficient questions for industry "${industryCode}" (n=${uniqueQuestions.size} < 5)`,
    }
  }

  // 6. Count questions where brand appears in top3
  const hitQuestions = new Set<string>()
  for (const s of snapshots) {
    const top3 = s.top3_brands ?? []
    const matched = top3.some(b => matchAliases(b, c.name as string, c.brand_aliases))
    if (matched) hitQuestions.add(s.question_id)
  }

  const score = Math.round((hitQuestions.size / uniqueQuestions.size) * 100)

  return {
    ok: true,
    value: score,
    source: 'industry_ai_visibility_snapshots (top3 occurrence)',
    snapshot_date: latestDate,
    label: `${score}/100 — top3 in ${hitQuestions.size}/${uniqueQuestions.size} ${industryCode} questions`,
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

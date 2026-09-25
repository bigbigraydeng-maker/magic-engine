/**
 * Blog Topic Selector — Dual-Signal Mode
 *
 * Reads AI Tracker run history and identifies queries where the client brand
 * is consistently weak (not mentioned, or ranked outside top 3).
 * Enriches each opportunity with SEMrush keyword data to classify it into
 * one of three blog modes:
 *
 *   unified  — AI weak AND KD < 30 AND volume > 100   (highest value)
 *   geo_only — AI weak, but SEO signal insufficient    (AI coverage only)
 *   seo_only — Strong SEO keyword, brand already strong in AI
 *
 * Reference: ROADMAP.md Track 1.D, ARCHITECTURE.md §13.2, CLAUDE.md §十四
 */

import { supabaseAdmin } from '../supabase'
import { bulkKeywordVolume } from '../dataforseo/labs'
import { extractKeywordCandidates } from './keyword-candidates'
import { isRunConclusive } from '../ai-tracker/run-conclusive'
import type { BlogOpportunity, BlogMode } from '@/types/magic-engine'

// ─── Internal interfaces ──────────────────────────────────────────────────────

interface QueryRunSummary {
  query_id: string
  question: string
  total_runs: number
  weak_runs: number            // runs where brand rank was null or > 3
  engines_missing: Set<string>
  last_run_at: string | null
}

/** Result of SEMrush enrichment for a single AI Tracker query. */
interface KeywordMatch {
  keyword: string
  volume: number
  kd: number
  intent: string
}

// ─── Classification thresholds (per CLAUDE.md §十四) ─────────────────────────

const WEAKNESS_SCORE_THRESHOLD = 0.3   // minimum to surface as GEO weak spot
const UNIFIED_MAX_KD = 30             // KD must be < 30
const UNIFIED_MIN_VOLUME = 100        // volume must be > 100

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return blog topic opportunities sorted by priority:
 *   1. unified > geo_only > seo_only
 *   2. Within same mode: weakness_score DESC, then engines_missing count DESC
 *
 * @param clientId       - client UUID
 * @param limit          - max opportunities to return (default 20)
 * @param lookback       - how many recent runs per query to consider (default 10)
 * @param includeSemrush - whether to call DataForSEO API for keyword enrichment (default true)
 */
export async function getWeakSpotOpportunities(
  clientId: string,
  limit = 20,
  lookback = 10,
  includeSemrush = true
): Promise<BlogOpportunity[]> {
  // Guard: empty clientId
  if (!clientId || clientId.trim().length === 0) return []

  // ── Step 1: Load enabled queries for this client ──────────────────────────

  const { data: queries, error: qErr } = await supabaseAdmin
    .from('ai_visibility_queries')
    .select('id, question')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })

  if (qErr || !queries || queries.length === 0) return []

  const queryIds = queries.map((q: { id: string }) => q.id)
  const questionMap = new Map<string, string>(
    queries.map((q: { id: string; question: string }) => [q.id, q.question])
  )

  // ── Step 2: Load recent runs for all queries ──────────────────────────────

  const { data: rawRuns, error: rErr } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('query_id, ai_engine, client_brand_rank, ran_at, error_message, parse_error_message')
    .eq('client_id', clientId)
    .in('query_id', queryIds)
    .order('ran_at', { ascending: false })
    .limit(queryIds.length * lookback)

  if (rErr || !rawRuns) return []

  // Exclude failed probes — a failed run with null rank is not evidence of weakness
  const runs = rawRuns.filter(r => isRunConclusive(r))

  // ── Step 3: Aggregate per-query run summaries ─────────────────────────────

  const summaryMap = buildSummaryMap(queryIds, questionMap)
  populateSummaries(
    summaryMap,
    runs as Array<{
      query_id: string
      ai_engine: string
      client_brand_rank: number | null
      ran_at: string
    }>,
    lookback
  )

  // ── Step 4: Identify AI weak spots (score >= threshold) ───────────────────

  const weakSummaries = Array.from(summaryMap.values()).filter(
    s => s.total_runs > 0 && s.weak_runs / s.total_runs >= WEAKNESS_SCORE_THRESHOLD
  )

  // ── Step 5: Enrich with SEMrush keyword data (optional) ───────────────────
  // Fetch for ALL summaries that have runs so that both unified/geo_only and
  // seo_only classification have access to keyword metrics.

  const allSummariesWithRuns = Array.from(summaryMap.values()).filter(
    s => s.total_runs > 0
  )
  const keywordMap = await fetchKeywordData(allSummariesWithRuns, includeSemrush)

  // ── Step 6: Build opportunities with mode classification ──────────────────

  const aiWeakOpportunities = buildAiWeakOpportunities(weakSummaries, keywordMap)

  // ── Step 7: Surface seo_only opportunities from strong-brand queries ──────

  const seoOnlyOpportunities = includeSemrush
    ? buildSeoOnlyOpportunities(summaryMap, queryIds, questionMap, keywordMap)
    : []

  // ── Step 8: Merge, sort, and limit ───────────────────────────────────────

  const all = [...aiWeakOpportunities, ...seoOnlyOpportunities]
  sortOpportunities(all)
  return all.slice(0, limit)
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function buildSummaryMap(
  queryIds: string[],
  questionMap: Map<string, string>
): Map<string, QueryRunSummary> {
  const map = new Map<string, QueryRunSummary>()
  for (const queryId of queryIds) {
    map.set(queryId, {
      query_id: queryId,
      question: questionMap.get(queryId) ?? '',
      total_runs: 0,
      weak_runs: 0,
      engines_missing: new Set(),
      last_run_at: null,
    })
  }
  return map
}

function populateSummaries(
  summaryMap: Map<string, QueryRunSummary>,
  runs: Array<{
    query_id: string
    ai_engine: string
    client_brand_rank: number | null
    ran_at: string
  }>,
  lookback: number
): void {
  const perQueryCount = new Map<string, number>()

  for (const run of runs) {
    const seen = perQueryCount.get(run.query_id) ?? 0
    if (seen >= lookback) continue
    perQueryCount.set(run.query_id, seen + 1)

    const summary = summaryMap.get(run.query_id)
    if (!summary) continue

    summary.total_runs++
    if (!summary.last_run_at || run.ran_at > summary.last_run_at) {
      summary.last_run_at = run.ran_at
    }

    const isWeak = run.client_brand_rank === null || run.client_brand_rank > 3
    if (isWeak) {
      summary.weak_runs++
      summary.engines_missing.add(run.ai_engine)
    }
  }
}

/**
 * Fetch DataForSEO keyword volume data for a batch of AI-weak summaries.
 * Returns a map: keyword string → DataForSEO data.
 * Silently fails on API error, returning empty map (degrades to geo_only).
 */
async function fetchKeywordData(
  weakSummaries: QueryRunSummary[],
  includeSemrush: boolean
): Promise<Map<string, KeywordMatch>> {
  const result = new Map<string, KeywordMatch>()
  if (!includeSemrush || weakSummaries.length === 0) return result

  // Extract the top candidate keyword for each query
  const keywords: string[] = []
  const keywordToQuery = new Map<string, string>()

  for (const summary of weakSummaries) {
    const candidates = extractKeywordCandidates(summary.question)
    if (candidates.length > 0) {
      const kw = candidates[0].keyword
      if (!keywordToQuery.has(kw)) {
        keywords.push(kw)
        keywordToQuery.set(kw, summary.query_id)
      }
    }
  }

  if (keywords.length === 0) return result

  try {
    const dfseData = await bulkKeywordVolume(keywords)
    for (const row of dfseData) {
      result.set(row.keyword.toLowerCase(), {
        keyword: row.keyword,
        volume:  row.search_volume ?? 0,
        kd:      row.keyword_difficulty ?? 0,
        intent:  row.intent,
      })
    }
  } catch {
    // Quota exceeded or network failure → degrade silently to geo_only
  }

  return result
}

function classifyMode(
  weaknessScore: number,
  keywordMatch: KeywordMatch | undefined
): BlogMode {
  const hasAiWeakness = weaknessScore >= WEAKNESS_SCORE_THRESHOLD
  const hasSeoSignal =
    keywordMatch !== undefined &&
    keywordMatch.kd < UNIFIED_MAX_KD &&
    keywordMatch.volume > UNIFIED_MIN_VOLUME

  if (hasAiWeakness && hasSeoSignal) return 'unified'
  if (hasAiWeakness) return 'geo_only'
  return 'seo_only'
}

function buildAiWeakOpportunities(
  weakSummaries: QueryRunSummary[],
  keywordMap: Map<string, KeywordMatch>
): BlogOpportunity[] {
  const opportunities: BlogOpportunity[] = []

  for (const summary of weakSummaries) {
    const weaknessScore = Math.round((summary.weak_runs / summary.total_runs) * 100) / 100

    // Find best matching keyword from SEMrush data
    const candidates = extractKeywordCandidates(summary.question)
    const keywordMatch = findBestKeywordMatch(candidates.map(c => c.keyword), keywordMap)

    const mode = classifyMode(weaknessScore, keywordMatch)

    const opportunity: BlogOpportunity = {
      query_id: summary.query_id,
      query_text: summary.question,
      weakness_score: weaknessScore,
      engines_missing: Array.from(summary.engines_missing),
      total_runs_checked: summary.total_runs,
      last_run_at: summary.last_run_at,
      mode,
    }

    if (keywordMatch) {
      opportunity.primary_keyword = keywordMatch.keyword
      opportunity.keyword_volume = keywordMatch.volume
      opportunity.keyword_kd = keywordMatch.kd
      opportunity.keyword_intent = keywordMatch.intent
    }

    opportunities.push(opportunity)
  }

  return opportunities
}

/**
 * Surface seo_only opportunities from queries where the brand is already
 * strong in AI, but the associated keyword has good SEO potential.
 */
function buildSeoOnlyOpportunities(
  summaryMap: Map<string, QueryRunSummary>,
  queryIds: string[],
  questionMap: Map<string, string>,
  keywordMap: Map<string, KeywordMatch>
): BlogOpportunity[] {
  const opportunities: BlogOpportunity[] = []

  for (const queryId of queryIds) {
    const summary = summaryMap.get(queryId)
    if (!summary || summary.total_runs === 0) continue

    const weaknessScore = summary.weak_runs / summary.total_runs
    // Only queries where brand is NOT consistently weak (already good AI visibility)
    if (weaknessScore >= WEAKNESS_SCORE_THRESHOLD) continue

    // Check if there's a strong SEO keyword associated with this query
    const candidates = extractKeywordCandidates(summary.question)
    const keywordMatch = findBestKeywordMatch(candidates.map(c => c.keyword), keywordMap)

    if (!keywordMatch) continue

    const hasSeoSignal =
      keywordMatch.kd < UNIFIED_MAX_KD && keywordMatch.volume > UNIFIED_MIN_VOLUME

    if (!hasSeoSignal) continue

    const opportunity: BlogOpportunity = {
      query_id: summary.query_id,
      query_text: summary.question,
      weakness_score: Math.round(weaknessScore * 100) / 100,
      engines_missing: Array.from(summary.engines_missing),
      total_runs_checked: summary.total_runs,
      last_run_at: summary.last_run_at,
      mode: 'seo_only',
      primary_keyword: keywordMatch.keyword,
      keyword_volume: keywordMatch.volume,
      keyword_kd: keywordMatch.kd,
      keyword_intent: keywordMatch.intent,
    }

    opportunities.push(opportunity)
  }

  return opportunities
}

/**
 * Find the best SEMrush keyword match from a list of candidate keywords.
 * Tries each candidate (case-insensitive) and returns the first match found.
 */
function findBestKeywordMatch(
  candidateKeywords: string[],
  keywordMap: Map<string, KeywordMatch>
): KeywordMatch | undefined {
  for (const kw of candidateKeywords) {
    const match = keywordMap.get(kw.toLowerCase())
    if (match) return match
  }
  return undefined
}

/**
 * Sort opportunities by:
 *   1. Mode priority: unified > geo_only > seo_only
 *   2. Within same mode: weakness_score DESC
 *   3. Within same score: engines_missing count DESC (for geo/unified)
 *      or keyword_volume DESC (for seo_only)
 */
function sortOpportunities(opportunities: BlogOpportunity[]): void {
  const modePriority: Record<BlogMode, number> = {
    unified: 0,
    geo_only: 1,
    seo_only: 2,
  }

  opportunities.sort((a, b) => {
    const modeDiff = modePriority[a.mode] - modePriority[b.mode]
    if (modeDiff !== 0) return modeDiff

    const scoreDiff = b.weakness_score - a.weakness_score
    if (scoreDiff !== 0) return scoreDiff

    // Tertiary sort
    if (a.mode === 'seo_only') {
      return (b.keyword_volume ?? 0) - (a.keyword_volume ?? 0)
    }
    return b.engines_missing.length - a.engines_missing.length
  })
}

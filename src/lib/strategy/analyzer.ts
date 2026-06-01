/**
 * Analyzer for Phase 8.1 content strategy opportunities.
 * Fetches data from Supabase and produces RawOpportunity[] for the scorer.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type {
  ClientSitePageSummary,
  WeakAIQuery,
  KeywordOpportunity,
  RawOpportunity,
  ContentMode,
} from './types'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

export async function fetchClientPages(clientId: string): Promise<ClientSitePageSummary[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_site_pages')
      .select('id, url, title, page_type, topics, primary_keyword, word_count, has_geo_block')
      .eq('client_id', clientId)

    if (error || !data) return []
    return data as ClientSitePageSummary[]
  } catch {
    return []
  }
}

export async function fetchWeakAIQueries(clientId: string): Promise<WeakAIQuery[]> {
  try {
    const { data: queriesData, error: queriesError } = await supabaseAdmin
      .from('ai_visibility_queries')
      .select('id, question')
      .eq('client_id', clientId)
      .eq('enabled', true)

    if (queriesError || !queriesData) return []

    const queries = queriesData as Array<{ id: string; question: string }>
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const results: WeakAIQuery[] = []

    for (const query of queries) {
      const weakQuery = await fetchRunsForQuery(query.id, thirtyDaysAgo)
      if (weakQuery !== null) {
        results.push({ id: query.id, question: query.question, ...weakQuery })
      }
    }

    return results
  } catch {
    return []
  }
}

async function fetchRunsForQuery(
  queryId: string,
  thirtyDaysAgo: string
): Promise<{ weak_model_count: number; avg_rank: number | null } | null> {
  try {
    const { data: runsData, error: runsError } = await supabaseAdmin
      .from('ai_visibility_runs')
      .select('client_brand_rank, ran_at')
      .eq('query_id', queryId)
      .gte('ran_at', thirtyDaysAgo)

    if (runsError || !runsData) return null

    const runs = runsData as Array<{ client_brand_rank: number | null; ran_at: string }>
    const weakRuns = runs.filter(
      r => r.client_brand_rank === null || r.client_brand_rank > 3
    )

    if (weakRuns.length === 0) return null

    const rankedRuns = runs.filter(r => r.client_brand_rank !== null)
    const avg_rank =
      rankedRuns.length > 0
        ? rankedRuns.reduce((sum, r) => sum + (r.client_brand_rank as number), 0) / rankedRuns.length
        : null

    return { weak_model_count: weakRuns.length, avg_rank }
  } catch {
    return null
  }
}

export async function fetchKeywordOpportunities(clientId: string): Promise<KeywordOpportunity[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('keywords')
      .select('keyword, volume, kd, intent')
      .eq('client_id', clientId)
      .gt('volume', 50)
      .lt('kd', 50)

    if (error || !data) return []
    return data as KeywordOpportunity[]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Topic matching helpers
// ---------------------------------------------------------------------------

const STOP_TOKENS = new Set([
  'and',
  'are',
  'best',
  'for',
  'from',
  'how',
  'the',
  'this',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
])

const GENERIC_TOPIC_TOKENS = new Set([
  'china',
  'new',
  'nz',
  'operator',
  'tour',
  'travel',
  'traveller',
  'trip',
  'zealand',
])

function normalizeToken(token: string): string {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`
  }
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) {
    return token.slice(0, -1)
  }
  return token
}

function tokenize(text: string): string[] {
  const matches = text
    .toLowerCase()
    .match(/[a-z0-9]+/g)

  return (matches ?? [])
    .map(normalizeToken)
    .filter(t => t.length > 2 && !STOP_TOKENS.has(t))
}

function topicsOverlap(questionTokens: string[], page: ClientSitePageSummary): boolean {
  const pageText = [
    page.url,
    page.title ?? '',
    page.primary_keyword ?? '',
    ...page.topics,
  ]
    .join(' ')
    .toLowerCase()

  const pageTokenSet = new Set(tokenize(pageText))
  const uniqueQuestionTokens = Array.from(new Set(questionTokens))
  const strongTokens = uniqueQuestionTokens.filter(token => !GENERIC_TOPIC_TOKENS.has(token))
  const genericTokens = uniqueQuestionTokens.filter(token => GENERIC_TOPIC_TOKENS.has(token))
  const matchedStrongCount = strongTokens.filter(token => pageTokenSet.has(token)).length
  const matchedGenericCount = genericTokens.filter(token => pageTokenSet.has(token)).length

  if (strongTokens.length === 0) {
    return matchedGenericCount >= 2
  }

  return matchedStrongCount >= 2 || (matchedStrongCount >= 1 && matchedGenericCount >= 1)
}

function findMatchingKeyword(
  text: string,
  keywords: KeywordOpportunity[]
): KeywordOpportunity | null {
  const textLower = text.toLowerCase()
  return (
    keywords.find(kw =>
      tokenize(kw.keyword).some(token => textLower.includes(token)) ||
      tokenize(textLower).some(token => kw.keyword.toLowerCase().includes(token))
    ) ?? null
  )
}

// ---------------------------------------------------------------------------
// Opportunity building helpers
// ---------------------------------------------------------------------------

function buildRationale(page: ClientSitePageSummary): string {
  const wc = page.word_count ?? 0
  const parts: string[] = []
  if (!page.has_geo_block) parts.push('Page lacks GEO block')
  if (wc < 500) parts.push(`Low word count (${wc} words)`)
  return parts.join('; ') || 'Page needs optimization'
}

function buildUpgradeOpportunity(
  page: ClientSitePageSummary,
  matchedQuery: WeakAIQuery | null,
  matchedKeyword: KeywordOpportunity | null
): RawOpportunity {
  const ai_weak = matchedQuery !== null
  const hasKeyword = matchedKeyword !== null

  let content_mode: ContentMode
  if (ai_weak && hasKeyword) {
    content_mode = 'unified'
  } else if (ai_weak) {
    content_mode = 'geo_only'
  } else if (hasKeyword) {
    content_mode = 'seo_only'
  } else {
    content_mode = 'geo_only'
  }

  return {
    action_type: 'upgrade_page',
    content_mode,
    proposed_title: `Upgrade: ${page.title ?? page.url}`,
    rationale: buildRationale(page),
    content_angle: 'Strengthen existing content with GEO signals and SEO optimization',
    source_page_id: page.id,
    source_query_id: matchedQuery?.id ?? null,
    source_keyword: matchedKeyword?.keyword ?? null,
    keyword_volume: matchedKeyword?.volume ?? null,
    keyword_kd: matchedKeyword?.kd ?? null,
    scoring_context: {
      has_existing_page: true,
      has_geo_block: page.has_geo_block,
      word_count: page.word_count,
      page_type: page.page_type,
      ai_weak,
      ai_weak_model_count: matchedQuery?.weak_model_count ?? 0,
      keyword_volume: matchedKeyword?.volume ?? null,
      keyword_kd: matchedKeyword?.kd ?? null,
    },
  }
}

function buildNewBlogOpportunity(
  query: WeakAIQuery,
  matchedKeyword: KeywordOpportunity | null
): RawOpportunity {
  const hasKeyword = matchedKeyword !== null
  const content_mode: ContentMode = hasKeyword ? 'unified' : 'geo_only'

  return {
    action_type: 'new_blog',
    content_mode,
    proposed_title: `New: ${query.question}`,
    rationale: `AI models rank brand weakly for this query (${query.weak_model_count} models)`,
    content_angle: 'Answer the query directly with factual, authoritative content',
    source_page_id: null,
    source_query_id: query.id,
    source_keyword: matchedKeyword?.keyword ?? null,
    keyword_volume: matchedKeyword?.volume ?? null,
    keyword_kd: matchedKeyword?.kd ?? null,
    scoring_context: {
      has_existing_page: false,
      has_geo_block: false,
      word_count: null,
      page_type: null,
      ai_weak: true,
      ai_weak_model_count: query.weak_model_count,
      keyword_volume: matchedKeyword?.volume ?? null,
      keyword_kd: matchedKeyword?.kd ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

const MODE_RANK: Record<ContentMode, number> = { unified: 3, geo_only: 2, seo_only: 1 }

function deduplicateByPage(opportunities: RawOpportunity[]): RawOpportunity[] {
  const byPage = new Map<string, RawOpportunity>()

  for (const opp of opportunities) {
    if (opp.source_page_id === null) continue
    const existing = byPage.get(opp.source_page_id)
    if (!existing || MODE_RANK[opp.content_mode] > MODE_RANK[existing.content_mode]) {
      byPage.set(opp.source_page_id, opp)
    }
  }

  const noPageOpps = opportunities.filter(o => o.source_page_id === null)
  return [...Array.from(byPage.values()), ...noPageOpps]
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export async function analyzeOpportunities(
  _clientId: string,
  pages: ClientSitePageSummary[],
  weakQueries: WeakAIQuery[],
  keywords: KeywordOpportunity[]
): Promise<RawOpportunity[]> {
  const opportunities: RawOpportunity[] = []

  // Step 1 — Upgrade opportunities from existing pages needing improvement
  for (const page of pages) {
    const needsUpgrade = !page.has_geo_block || (page.word_count ?? 0) < 500
    if (!needsUpgrade) continue

    const pageText = [page.url, page.primary_keyword ?? '', ...page.topics].join(' ')
    const matchedQuery =
      weakQueries.find(q => {
        const qTokens = tokenize(q.question)
        return topicsOverlap(qTokens, page)
      }) ?? null

    const matchedKeyword = findMatchingKeyword(pageText, keywords)
    opportunities.push(buildUpgradeOpportunity(page, matchedQuery, matchedKeyword))
  }

  // Step 2 — New blog opportunities from weak AI queries with no matching page
  for (const query of weakQueries) {
    const questionTokens = tokenize(query.question)
    const isCovered = pages.some(page => topicsOverlap(questionTokens, page))
    if (isCovered) continue

    const matchedKeyword = findMatchingKeyword(query.question, keywords)
    opportunities.push(buildNewBlogOpportunity(query, matchedKeyword))
  }

  // Step 3 — Deduplicate and cap
  const deduped = deduplicateByPage(opportunities)
  return deduped.slice(0, 50)
}

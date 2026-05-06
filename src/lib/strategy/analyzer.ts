/**
 * Strategy Analyzer — Phase 8.D.1.2
 *
 * Pure 3-dimensional cross of:
 *   • AI Tracker weak spots          (where the brand fails to be recommended)
 *   • client_site_pages snapshot     (what the brand already publishes)
 *   • SEMrush keyword opportunities  (what's reachable via Google)
 *
 * Output: a flat list of strategy Candidates. The scorer (Phase 8.D.1.3)
 * turns each Candidate into a numeric priority; the orchestrator
 * (Phase 8.D.1.4) persists them as content_strategy_items rows.
 *
 * Reference: ROADMAP.md P8.D.1.2, ARCHITECTURE.md §3.7
 */

import type { SitePageType, StrategyContentMode } from '@/types/magic-engine'

export interface WeakQuery {
  query_id: string
  question: string
  weakness_score: number          // 0–1 (1 = always missing)
  best_engine_rank: number | null // null = never appears
  topics: string[]                // tags inferred from the question
}

export interface KeywordOpportunity {
  keyword: string
  volume: number | null
  kd: number | null               // 0-100 difficulty
  intent?: string
  topics: string[]
}

export interface SitePageRef {
  id: string
  url: string
  page_type: SitePageType
  topics: string[]
  primary_keyword: string | null
  word_count: number | null
  has_geo_block: boolean
}

export interface AnalyzerInput {
  weak_queries: WeakQuery[]
  site_pages: SitePageRef[]
  keywords: KeywordOpportunity[]
}

export interface Candidate {
  action_type: 'upgrade_page' | 'new_blog' | 'social_content'
  content_mode: StrategyContentMode
  proposed_title: string
  rationale: string
  content_angle?: string
  source_page_id?: string
  source_query_id?: string
  source_keyword?: string
  keyword_volume?: number
  keyword_kd?: number
  // hints used by the scorer
  existing_word_count?: number
  existing_has_geo_block?: boolean
}

const SEO_KD_CEILING = 60          // above this we drop the SEO opportunity
const PAGE_THIN_WORD_COUNT = 800   // below this we treat the page as upgradable
const TOPIC_OVERLAP_MIN = 1        // shared tags needed to consider topics related

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function topicOverlap(a: string[], b: string[]): number {
  if (!a?.length || !b?.length) return 0
  const setB = new Set(b.map((t) => t.toLowerCase()))
  return a.filter((t) => setB.has(t.toLowerCase())).length
}

function keywordCoveredByPage(
  keyword: KeywordOpportunity,
  pages: SitePageRef[]
): SitePageRef | null {
  const target = keyword.keyword.toLowerCase()
  for (const p of pages) {
    if (p.primary_keyword && p.primary_keyword.toLowerCase() === target) return p
    if (topicOverlap(keyword.topics, p.topics) >= TOPIC_OVERLAP_MIN) return p
  }
  return null
}

function relatedKeywordForWeakSpot(
  weak: WeakQuery,
  keywords: KeywordOpportunity[]
): KeywordOpportunity | null {
  let best: KeywordOpportunity | null = null
  let bestScore = -1
  for (const k of keywords) {
    if (k.kd != null && k.kd > SEO_KD_CEILING) continue
    const overlap = topicOverlap(weak.topics, k.topics)
    if (overlap >= TOPIC_OVERLAP_MIN) {
      const score = (k.volume ?? 0) - (k.kd ?? 0)
      if (score > bestScore) {
        best = k
        bestScore = score
      }
    }
  }
  return best
}

function pageCoveringWeakSpot(
  weak: WeakQuery,
  pages: SitePageRef[]
): SitePageRef | null {
  let best: SitePageRef | null = null
  let bestOverlap = 0
  for (const p of pages) {
    const overlap = topicOverlap(weak.topics, p.topics)
    if (overlap > bestOverlap) {
      best = p
      bestOverlap = overlap
    }
  }
  return best
}

function pageIsStrong(p: SitePageRef): boolean {
  return (p.word_count ?? 0) >= PAGE_THIN_WORD_COUNT && p.has_geo_block
}

function titleFromKeyword(kw: string): string {
  return kw
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// ──────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────

export function crossSignals(input: AnalyzerInput): Candidate[] {
  const out: Candidate[] = []
  const { weak_queries, site_pages, keywords } = input

  const seenKeywordsViaWeakSpots = new Set<string>()

  // 1. AI weak spots → upgrade existing OR create new (unified / geo_only)
  for (const w of weak_queries) {
    const existing = pageCoveringWeakSpot(w, site_pages)
    const seoOpp = relatedKeywordForWeakSpot(w, keywords)

    if (existing && !pageIsStrong(existing)) {
      out.push({
        action_type: 'upgrade_page',
        content_mode: seoOpp ? 'unified' : 'geo_only',
        proposed_title: existing.url,
        rationale: existing.has_geo_block
          ? `Page exists but is thin (${existing.word_count ?? 0} words) — expand to fully address "${w.question}".`
          : `Page exists but is missing GEO directive block — re-publish with GEO + content depth to capture "${w.question}".`,
        content_angle: 'upgrade existing page; do not duplicate',
        source_page_id: existing.id,
        source_query_id: w.query_id,
        source_keyword: seoOpp?.keyword,
        keyword_volume: seoOpp?.volume ?? undefined,
        keyword_kd: seoOpp?.kd ?? undefined,
        existing_word_count: existing.word_count ?? 0,
        existing_has_geo_block: existing.has_geo_block,
      })
      if (seoOpp) seenKeywordsViaWeakSpots.add(seoOpp.keyword.toLowerCase())
      continue
    }

    if (existing && pageIsStrong(existing)) {
      // a robust page already covers this weak query — skip new_blog
      // (the analyzer assumes GEO directive will refresh AI ranking)
      continue
    }

    // no covering page → new blog
    if (seoOpp && !seenKeywordsViaWeakSpots.has(seoOpp.keyword.toLowerCase())) {
      out.push({
        action_type: 'new_blog',
        content_mode: 'unified',
        proposed_title: titleFromKeyword(seoOpp.keyword),
        rationale: `AI engines miss the brand for "${w.question}" and "${seoOpp.keyword}" is a low-KD opening (KD ${seoOpp.kd ?? '?'}, vol ${seoOpp.volume ?? '?'}).`,
        source_query_id: w.query_id,
        source_keyword: seoOpp.keyword,
        keyword_volume: seoOpp.volume ?? undefined,
        keyword_kd: seoOpp.kd ?? undefined,
      })
      seenKeywordsViaWeakSpots.add(seoOpp.keyword.toLowerCase())
    } else if (!seoOpp) {
      out.push({
        action_type: 'new_blog',
        content_mode: 'geo_only',
        proposed_title: w.question,
        rationale: `AI engines do not recommend the brand for "${w.question}" — publish a focused, GEO-injected answer.`,
        source_query_id: w.query_id,
      })
    }
    // seoOpp already seen → skip (another weak query already claimed this keyword)
  }

  // 2. Keyword-only opportunities (seo_only) — only for keywords not yet
  //    paired to a weak spot AND not already covered by a strong page.
  for (const k of keywords) {
    if (k.kd != null && k.kd > SEO_KD_CEILING) continue
    if (seenKeywordsViaWeakSpots.has(k.keyword.toLowerCase())) continue

    const covered = keywordCoveredByPage(k, site_pages)
    if (covered && pageIsStrong(covered)) continue

    out.push({
      action_type: 'new_blog',
      content_mode: 'seo_only',
      proposed_title: titleFromKeyword(k.keyword),
      rationale: `Low-KD keyword "${k.keyword}" (KD ${k.kd ?? '?'}, vol ${k.volume ?? '?'}) — pure SEO play.`,
      source_keyword: k.keyword,
      keyword_volume: k.volume ?? undefined,
      keyword_kd: k.kd ?? undefined,
    })
  }

  return out
}

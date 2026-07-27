/**
 * Weekly topic selection for the SEO loop.
 *
 * Produces CANDIDATES ONLY. Nothing here writes an article and nothing here
 * publishes. A human picks from this list; the draft pipeline runs afterwards.
 *
 * Priority order is fixed and deliberate:
 *   1. opportunity gap    — a competitor ranks, we do not. Proven demand we
 *                           are absent from, so it converts straight into a
 *                           brief.
 *   2. striking distance  — we already sit 11–20. Cheapest possible win: the
 *                           page exists and only needs a push onto page one.
 *   3. ai_visibility gap  — AI assistants answer the question without citing
 *                           us, and the term is not fiercely contested. This
 *                           is ME's dual-signal (SEO x GEO) design.
 *
 * REPORTING SCOPE: a candidate carries evidence about *position and presence*
 * only. It must never claim projected traffic, leads or revenue — see the
 * header of comparisons.ts.
 */

import type { OpportunityGapRow, StrikingDistanceRow } from './comparisons'

export type TopicCandidateSource =
  | 'opportunity_gap'
  | 'striking_distance'
  | 'ai_visibility_gap'

export interface AiVisibilityGap {
  /** The question asked of the AI assistant. */
  question: string
  /** null = brand not mentioned at all; a number = mentioned but ranked low. */
  brand_rank: number | null
  keyword_difficulty?: number | null
}

export interface TopicCandidate {
  keyword: string
  source: TopicCandidateSource
  /** 1 = highest priority this week. */
  priority: number
  /** Our current organic position, or null when we do not rank at all. */
  my_position: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  /** Competitor domains that currently rank, best position first. */
  competitors_ranking: string[]
  /** Plain-language justification shown to the reviewer. */
  reason: string
}

export interface TopicCandidateInput {
  gap: readonly OpportunityGapRow[]
  striking: readonly StrikingDistanceRow[]
  aiGaps?: readonly AiVisibilityGap[]
  /** Max keyword difficulty for an AI-visibility candidate. Default 30. */
  maxAiKeywordDifficulty?: number
}

function orderedCompetitors(positions: Record<string, number>): string[] {
  return Object.entries(positions)
    .sort((a, b) => a[1] - b[1])
    .map(([domain]) => domain)
}

function describeCompetitors(positions: Record<string, number>): string {
  return Object.entries(positions)
    .sort((a, b) => a[1] - b[1])
    .map(([domain, position]) => `${domain} 第 ${position} 名`)
    .join('、')
}

/**
 * Select this week's topic candidates.
 *
 * Deduplicates by keyword across sources — the first (highest priority) source
 * to claim a keyword keeps it.
 */
export function selectTopicCandidates(
  input: TopicCandidateInput,
  limit = 3,
): TopicCandidate[] {
  const maxAiKd = input.maxAiKeywordDifficulty ?? 30
  const chosen: TopicCandidate[] = []
  const seen = new Set<string>()

  const take = (keyword: string): boolean => {
    const key = keyword.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }

  // --- 1. opportunity gap -------------------------------------------------
  for (const row of input.gap) {
    if (chosen.length >= limit) break
    if (!take(row.keyword)) continue
    chosen.push({
      keyword: row.keyword,
      source: 'opportunity_gap',
      priority: chosen.length + 1,
      my_position: null,
      search_volume: row.search_volume,
      keyword_difficulty: row.keyword_difficulty,
      competitors_ranking: orderedCompetitors(row.competitor_positions),
      reason:
        `我们完全没有排名，但 ${row.competitor_count} 家竞品有：` +
        `${describeCompetitors(row.competitor_positions)}。` +
        `月搜索量 ${row.search_volume ?? '未知'}，说明需求真实存在而我们缺席。`,
    })
  }

  // --- 2. striking distance ----------------------------------------------
  for (const row of input.striking) {
    if (chosen.length >= limit) break
    if (!take(row.keyword)) continue
    chosen.push({
      keyword: row.keyword,
      source: 'striking_distance',
      priority: chosen.length + 1,
      my_position: row.position,
      search_volume: row.search_volume,
      keyword_difficulty: row.keyword_difficulty,
      competitors_ranking: [],
      reason:
        `我们已经排到第 ${row.position} 名，差一步进首页。` +
        `月搜索量 ${row.search_volume ?? '未知'}，页面已存在，` +
        `补内容/内链的成本远低于从零做一个新词。`,
    })
  }

  // --- 3. AI visibility gap ----------------------------------------------
  for (const row of input.aiGaps ?? []) {
    if (chosen.length >= limit) break
    const kd = row.keyword_difficulty ?? null
    if (kd != null && kd > maxAiKd) continue
    if (!take(row.question)) continue
    chosen.push({
      keyword: row.question,
      source: 'ai_visibility_gap',
      priority: chosen.length + 1,
      my_position: null,
      search_volume: null,
      keyword_difficulty: kd,
      competitors_ranking: [],
      reason:
        row.brand_rank == null
          ? `AI 助手回答这个问题时完全没提到我们，且这个词竞争度低（KD ${kd ?? '未知'}），适合用双信号内容抢占。`
          : `AI 助手回答这个问题时只把我们排在第 ${row.brand_rank} 位，且竞争度低（KD ${kd ?? '未知'}），有机会往前推。`,
    })
  }

  return chosen
}

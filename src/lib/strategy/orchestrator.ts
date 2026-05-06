/**
 * Strategy Orchestrator — Phase 8.D.1.4
 *
 * Composes signals → analyzer → scorer → DB insert into a single
 * entry point that the API route can call.
 *
 * Reference: ROADMAP.md P8.D.1.4
 */

import { randomUUID } from 'crypto'

import type { ContentStrategyInsert } from '@/types/magic-engine'
import { listSitePages } from '@/lib/db/site-pages'
import { insertStrategyItems } from '@/lib/db/strategy-items'
import { crossSignals, type Candidate, type SitePageRef } from './analyzer'
import { scoreCandidate, derivePriorityBucket } from './scorer'
import { fetchWeakQueries, fetchKeywordOpportunities } from './signals'

export interface StrategySummary {
  client_id: string
  strategy_run_id: string
  candidates_generated: number
  upgrade_pages: number
  new_blogs: number
  social_content: number
  unified_count: number
  geo_only_count: number
  seo_only_count: number
  ran_at: string
}

function topicsFromUrl(url: string): string[] {
  try {
    const path = new URL(url).pathname
    return path
      .replace(/[^a-z0-9\s-]/gi, ' ')
      .split(/[-/\s]+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 4)
      .slice(0, 6)
  } catch {
    return []
  }
}

function pageToRef(p: any): SitePageRef {
  const topics: string[] =
    Array.isArray(p.topics) && p.topics.length > 0
      ? p.topics
      : topicsFromUrl(p.url)
  return {
    id: p.id,
    url: p.url,
    page_type: p.page_type,
    topics,
    primary_keyword: p.primary_keyword ?? null,
    word_count: p.word_count ?? null,
    has_geo_block: !!p.has_geo_block,
  }
}

export async function runStrategyAnalysis(
  clientId: string
): Promise<StrategySummary> {
  const strategyRunId = randomUUID()
  const ranAt = new Date().toISOString()

  const EXCLUDED_PATHS = /\/(site-?map|search|tag|category|author|feed|rss|robots|sitemap\.xml)/i

  const [weak, allPages, keywords] = await Promise.all([
    fetchWeakQueries(clientId),
    listSitePages(clientId, { crawl_status: 'crawled' }),
    fetchKeywordOpportunities(clientId),
  ])
  const pages = allPages.filter((p) => !EXCLUDED_PATHS.test(p.url))

  const candidates = crossSignals({
    weak_queries: weak,
    site_pages: pages.map(pageToRef),
    keywords,
  })

  const rows: ContentStrategyInsert[] = candidates.map((c: Candidate) => {
    const score = scoreCandidate(c)
    return {
      client_id: clientId,
      strategy_run_id: strategyRunId,
      action_type: c.action_type,
      content_mode: c.content_mode,
      priority: derivePriorityBucket(score),
      priority_score: score,
      proposed_title: c.proposed_title ?? null,
      rationale: c.rationale ?? null,
      content_angle: c.content_angle ?? null,
      source_page_id: c.source_page_id ?? null,
      source_query_id: c.source_query_id ?? null,
      source_keyword: c.source_keyword ?? null,
      keyword_volume: c.keyword_volume ?? null,
      keyword_kd: c.keyword_kd ?? null,
      status: 'pending',
    }
  })

  await insertStrategyItems(rows)

  return {
    client_id: clientId,
    strategy_run_id: strategyRunId,
    candidates_generated: candidates.length,
    upgrade_pages: candidates.filter((c) => c.action_type === 'upgrade_page').length,
    new_blogs: candidates.filter((c) => c.action_type === 'new_blog').length,
    social_content: candidates.filter((c) => c.action_type === 'social_content').length,
    unified_count: candidates.filter((c) => c.content_mode === 'unified').length,
    geo_only_count: candidates.filter((c) => c.content_mode === 'geo_only').length,
    seo_only_count: candidates.filter((c) => c.content_mode === 'seo_only').length,
    ran_at: ranAt,
  }
}

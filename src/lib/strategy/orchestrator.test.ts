/**
 * Tests for strategy orchestrator (Phase 8.D.1.4)
 *
 * runStrategyAnalysis composes:
 *   fetchWeakQueries + listSitePages + fetchKeywordOpportunities
 *   → crossSignals → scoreCandidate → insertStrategyItems
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/site-pages', () => ({ listSitePages: vi.fn() }))
vi.mock('@/lib/db/strategy-items', () => ({ insertStrategyItems: vi.fn() }))
vi.mock('./signals', () => ({
  fetchWeakQueries: vi.fn(),
  fetchKeywordOpportunities: vi.fn(),
}))

import { runStrategyAnalysis } from './orchestrator'
import { listSitePages } from '@/lib/db/site-pages'
import { insertStrategyItems } from '@/lib/db/strategy-items'
import { fetchWeakQueries, fetchKeywordOpportunities } from './signals'

const CLIENT_ID = 'client-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runStrategyAnalysis', () => {
  it('persists analyzer output with priority + score derived', async () => {
    vi.mocked(fetchWeakQueries).mockResolvedValue([
      {
        query_id: 'q1',
        question: 'best china tour operator in NZ',
        weakness_score: 0.9,
        best_engine_rank: null,
        topics: ['china-tours'],
      },
    ])
    vi.mocked(fetchKeywordOpportunities).mockResolvedValue([
      {
        keyword: 'china tour nz',
        volume: 320,
        kd: 28,
        topics: ['china-tours'],
      },
    ])
    vi.mocked(listSitePages).mockResolvedValue([])
    vi.mocked(insertStrategyItems).mockImplementation(async (rows) =>
      rows.map((r, i) => ({
        id: `item-${i}`,
        ...r,
        priority: r.priority ?? 'medium',
        status: r.status ?? 'pending',
        created_at: 'now',
        updated_at: 'now',
        proposed_title: r.proposed_title ?? null,
        rationale: r.rationale ?? null,
        content_angle: r.content_angle ?? null,
        source_page_id: r.source_page_id ?? null,
        source_query_id: r.source_query_id ?? null,
        source_keyword: r.source_keyword ?? null,
        keyword_volume: r.keyword_volume ?? null,
        keyword_kd: r.keyword_kd ?? null,
        linked_blog_post_id: null,
      })) as any
    )

    const summary = await runStrategyAnalysis(CLIENT_ID)

    expect(summary.candidates_generated).toBeGreaterThan(0)
    expect(summary.strategy_run_id).toMatch(/[0-9a-f-]{8}/i)

    expect(insertStrategyItems).toHaveBeenCalledTimes(1)
    const inserted = vi.mocked(insertStrategyItems).mock.calls[0][0]
    expect(inserted.length).toBeGreaterThan(0)
    inserted.forEach((row) => {
      expect(row.client_id).toBe(CLIENT_ID)
      expect(row.strategy_run_id).toBe(summary.strategy_run_id)
      expect(row.priority_score).toBeGreaterThan(0)
      expect(row.priority_score).toBeLessThanOrEqual(100)
      expect(['critical', 'high', 'medium', 'low']).toContain(row.priority)
    })
  })

  it('returns empty summary when nothing crosses', async () => {
    vi.mocked(fetchWeakQueries).mockResolvedValue([])
    vi.mocked(fetchKeywordOpportunities).mockResolvedValue([])
    vi.mocked(listSitePages).mockResolvedValue([])
    vi.mocked(insertStrategyItems).mockResolvedValue([])

    const summary = await runStrategyAnalysis(CLIENT_ID)
    expect(summary.candidates_generated).toBe(0)
    expect(insertStrategyItems).toHaveBeenCalledWith([])
  })

  it('passes site pages through to analyzer (covered topic should suppress redundant new_blog)', async () => {
    vi.mocked(fetchWeakQueries).mockResolvedValue([
      {
        query_id: 'q1',
        question: 'q',
        weakness_score: 1,
        best_engine_rank: null,
        topics: ['china-tours'],
      },
    ])
    vi.mocked(fetchKeywordOpportunities).mockResolvedValue([
      { keyword: 'china tour nz', volume: 320, kd: 28, topics: ['china-tours'] },
    ])
    vi.mocked(listSitePages).mockResolvedValue([
      {
        id: 'strong',
        client_id: CLIENT_ID,
        url: 'https://example.com/x',
        path: '/x',
        page_type: 'service',
        title: null,
        h1: null,
        meta_description: null,
        content_summary: null,
        word_count: 1500,
        topics: ['china-tours'],
        primary_keyword: 'china tour nz',
        has_geo_block: true,
        geo_block_version: null,
        crawl_status: 'crawled',
        last_crawled_at: null,
        crawl_error: null,
        created_at: 'now',
        updated_at: 'now',
      } as any,
    ])
    vi.mocked(insertStrategyItems).mockImplementation(async (rows) =>
      rows.map((r) => ({ id: 'x', ...r }) as any)
    )

    const summary = await runStrategyAnalysis(CLIENT_ID)
    expect(summary.candidates_generated).toBe(0)
  })
})

/**
 * Wiring test for runSeoPatrolForClient: the existing-card hold and the weekly cap must
 * sit between "findings saved" and "cards written". The rule engine, the page-signal
 * feed and the card writer are stubbed; the card lookup runs for real against a
 * table-modelled fake (the Meta binding fake, reused because it models delete / in /
 * gte / limit and throws on methods it does not model — an `or()` would fail loudly).
 *
 * NOW is deliberately far from the real clock: if the job ignored the `now` it is
 * given, the 14-day hold below would not line up and the first test would fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../rules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rules')>()
  return { ...actual, runSeoPatrolRules: vi.fn() }
})
vi.mock('../page-signals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../page-signals')>()
  return { ...actual, buildPageSignals: vi.fn() }
})
vi.mock('@/lib/zhuge/action-persister', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zhuge/action-persister')>()
  return { ...actual, persistZhugeActions: vi.fn() }
})

import { runSeoPatrolRules } from '../rules'
import { buildPageSignals } from '../page-signals'
import { persistZhugeActions } from '@/lib/zhuge/action-persister'
import { runSeoPatrolForClient } from '../job'
import { makeBindingFakeDb, asSupabaseClient, type FakeDb, type Row } from '@/lib/meta/__tests__/binding-fake-db'
import type { SeoPatrolFinding } from '../types'

const NOW = new Date('2025-01-15T04:00:00Z')
const CLIENT = { id: 'c1', domain: 'example.com', semrush_db: 'au' }
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

function finding(partial: Partial<SeoPatrolFinding>): SeoPatrolFinding {
  return {
    clientId: 'c1',
    ruleId: 'keyword_opportunity',
    keyword: 'kw',
    url: null,
    position: null,
    ctr: null,
    ctrBenchmark: null,
    searchVolume: null,
    keywordDifficulty: null,
    positionDelta: null,
    suggestedActionType: 'seo.publish_blog',
    description: 'desc',
    ...partial,
  }
}

function card(partial: Row): Row {
  return {
    client_id: 'c1',
    dimension: 'seo',
    action_type: 'seo.publish_blog',
    status: 'pending',
    source: 'zhuge',
    steps_json: { keyword: 'kw', rule_id: 'keyword_opportunity' },
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    ...partial,
  }
}

beforeEach(() => {
  vi.mocked(runSeoPatrolRules).mockReset()
  vi.mocked(buildPageSignals).mockResolvedValue({
    pages: [],
    meta: { crawled_pages: 0, gsc_pages: 0, matched: 0, crawl_data_missing: true },
  })
  vi.mocked(persistZhugeActions).mockReset()
  vi.mocked(persistZhugeActions).mockImplementation(async (_supabase, input) => ({
    inserted: input.output.top_actions.length,
    idempotent: false,
    action_ids: [],
    session_key: 'test-session',
  }))
})

describe('runSeoPatrolForClient wiring', () => {
  it('writes a card only for the target that has no card yet, using the run time it is given', async () => {
    const db: FakeDb = {
      execution_items: [
        card({
          status: 'skipped',
          source: 'fde',
          steps_json: { keyword: 'held' },
          created_at: daysAgo(40),
          updated_at: daysAgo(10),
        }),
      ],
    }
    vi.mocked(runSeoPatrolRules).mockReturnValue([
      finding({ keyword: 'held' }),
      finding({ keyword: 'new' }),
    ])

    const result = await runSeoPatrolForClient(CLIENT, asSupabaseClient(makeBindingFakeDb(db)), NOW)

    expect(persistZhugeActions).toHaveBeenCalledTimes(1)
    const keywords = vi
      .mocked(persistZhugeActions)
      .mock.calls[0][1].output.top_actions.map((a) => a.metadata?.keyword)
    expect(keywords).toEqual(['new'])
    expect(result.actions_created).toBe(1)
    expect(result.findings_held_existing_card).toBe(1)
    expect(result.cards_withheld_reason).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('opens no card when the existing-card lookup fails, but still saves the findings', async () => {
    const db: FakeDb = {}
    vi.mocked(runSeoPatrolRules).mockReturnValue([finding({ keyword: 'a' })])

    const result = await runSeoPatrolForClient(
      CLIENT,
      asSupabaseClient(makeBindingFakeDb(db, { select: new Set(['execution_items']) })),
      NOW,
    )

    expect(persistZhugeActions).not.toHaveBeenCalled()
    expect(result.cards_withheld_reason).toBe('card_lookup_failed')
    expect(result.error).toContain('card lookup failed')
    expect((db.seo_patrol_findings ?? []).length).toBeGreaterThan(0)
  })

  it('opens no card once three targets were carded this week, and says the weekly cap did it', async () => {
    const db: FakeDb = {
      execution_items: [
        card({ status: 'completed', created_at: daysAgo(2), updated_at: daysAgo(2), steps_json: { keyword: 'x', rule_id: 'keyword_opportunity' } }),
        card({ status: 'completed', created_at: daysAgo(2), updated_at: daysAgo(2), steps_json: { keyword: 'y', rule_id: 'keyword_opportunity' } }),
        card({ status: 'completed', created_at: daysAgo(2), updated_at: daysAgo(2), steps_json: { keyword: 'z', rule_id: 'keyword_opportunity' } }),
      ],
    }
    vi.mocked(runSeoPatrolRules).mockReturnValue([finding({ keyword: 'fresh' })])

    const result = await runSeoPatrolForClient(CLIENT, asSupabaseClient(makeBindingFakeDb(db)), NOW)

    expect(persistZhugeActions).not.toHaveBeenCalled()
    expect(result.actions_created).toBe(0)
    expect(result.cards_withheld_reason).toBe('weekly_cap')
  })
})

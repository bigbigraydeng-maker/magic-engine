/**
 * Phase 33 M4 — getExecutionSummaryForGoal tests
 *
 * Per 子牙 review the following must be true:
 *   1. Completion % denominator = total - skipped (skipped excluded)
 *   2. Dead campaign IDs (rows deleted from campaign_briefs) are filtered out
 *   3. Campaigns linked with non-active status (paused, draft) are STILL counted
 *      in total/status breakdown (not dropped like InitiativeExecutionPanel
 *      dropdown does)
 *   4. Goal with 0 initiatives returns zeros, not null/throw
 *   5. Initiative with 0 actions returns completionPct=null (no NaN, no false 0%)
 *   6. Archived initiatives + 'unassigned' bucket are excluded from the summary
 *   7. Duplicate campaign_ids across initiatives are de-duplicated for the
 *      Goal-level totalCampaigns count
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import type { SupabaseClient } from '@supabase/supabase-js'
import { getExecutionSummaryForGoal } from '../initiatives'

const GOAL_ID = 'goal-1'

interface MockActionRow { initiative_id: string; status: string }
interface MockCampaignRow { id: string; status: string | null }
interface MockInitiativeRow {
  id: string
  goal_id: string
  client_id: string
  initiative_type: string
  title: string
  is_archived: boolean
  campaign_ids: string[] | null
  // remaining columns can be null/default in tests
  [k: string]: unknown
}

function makeInit(overrides: Partial<MockInitiativeRow> = {}): MockInitiativeRow {
  return {
    id: 'init-default',
    goal_id: GOAL_ID,
    client_id: 'client-1',
    initiative_type: 'demand_generation',
    title: 'Default',
    is_archived: false,
    campaign_ids: [],
    tier: 'terminal',
    posture: null,
    budget_percent: null,
    budget_amount: null,
    hypothesis: null,
    hypothesis_polished_by_ai: false,
    supports_initiative_id: null,
    sort_order: 0,
    created_at: '2026-06-03T00:00:00Z',
    updated_at: '2026-06-03T00:00:00Z',
    ...overrides,
  }
}

/**
 * Builds a Supabase mock that returns canned data per table.
 *
 * Use:
 *   buildSupabase({
 *     initiatives: [...],
 *     execution_items: [...],
 *     campaign_briefs: [...],
 *   })
 */
function buildSupabase(tables: {
  initiatives?: MockInitiativeRow[]
  execution_items?: MockActionRow[]
  campaign_briefs?: MockCampaignRow[]
}): SupabaseClient {
  const fromFn = (table: string) => {
    if (table === 'initiatives') {
      // listInitiativesForGoal chains: .select().eq().order().order().eq() (is_archived filter)
      const data = tables.initiatives ?? []
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        // final await: { data, error }
        then: (cb: (v: { data: typeof data; error: null }) => unknown) =>
          cb({ data, error: null }),
      }
      return chain
    }
    if (table === 'execution_items') {
      const data = tables.execution_items ?? []
      const chain = {
        select: () => chain,
        in: () => ({ data, error: null }),
      }
      return chain
    }
    if (table === 'campaign_briefs') {
      const data = tables.campaign_briefs ?? []
      const chain = {
        select: () => chain,
        in: () => ({ data, error: null }),
      }
      return chain
    }
    throw new Error(`Unexpected table: ${table}`)
  }
  return { from: fromFn } as unknown as SupabaseClient
}

describe('getExecutionSummaryForGoal', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns zeros (not null/throw) when Goal has no initiatives', async () => {
    const sb = buildSupabase({ initiatives: [] })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result).toEqual({
      goalId: GOAL_ID,
      initiativeCount: 0,
      totalCampaigns: 0,
      totalActions: 0,
      totalCompleted: 0,
      totalInProgress: 0,
      totalPending: 0,
      totalSkipped: 0,
      aggregateCompletionPct: null,
      perInitiative: [],
    })
  })

  it('excludes skipped from completion denominator', async () => {
    // 10 actions: 4 completed, 2 skipped, 2 pending, 2 in_progress
    // denom = 10 - 2 = 8, completed = 4, pct = 50%
    const init = makeInit({ id: 'i1' })
    const sb = buildSupabase({
      initiatives: [init],
      execution_items: [
        ...Array(4).fill({ initiative_id: 'i1', status: 'completed' }),
        ...Array(2).fill({ initiative_id: 'i1', status: 'skipped' }),
        ...Array(2).fill({ initiative_id: 'i1', status: 'pending' }),
        ...Array(2).fill({ initiative_id: 'i1', status: 'in_progress' }),
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.perInitiative[0].completionPct).toBe(50)
    expect(result?.aggregateCompletionPct).toBe(50)
    expect(result?.totalSkipped).toBe(2)
  })

  it('returns completionPct=null when initiative has 0 actions (no NaN)', async () => {
    const init = makeInit({ id: 'i1' })
    const sb = buildSupabase({ initiatives: [init], execution_items: [] })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.perInitiative[0].completionPct).toBeNull()
    expect(result?.aggregateCompletionPct).toBeNull()
  })

  it('returns completionPct=null when all actions are skipped (denom=0)', async () => {
    // edge case: denom must avoid div by zero when all actions skipped
    const init = makeInit({ id: 'i1' })
    const sb = buildSupabase({
      initiatives: [init],
      execution_items: [
        { initiative_id: 'i1', status: 'skipped' },
        { initiative_id: 'i1', status: 'skipped' },
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.perInitiative[0].completionPct).toBeNull()
  })

  it('filters dead campaign IDs (rows missing from campaign_briefs)', async () => {
    // Initiative says it links 3 campaigns but only 2 exist in campaign_briefs
    const init = makeInit({
      id: 'i1',
      campaign_ids: ['c-alive-1', 'c-dead', 'c-alive-2'],
    })
    const sb = buildSupabase({
      initiatives: [init],
      execution_items: [],
      campaign_briefs: [
        { id: 'c-alive-1', status: 'active' },
        { id: 'c-alive-2', status: 'paused' },
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.perInitiative[0].campaignCount).toBe(2)        // not 3
    expect(result?.totalCampaigns).toBe(2)
  })

  it('counts paused/draft/completed campaigns in totals (does not drop them)', async () => {
    // The bug 子牙 caught in InitiativeExecutionPanel — paused campaigns linked
    // to the Initiative must STILL count in the M4 summary
    const init = makeInit({
      id: 'i1',
      campaign_ids: ['c-active', 'c-paused', 'c-draft', 'c-completed'],
    })
    const sb = buildSupabase({
      initiatives: [init],
      execution_items: [],
      campaign_briefs: [
        { id: 'c-active', status: 'active' },
        { id: 'c-paused', status: 'paused' },
        { id: 'c-draft', status: 'draft' },
        { id: 'c-completed', status: 'completed' },
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.perInitiative[0].campaignCount).toBe(4)
    expect(result?.perInitiative[0].campaignStatusCounts).toEqual({
      active: 1,
      paused: 1,
      draft: 1,
      completed: 1,
    })
  })

  it('deduplicates campaigns linked to multiple initiatives in totalCampaigns', async () => {
    // Same campaign linked to both initiatives — should count once at Goal level
    const i1 = makeInit({ id: 'i1', campaign_ids: ['c-shared', 'c-only-1'] })
    const i2 = makeInit({ id: 'i2', campaign_ids: ['c-shared', 'c-only-2'] })
    const sb = buildSupabase({
      initiatives: [i1, i2],
      execution_items: [],
      campaign_briefs: [
        { id: 'c-shared', status: 'active' },
        { id: 'c-only-1', status: 'active' },
        { id: 'c-only-2', status: 'active' },
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    // per-initiative still counts shared in each
    expect(result?.perInitiative[0].campaignCount).toBe(2)
    expect(result?.perInitiative[1].campaignCount).toBe(2)
    // but goal-level is deduped
    expect(result?.totalCampaigns).toBe(3)
  })

  it('aggregates totals across initiatives correctly', async () => {
    const i1 = makeInit({ id: 'i1' })
    const i2 = makeInit({ id: 'i2' })
    const sb = buildSupabase({
      initiatives: [i1, i2],
      execution_items: [
        { initiative_id: 'i1', status: 'completed' },
        { initiative_id: 'i1', status: 'pending' },
        { initiative_id: 'i2', status: 'completed' },
        { initiative_id: 'i2', status: 'completed' },
        { initiative_id: 'i2', status: 'in_progress' },
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.initiativeCount).toBe(2)
    expect(result?.totalActions).toBe(5)
    expect(result?.totalCompleted).toBe(3)
    expect(result?.totalInProgress).toBe(1)
    expect(result?.totalPending).toBe(1)
    expect(result?.aggregateCompletionPct).toBe(60)  // 3 / 5 = 60%
  })

  it('rounds completion percentage to integer', async () => {
    // 1 completed of 3 actions = 33.33% → 33
    const init = makeInit({ id: 'i1' })
    const sb = buildSupabase({
      initiatives: [init],
      execution_items: [
        { initiative_id: 'i1', status: 'completed' },
        { initiative_id: 'i1', status: 'pending' },
        { initiative_id: 'i1', status: 'pending' },
      ],
    })
    const result = await getExecutionSummaryForGoal(sb, GOAL_ID)
    expect(result?.perInitiative[0].completionPct).toBe(33)
  })
})

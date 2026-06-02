import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { createInitiative, updateInitiative } from '../initiatives'
import type { GoalRow, InitiativeRow } from '@/types/strategy'

const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT_ID = 'client-1'
const GOAL_ID = 'goal-1'

function makeGoal(
  overrides: Partial<Pick<GoalRow, 'id' | 'client_id' | 'status' | 'budget_amount'>> = {},
): Pick<GoalRow, 'id' | 'client_id' | 'status' | 'budget_amount'> {
  return {
    id: GOAL_ID,
    client_id: CLIENT_ID,
    status: 'active',
    budget_amount: 10000,
    ...overrides,
  }
}

function makeInitiative(overrides: Partial<InitiativeRow> = {}): InitiativeRow {
  return {
    id: 'initiative-1',
    goal_id: GOAL_ID,
    client_id: CLIENT_ID,
    initiative_type: 'demand_generation',
    tier: 'terminal',
    title: 'Terminal initiative',
    posture: 'offensive',
    budget_percent: 50,
    budget_amount: 5000,
    hypothesis: 'If we do X, Y happens.',
    hypothesis_polished_by_ai: false,
    supports_initiative_id: null,
    campaign_ids: [],
    is_archived: false,
    sort_order: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

interface StrategyMockConfig {
  goal?: Pick<GoalRow, 'id' | 'client_id' | 'status' | 'budget_amount'> | null
  initiativesById?: Record<string, InitiativeRow | null>
  updateResult?: InitiativeRow | null
}

function makeChain(table: string, config: StrategyMockConfig) {
  let operation: 'select' | 'insert' | 'update' | null = null
  const filters: Record<string, string | number | boolean | null> = {}

  const chain = {
    select: vi.fn(() => {
      if (operation === null) operation = 'select'
      return chain
    }),
    eq: vi.fn((column: string, value: string | number | boolean | null) => {
      filters[column] = value
      return chain
    }),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    insert: vi.fn(() => {
      operation = 'insert'
      return chain
    }),
    update: vi.fn(() => {
      operation = 'update'
      return chain
    }),
    maybeSingle: vi.fn(async () => {
      if (table === 'goals' && operation === 'select' && typeof filters.id === 'string') {
        return {
          data: config.goal?.id === filters.id ? config.goal : null,
          error: null,
        }
      }

      if (table === 'initiatives' && operation === 'select' && typeof filters.id === 'string') {
        return {
          data: config.initiativesById?.[filters.id] ?? null,
          error: null,
        }
      }

      return { data: null, error: null }
    }),
    single: vi.fn(async () => {
      if (operation === 'insert' || operation === 'update') {
        return { data: config.updateResult ?? null, error: null }
      }
      return { data: null, error: null }
    }),
  }

  return chain
}

function useStrategyMock(config: StrategyMockConfig) {
  mockFrom.mockImplementation((table: string) => makeChain(table, config) as unknown as ReturnType<typeof supabaseAdmin.from>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createInitiative', () => {
  it('rejects terminal initiatives that try to declare supports_initiative_id', async () => {
    useStrategyMock({ goal: makeGoal() })

    const result = await createInitiative(supabaseAdmin, {
      goal_id: GOAL_ID,
      initiative_type: 'demand_generation',
      title: 'Terminal with parent',
      budget_percent: 10,
      supports_initiative_id: 'initiative-parent',
    })

    expect(result).toEqual({
      ok: false,
      error: 'Terminal initiative cannot specify supports_initiative_id',
    })
  })
})

describe('updateInitiative', () => {
  it('rejects patching a terminal initiative with a parent', async () => {
    useStrategyMock({
      initiativesById: {
        'initiative-1': makeInitiative({
          tier: 'terminal',
          supports_initiative_id: null,
        }),
      },
      updateResult: makeInitiative({
        tier: 'terminal',
        supports_initiative_id: 'some-id',
      }),
    })

    const result = await updateInitiative(supabaseAdmin, 'initiative-1', {
      supports_initiative_id: 'some-id',
    })

    expect(result).toEqual({
      ok: false,
      error: 'Terminal initiative cannot specify supports_initiative_id',
    })
  })

  it('rejects clearing supports_initiative_id on a supporting initiative', async () => {
    useStrategyMock({
      initiativesById: {
        'initiative-1': makeInitiative({
          initiative_type: 'content_asset_production',
          tier: 'supporting',
          supports_initiative_id: 'terminal-1',
        }),
      },
      updateResult: makeInitiative({
        initiative_type: 'content_asset_production',
        tier: 'supporting',
        supports_initiative_id: null,
      }),
    })

    const result = await updateInitiative(supabaseAdmin, 'initiative-1', {
      supports_initiative_id: null,
    })

    expect(result).toEqual({
      ok: false,
      error: 'Supporting initiative must specify supports_initiative_id (a terminal initiative)',
    })
  })

  it('allows unassigned supporting initiatives to clear their parent', async () => {
    useStrategyMock({
      initiativesById: {
        'initiative-1': makeInitiative({
          initiative_type: 'unassigned',
          tier: 'supporting',
          supports_initiative_id: 'terminal-1',
        }),
      },
      updateResult: makeInitiative({
        initiative_type: 'unassigned',
        tier: 'supporting',
        supports_initiative_id: null,
      }),
    })

    const result = await updateInitiative(supabaseAdmin, 'initiative-1', {
      supports_initiative_id: null,
    })

    expect(result).toEqual({
      ok: true,
      initiative: makeInitiative({
        initiative_type: 'unassigned',
        tier: 'supporting',
        supports_initiative_id: null,
      }),
    })
  })

  it('rejects PATCH updates that point at a non-terminal parent', async () => {
    useStrategyMock({
      initiativesById: {
        'initiative-1': makeInitiative({
          initiative_type: 'content_asset_production',
          tier: 'supporting',
          supports_initiative_id: 'terminal-1',
        }),
        'other-id': makeInitiative({
          id: 'other-id',
          goal_id: GOAL_ID,
          initiative_type: 'content_asset_production',
          tier: 'supporting',
          title: 'Supporting parent',
        }),
      },
      updateResult: makeInitiative({
        initiative_type: 'content_asset_production',
        tier: 'supporting',
        supports_initiative_id: 'other-id',
      }),
    })

    const result = await updateInitiative(supabaseAdmin, 'initiative-1', {
      supports_initiative_id: 'other-id',
    })

    expect(result).toEqual({
      ok: false,
      error: 'supports_initiative_id must be a terminal initiative',
    })
  })

  it('rejects PATCH updates whose parent belongs to a different goal', async () => {
    useStrategyMock({
      initiativesById: {
        'initiative-1': makeInitiative({
          initiative_type: 'content_asset_production',
          tier: 'supporting',
          supports_initiative_id: 'terminal-1',
        }),
        'other-id': makeInitiative({
          id: 'other-id',
          goal_id: 'goal-B',
          initiative_type: 'demand_generation',
          tier: 'terminal',
          title: 'Terminal from another goal',
        }),
      },
      updateResult: makeInitiative({
        initiative_type: 'content_asset_production',
        tier: 'supporting',
        supports_initiative_id: 'other-id',
      }),
    })

    const result = await updateInitiative(supabaseAdmin, 'initiative-1', {
      supports_initiative_id: 'other-id',
    })

    expect(result).toEqual({
      ok: false,
      error: 'supports_initiative_id must belong to the same goal',
    })
  })
})

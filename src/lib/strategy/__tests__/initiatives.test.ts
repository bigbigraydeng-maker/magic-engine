import { describe, it, expect, vi, beforeEach } from 'vitest'

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

function makeGoal(overrides: Partial<GoalRow> = {}): Pick<GoalRow, 'id' | 'client_id' | 'status' | 'budget_amount'> {
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
    is_archived: false,
    sort_order: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function chainWithResult<T>(result: T) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    single: vi.fn(),
  }

  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.maybeSingle.mockResolvedValue({ data: result, error: null })
  chain.single.mockResolvedValue({ data: result, error: null })

  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createInitiative', () => {
  it('rejects terminal initiatives that try to declare supports_initiative_id', async () => {
    const goalChain = chainWithResult(makeGoal())
    mockFrom.mockReturnValue(goalChain as unknown as ReturnType<typeof supabaseAdmin.from>)

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
  it('rejects clearing supports_initiative_id on a supporting initiative', async () => {
    const existingChain = chainWithResult(makeInitiative({
      initiative_type: 'content_asset_production',
      tier: 'supporting',
      supports_initiative_id: 'terminal-1',
    }))
    mockFrom.mockReturnValue(existingChain as unknown as ReturnType<typeof supabaseAdmin.from>)

    const result = await updateInitiative(supabaseAdmin, 'initiative-1', {
      supports_initiative_id: null,
    })

    expect(result).toEqual({
      ok: false,
      error: 'Supporting initiative must specify supports_initiative_id (a terminal initiative)',
    })
  })
})

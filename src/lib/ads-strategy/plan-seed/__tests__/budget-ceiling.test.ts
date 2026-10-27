import { describe, expect, it } from 'vitest'
import type { PromoSpec } from '@/lib/marketing-plan/promo/spec'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import { seedBudgetProblems } from '@/lib/ads-strategy/plan-seed/budget-ceiling'

const basis = { label: 'label', value: 'value', source: 'source', as_of: null }

function spec(cents: number, account = 'act_1'): PromoSpec {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [{
      id: 'p1',
      name: '阶段',
      start_date: '2026-11-01',
      end_date: '2026-11-14',
      steps: [{
        id: 's1',
        kind: 'ads_campaign',
        settings: {
          ad_account_id: account,
          daily_budget_cents: cents,
          audience_ref: 'aud',
          creative_refs: [],
          placements: [],
          paused_ranges: [],
        },
      }],
    }],
    checks: [],
  }
}

function seed(account: string, cents: number): PlanSeed {
  const field = <T extends string | number>(value: T) => ({ ok: true as const, value, basis: [basis], notes: [] as string[] })
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: '2026-10-27T00:00:00.000Z',
    currency: 'AUD',
    period: null,
    captured_at: {},
    ad_steps: [{
      step_key: 's1',
      play: 'thruplay_pool_build',
      page_id: field('page'),
      ad_account_id: field(account),
      daily_budget_cents: field(cents),
    }],
    skipped: [],
    notes: [],
  }
}

describe('seedBudgetProblems', () => {
  it('allows a budget equal to the suggestion', () => {
    expect(seedBudgetProblems(spec(5000), seed('act_1', 5000))).toEqual([])
  })

  it('rejects a budget above the suggestion and an account the suggestion does not name', () => {
    expect(seedBudgetProblems(spec(5001), seed('act_1', 5000)).join('')).toContain('超过建议')
    expect(seedBudgetProblems(spec(1000, 'act_other'), seed('act_1', 5000)).join('')).toContain('不在这次建议里')
  })

  it('rejects ad budget when the prescription has no suggestion', () => {
    expect(seedBudgetProblems(spec(1000), null).join('')).toContain('没有可用的预算建议')
  })
})

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FILL_PLAN_DAILY_CAP,
  agreedPlanDailyTotalCap,
  readClientDailyTotalCap,
} from '../plan-cap'

function plan(cents: number | null, status = 'approved') {
  const promo: { daily_total_cap_cents?: number } = {}
  if (cents !== null) promo.daily_total_cap_cents = cents
  return { status, plan_data: { promo } }
}

describe('agreedPlanDailyTotalCap', () => {
  it('uses the one approved promo plan', () => {
    expect(agreedPlanDailyTotalCap([plan(4_000)])).toEqual({ state: 'set', cents: 4_000 })
  })

  it('ignores a non-promo plan and a draft', () => {
    const rows = [
      { status: 'approved', plan_data: { seo: true } },
      plan(4_000, 'draft'),
      plan(4_000),
    ]
    expect(agreedPlanDailyTotalCap(rows)).toEqual({ state: 'set', cents: 4_000 })
  })

  it('is missing when the plan has no cap, even if another column would have a number', () => {
    expect(agreedPlanDailyTotalCap([plan(null)])).toEqual({ state: 'missing', reason: FILL_PLAN_DAILY_CAP })
  })

  it('does not pick when two approved plans disagree', () => {
    const result = agreedPlanDailyTotalCap([plan(4_000), plan(9_000)])
    expect(result.state).toBe('missing')
    if (result.state === 'missing') expect(result.reason).toContain('不一致')
  })

  it('is missing when one approved plan omitted the cap', () => {
    expect(agreedPlanDailyTotalCap([plan(4_000), plan(null)]).state).toBe('missing')
  })

  it('uses the number when every approved promo plan says the same', () => {
    expect(agreedPlanDailyTotalCap([plan(4_000), plan(4_000)])).toEqual({ state: 'set', cents: 4_000 })
  })
})

describe('readClientDailyTotalCap', () => {
  it('does not turn a failed read into missing', async () => {
    const sb = {
      from() {
        return {
          select() { return this },
          eq() { return this },
          then(resolve: (value: { data: null; error: { message: string } }) => unknown) {
            return Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve)
          },
        }
      },
    }
    const result = await readClientDailyTotalCap(sb as unknown as SupabaseClient, 'client-1')
    expect(result.state).toBe('unreadable')
  })
})

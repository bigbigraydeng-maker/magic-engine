import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  accounts: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/strategy/goals', () => ({ listGoalsForClient: mocks.list }))
vi.mock('@/lib/marketing-plan/promo/facts', () => ({ loadOwnedAccounts: mocks.accounts }))

import { loadPromoOptions } from '../options'

beforeEach(() => {
  mocks.list.mockReset()
  mocks.accounts.mockReset()
  mocks.accounts.mockResolvedValue([])
})

describe('推广计划的目标下拉', () => {
  it('草稿和进行中都能选，过期的不进列表', async () => {
    mocks.list.mockResolvedValue([
      { id: 'g-draft', title: '草稿目标', status: 'draft', period_start: '2026-10-25', period_end: '2026-11-30' },
      { id: 'g-live', title: '进行中目标', status: 'active', period_start: '2026-10-01', period_end: '2026-10-31' },
      { id: 'g-old', title: '过期目标', status: 'expired', period_start: '2026-01-01', period_end: '2026-01-31' },
    ])
    const options = await loadPromoOptions('client-1')
    expect(mocks.list).toHaveBeenCalledWith(expect.anything(), 'client-1', { statuses: ['draft', 'active'] })
    expect(options.goals.map(goal => goal.id)).toEqual(['g-draft', 'g-live'])
    expect(options.goals.map(goal => goal.status)).toEqual(['draft', 'active'])
  })
})

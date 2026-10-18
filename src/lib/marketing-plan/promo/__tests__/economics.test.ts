import { describe, expect, it } from 'vitest'
import { businessCaseMath } from '../economics'

const BC = {
  departure_ref: 'dep-1',
  seats_remaining: 12,
  seats_confirmed: true,
  seats_as_of: '2026-11-01',
  retained_per_seat_cents: 50000,
  retention_basis: ['commission' as const],
  pax_per_booking: 2,
  lead_to_booking_rate: 0.03,
  rate_source: 'measured' as const,
  rate_sample_n: 200,
  creative_gap_note: '',
  owner: 'fde@example.com',
}

describe('businessCaseMath', () => {
  it('没填卡 → 三项都是未知', () => {
    const math = businessCaseMath(undefined, 1000)
    expect(math.retained_per_booking_cents).toBeNull()
    expect(math.acceptable_lead_cost_cents).toBeNull()
    expect(math.breakeven_rate).toBeNull()
  })

  it('按口径算：每座留存 × 每单几座 × 成交率', () => {
    const math = businessCaseMath(BC, null)
    expect(math.retained_per_booking_cents).toBe(100000)
    expect(math.acceptable_lead_cost_cents).toBe(3000)
  })

  it('小数每单座数也算得对', () => {
    const math = businessCaseMath(
      { ...BC, pax_per_booking: 1.74, retained_per_seat_cents: 50000, lead_to_booking_rate: 0.026 },
      null,
    )
    expect(math.retained_per_booking_cents).toBe(87000)
    expect(math.acceptable_lead_cost_cents).toBe(2262)
  })

  it('没有实际线索成本 → 保本成交率是未知', () => {
    expect(businessCaseMath(BC, null).breakeven_rate).toBeNull()
  })

  it('有实际线索成本 → 算得出保本成交率', () => {
    expect(businessCaseMath(BC, 2000).breakeven_rate).toBe(0.02)
  })

  it('实际线索成本为 0 → 未知，不是 0', () => {
    expect(businessCaseMath(BC, 0).breakeven_rate).toBeNull()
  })

  it('成交率为 0 → 可承受成本是未知，不是 0', () => {
    expect(businessCaseMath({ ...BC, lead_to_booking_rate: 0 }, null).acceptable_lead_cost_cents).toBeNull()
  })

  it('每单座数为 0 → 两项都是未知', () => {
    const math = businessCaseMath({ ...BC, pax_per_booking: 0 }, null)
    expect(math.retained_per_booking_cents).toBeNull()
    expect(math.acceptable_lead_cost_cents).toBeNull()
  })
})

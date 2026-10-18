import { describe, expect, it } from 'vitest'
import { promoContentHash } from '../content-hash'
import { businessCaseMath } from '../economics'
import { setIsExperiment } from '../form'
import type { BusinessCase, PromoSpec } from '../spec'

const BC: BusinessCase = {
  departure_ref: 'dep-1',
  seats_remaining: 12,
  seats_confirmed: true,
  seats_as_of: '2026-11-01',
  retained_per_seat_cents: 50000,
  retention_basis: ['commission'],
  pax_per_booking: 2,
  lead_to_booking_rate: 0.03,
  rate_source: 'measured',
  rate_sample_n: 200,
  creative_gap_note: '',
  owner: 'fde@example.com',
}

function spec(businessCase?: BusinessCase): PromoSpec {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [{
      id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14',
      steps: [], business_case: businessCase,
    }],
    checks: [],
  }
}

describe('剩余座位不进内容指纹', () => {
  it('改座位数，指纹不变', () => {
    expect(promoContentHash(spec({ ...BC, seats_remaining: 7 }))).toBe(
      promoContentHash(spec(BC)),
    )
  })

  it('改「客户确认过了吗」，指纹不变', () => {
    expect(promoContentHash(spec({ ...BC, seats_confirmed: false }))).toBe(
      promoContentHash(spec(BC)),
    )
  })

  it('改座位数的取数日期，指纹不变', () => {
    expect(promoContentHash(spec({ ...BC, seats_as_of: '2026-12-01' }))).toBe(
      promoContentHash(spec(BC)),
    )
  })

  it('改每座留存，指纹要变', () => {
    expect(promoContentHash(spec({ ...BC, retained_per_seat_cents: 60000 }))).not.toBe(
      promoContentHash(spec(BC)),
    )
  })

  it('改负责人，指纹要变', () => {
    expect(promoContentHash(spec({ ...BC, owner: 'x@example.com' }))).not.toBe(
      promoContentHash(spec(BC)),
    )
  })

  it('没有经营判断卡的计划，指纹不受影响', () => {
    expect(promoContentHash(spec())).toBe(promoContentHash(spec()))
    expect(promoContentHash(spec())).not.toBe(promoContentHash(spec(BC)))
  })
})

describe('取消「这是一次实验」不留痕', () => {
  it('勾上再取消，指纹回到原样', () => {
    const before = promoContentHash(spec())
    const on = setIsExperiment(spec(), 'p1', true)
    const off = setIsExperiment(on, 'p1', false)
    expect(promoContentHash(off)).toBe(before)
  })

  it('取消之后这个键整个没了，不是 false', () => {
    const on = setIsExperiment(spec(), 'p1', true)
    const off = setIsExperiment(on, 'p1', false)
    expect('is_experiment' in off.phases[0]).toBe(false)
  })

  it('勾上时是 true', () => {
    expect(setIsExperiment(spec(), 'p1', true).phases[0].is_experiment).toBe(true)
  })

  it('只影响指定阶段', () => {
    const twoPhases: PromoSpec = {
      schema: 'promo_v1',
      goal_id: 'goal-1',
      phases: [
        {
          id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14',
          steps: [],
        },
        {
          id: 'p2', name: '阶段 2', start_date: '2026-11-15', end_date: '2026-11-30',
          steps: [],
        },
      ],
      checks: [],
    }
    const on = setIsExperiment(twoPhases, 'p1', true)
    expect('is_experiment' in on.phases[1]).toBe(false)
  })
})

describe('算不出来的一律是未知，不是 0', () => {
  it('每座留存乘每单座数溢出成无穷大 → 未知', () => {
    const huge = businessCaseMath(
      { ...BC, retained_per_seat_cents: Number.MAX_VALUE, pax_per_booking: Number.MAX_VALUE },
      1000,
    )
    expect(huge.retained_per_booking_cents).toBeNull()
    expect(huge.acceptable_lead_cost_cents).toBeNull()
    expect(huge.breakeven_rate).toBeNull()
  })

  it('每座留存是 NaN → 未知', () => {
    const math = businessCaseMath({ ...BC, retained_per_seat_cents: Number.NaN }, 1000)
    expect(math.retained_per_booking_cents).toBeNull()
    expect(math.acceptable_lead_cost_cents).toBeNull()
    expect(math.breakeven_rate).toBeNull()
  })

  it('每单座数是 NaN → 未知', () => {
    const math = businessCaseMath({ ...BC, pax_per_booking: Number.NaN }, 1000)
    expect(math.retained_per_booking_cents).toBeNull()
    expect(math.acceptable_lead_cost_cents).toBeNull()
    expect(math.breakeven_rate).toBeNull()
  })

  it('成交率是 NaN → 可承受成本未知', () => {
    const math = businessCaseMath({ ...BC, lead_to_booking_rate: Number.NaN }, 1000)
    expect(math.acceptable_lead_cost_cents).toBeNull()
    expect(math.retained_per_booking_cents).not.toBeNull()
  })

  it('实际线索成本是 NaN → 保本成交率未知', () => {
    expect(businessCaseMath(BC, Number.NaN).breakeven_rate).toBeNull()
  })
})

describe('防无穷大那一层（> 0 守卫拦不住的，必须由 finiteOrNull 拦）', () => {
  // 魏征 2026-10-18 复审：NaN 走 `> 0` 比较就已经是 false，根本到不了 finiteOrNull，
  // 所以只有「能通过 > 0 守卫、却算出非有限数」的值，才真正守着这一层。
  it('每座留存无穷大 → 每单留存未知', () => {
    const r = businessCaseMath({ ...BC, retained_per_seat_cents: Number.POSITIVE_INFINITY }, 1000)
    expect(r.retained_per_booking_cents).toBeNull()
    expect(r.acceptable_lead_cost_cents).toBeNull()
  })

  it('每单座数无穷大 → 每单留存未知', () => {
    const r = businessCaseMath({ ...BC, pax_per_booking: Number.POSITIVE_INFINITY }, 1000)
    expect(r.retained_per_booking_cents).toBeNull()
  })

  it('成交率无穷大 → 可承受成本未知，但每单留存照常算得出', () => {
    const r = businessCaseMath({ ...BC, lead_to_booking_rate: Number.POSITIVE_INFINITY }, null)
    expect(r.acceptable_lead_cost_cents).toBeNull()
    expect(r.retained_per_booking_cents).toBe(100000)
  })

  it('实际线索成本无穷大 → 保本成交率未知', () => {
    expect(businessCaseMath(BC, Number.POSITIVE_INFINITY).breakeven_rate).toBeNull()
  })
})


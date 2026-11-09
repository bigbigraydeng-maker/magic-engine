import { describe, expect, it } from 'vitest'
import { resolveTargetCplCents, resolveTargetCplMajor } from '../client-target-cpl'

const PLAN = (cents: number) => ({ plan_data: { promo: { target_cpl_cents: cents } } })

describe('resolveTargetCplCents', () => {
  it('reads the settings amount in major units', () => {
    expect(resolveTargetCplCents({ strategyMajor: 8 })).toBe(800)
    expect(resolveTargetCplCents({ strategyMajor: '8.50' })).toBe(850)
    expect(resolveTargetCplMajor({ strategyMajor: 8 })).toBe(8)
  })

  it('uses the approved plan when settings are empty', () => {
    expect(resolveTargetCplCents({ planRows: [PLAN(250)] })).toBe(250)
    expect(resolveTargetCplCents({ strategyMajor: 0, planRows: [PLAN(250)] })).toBe(250)
  })

  it('uses one number when settings and the plan agree', () => {
    expect(resolveTargetCplCents({ strategyMajor: 2.5, planRows: [PLAN(250)] })).toBe(250)
  })

  it('does not pick a side when the numbers differ', () => {
    const split = resolveTargetCplCents({
      strategyMajor: 8,
      leadsConfig: { ads_circuit_breaker: { target_cpl_cents: 100 } },
      planRows: [PLAN(250)],
    })
    expect(split).toBeNull()
    expect(resolveTargetCplCents({ strategyMajor: 8, planRows: [PLAN(250), PLAN(800)] })).toBeNull()
  })

  it('ignores a blank, zero, or unsafe amount', () => {
    expect(resolveTargetCplCents({})).toBeNull()
    expect(resolveTargetCplCents({ strategyMajor: -1 })).toBeNull()
    expect(resolveTargetCplCents({ leadsConfig: { ads_circuit_breaker: { target_cpl_cents: 0 } } })).toBeNull()
    expect(resolveTargetCplCents({ planRows: [{ plan_data: { promo: {} } }] })).toBeNull()
  })
})

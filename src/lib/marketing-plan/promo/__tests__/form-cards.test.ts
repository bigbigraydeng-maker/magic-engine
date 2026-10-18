import { describe, expect, it } from 'vitest'
import { parsePromoSpec, type PromoSpec } from '../spec'
import {
  newBusinessCase, newExperiment, newSalesHandover,
  percentToRate, rateToPercent,
  setBusinessCase, setExperiment, setSalesHandover, updatePhase,
} from '../form'

function base(): PromoSpec {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [
      { id: 'phase-1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14', steps: [] },
      { id: 'phase-2', name: '阶段 2', start_date: '2026-11-15', end_date: '2026-11-30', steps: [] },
    ],
    checks: [],
  }
}

describe('加卡、删卡', () => {
  it('加经营判断卡只影响指定的那个阶段', () => {
    const spec = setBusinessCase(base(), 'phase-1', newBusinessCase())
    expect(spec.phases[0].business_case).not.toBeUndefined()
    expect(spec.phases[1].business_case).toBeUndefined()
  })

  it('传 undefined 就是删掉这张卡', () => {
    const added = setBusinessCase(base(), 'phase-1', newBusinessCase())
    const removed = setBusinessCase(added, 'phase-1', undefined)
    expect(removed.phases[0].business_case).toBeUndefined()
  })

  it('加实验卡同理', () => {
    const spec = setExperiment(base(), 'phase-2', newExperiment())
    expect(spec.phases[1].experiment).not.toBeUndefined()
    expect(spec.phases[0].experiment).toBeUndefined()
  })

  it('销售承接是计划级的', () => {
    const added = setSalesHandover(base(), newSalesHandover())
    expect(added.sales_handover).not.toBeUndefined()
    const removed = setSalesHandover(added, undefined)
    expect(removed.sales_handover).toBeUndefined()
  })

  it('改阶段时不碰别的阶段', () => {
    const spec = updatePhase(base(), 'phase-1', { is_experiment: true })
    expect(spec.phases[0].is_experiment).toBe(true)
    expect(spec.phases[1].is_experiment).toBeUndefined()
  })
})

describe('空白卡一定过不了保存校验', () => {
  it('空白经营判断卡会被拒', () => {
    const r = parsePromoSpec(setBusinessCase(base(), 'phase-1', newBusinessCase()))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('空白实验卡会被拒', () => {
    const r = parsePromoSpec(setExperiment(base(), 'phase-1', newExperiment()))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('空白销售承接会被拒', () => {
    const r = parsePromoSpec(setSalesHandover(base(), newSalesHandover()))
    if (r.ok) throw new Error('应该被拒')
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('什么卡都不加 → 能过', () => {
    const r = parsePromoSpec(base())
    if (!r.ok) throw new Error('应该通过')
    expect(r.spec.phases).toHaveLength(2)
  })
})

describe('百分数和小数互转', () => {
  it('填 2.6 就是 2.6%', () => {
    expect(percentToRate('2.6')).toBeCloseTo(0.026, 6)
  })

  it('空的、负的、非数字都当 0', () => {
    expect(percentToRate('')).toBe(0)
    expect(percentToRate('-1')).toBe(0)
    expect(percentToRate('abc')).toBe(0)
  })

  it('小数转回百分数', () => {
    expect(rateToPercent(0.026)).toBe('2.6')
  })

  it('0 或非法转成空字符串', () => {
    expect(rateToPercent(0)).toBe('')
  })

  it('来回转不会走样', () => {
    expect(rateToPercent(percentToRate('3.25'))).toBe('3.25')
  })
})

import { describe, it, expect } from 'vitest'
import {
  planBudgetChange,
  validateReduceTarget,
  B04_MIN_HOURS,
  NOT_CHECKED_RULES,
  type BudgetChangeFacts,
} from '../plan'

const NOW = new Date('2026-11-04T00:00:00.000Z')
const HOUR_MS = 3_600_000

function isoHoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString()
}

const base: BudgetChangeFacts = {
  currentCents: 10000,
  currency: 'NZD',
  metaUpdatedTime: isoHoursAgo(100),
  now: NOW,
  scaleBlockedReason: null,
  envelope: {
    up10: { within: true, reasons: [] },
    up20: { within: true, reasons: [] },
  },
  envelopeUnavailable: null,
  clientDailyCapCents: 50000,
  clientDailyTotalCents: 30000,
}

describe('planBudgetChange', () => {
  it('base: 全部可加可减，cap 余量、小时数、未核对清单正确', () => {
    const plan = planBudgetChange(base)
    expect(plan.up10.allowed).toBe(true)
    expect(plan.up10.afterCents).toBe(11000)
    expect(plan.up20.allowed).toBe(true)
    expect(plan.up20.afterCents).toBe(12000)
    expect(plan.reduce.allowed).toBe(true)
    expect(plan.reduce.minAfterCents).toBe(8000)
    expect(plan.reduce.maxAfterCents).toBe(9999)
    expect(plan.capHeadroomCents).toBe(20000)
    expect(plan.hoursSinceMetaUpdate).toBe(100)
    expect(plan.notChecked).toEqual(NOT_CHECKED_RULES)
  })

  it('Meta 10 小时前改过：不能加，但还能减', () => {
    const plan = planBudgetChange({ ...base, metaUpdatedTime: isoHoursAgo(10) })
    expect(plan.up10.allowed).toBe(false)
    expect(plan.up20.allowed).toBe(false)
    expect(plan.up10.reasons[0]).toContain('10 小时前')
    expect(plan.up20.reasons[0]).toContain('10 小时前')
    expect(plan.reduce.allowed).toBe(true)
  })

  it('Meta 恰好 72 小时前改过：可以加', () => {
    const plan = planBudgetChange({ ...base, metaUpdatedTime: isoHoursAgo(B04_MIN_HOURS) })
    expect(plan.up10.allowed).toBe(true)
  })

  it('读不到 Meta 修改时间：不能加，但还能减', () => {
    const plan = planBudgetChange({ ...base, metaUpdatedTime: null })
    expect(plan.up10.allowed).toBe(false)
    expect(plan.up20.allowed).toBe(false)
    expect(plan.up10.reasons[0]).toContain('读不到 Meta')
    expect(plan.reduce.allowed).toBe(true)
  })

  it('结构上不能加：原因原样出现在第一条', () => {
    const plan = planBudgetChange({ ...base, scaleBlockedReason: '系列下还有别的在投组' })
    expect(plan.up10.allowed).toBe(false)
    expect(plan.up20.allowed).toBe(false)
    expect(plan.up10.reasons[0]).toBe('系列下还有别的在投组')
  })

  it('信封只拦 +20%：+10% 仍可加', () => {
    const plan = planBudgetChange({
      ...base,
      envelope: {
        up10: { within: true, reasons: [] },
        up20: { within: false, reasons: ['一次最多加 20%'] },
      },
    })
    expect(plan.up10.allowed).toBe(true)
    expect(plan.up20.allowed).toBe(false)
    expect(plan.up20.reasons).toContain('一次最多加 20%')
  })

  it('读不到信封事实：两个加都不能点，原因带出细节', () => {
    const plan = planBudgetChange({ ...base, envelopeUnavailable: 'facts:读不到日上限' })
    expect(plan.up10.allowed).toBe(false)
    expect(plan.up20.allowed).toBe(false)
    expect(plan.up10.reasons[0]).toContain('facts:读不到日上限')
    expect(plan.up20.reasons[0]).toContain('facts:读不到日上限')
  })

  it('读不到当前日预算：加和减都不能点', () => {
    const plan = planBudgetChange({ ...base, currentCents: null })
    expect(plan.up10.allowed).toBe(false)
    expect(plan.up20.allowed).toBe(false)
    expect(plan.reduce.allowed).toBe(false)
    expect(plan.up10.reasons).toContain('读不到当前日预算')
    expect(plan.reduce.reasons).toContain('读不到当前日预算')
  })

  it('预算太小（240 分）：不能减，但加仍可算', () => {
    const plan = planBudgetChange({ ...base, currentCents: 240 })
    expect(plan.reduce.allowed).toBe(false)
    expect(plan.reduce.minAfterCents).toBeNull()
    expect(plan.reduce.maxAfterCents).toBeNull()
    expect(plan.up10.afterCents).toBe(264)
    expect(plan.up20.afterCents).toBe(288)
  })

  it('读不到客户日上限：capHeadroomCents 为 null', () => {
    const plan = planBudgetChange({ ...base, clientDailyCapCents: null })
    expect(plan.capHeadroomCents).toBeNull()
  })
})

describe('validateReduceTarget', () => {
  const plan = planBudgetChange(base)

  it('8000 分：合法', () => {
    expect(validateReduceTarget(plan, 8000)).toEqual({ ok: true })
  })

  it('7999 分：低于 20% 下限', () => {
    const r = validateReduceTarget(plan, 7999)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('20%')
  })

  it('10000 分：没有比现在少', () => {
    const r = validateReduceTarget(plan, 10000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('要比现在少')
  })

  it('8500.5：不是整数分', () => {
    const r = validateReduceTarget(plan, 8500.5)
    expect(r.ok).toBe(false)
  })
})

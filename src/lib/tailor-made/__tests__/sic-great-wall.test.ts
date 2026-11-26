import { describe, it, expect } from 'vitest'
import { buildGreatWallSic } from '../sic-great-wall'
import { pickHeroName } from '../hero-rules'

describe('SIC-04 长城一日游', () => {
  const it0 = buildGreatWallSic('CTS-TEST-0001')

  it('类型是 SIC', () => {
    expect(it0.trip.productType).toBe('sic')
  })

  it('封面自动选长城图', () => {
    expect(pickHeroName(it0.trip)).toBe('great-wall')
  })

  it('不含价格、出发日期、儿童价', () => {
    const all = JSON.stringify(it0)
    expect(it0.pricing.amount).toBeNull()
    expect(it0.trip.dateRange).toBe('')
    expect(it0.days[0].date).toBe('')
    expect(all).not.toMatch(/RMB|700|500|Daily|under 12/i)
  })

  it('含/不含照产品册', () => {
    expect(it0.inclusions).toHaveLength(6)
    expect(it0.exclusions).toHaveLength(2)
  })
})

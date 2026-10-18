import { describe, expect, it } from 'vitest'

import {
  calculate,
  DEFAULT_INPUTS,
} from '@/lib/crm/industry/travel-business-calculator'

import {
  diffMetrics,
  formatMetric,
  INPUT_FIELDS,
  RESULT_METRICS,
} from '../format'

describe('INPUT_FIELDS', () => {
  it('has 13 unique keys, all present in DEFAULT_INPUTS', () => {
    expect(INPUT_FIELDS).toHaveLength(13)

    const keys = INPUT_FIELDS.map((field) => field.key)
    expect(new Set(keys).size).toBe(13)

    for (const key of keys) {
      expect(key in DEFAULT_INPUTS).toBe(true)
    }
  })
})

describe('RESULT_METRICS', () => {
  it('only references keys that exist on a calculated result', () => {
    const result = calculate(DEFAULT_INPUTS)

    for (const row of RESULT_METRICS) {
      expect(row.key in result).toBe(true)
    }
  })
})

describe('formatMetric', () => {
  it('formats money with thousands separators', () => {
    expect(formatMetric(2605714.28, 'money')).toContain('2,605,714')
  })

  it('shows 无法计算 for non-finite money', () => {
    expect(formatMetric(Infinity, 'money')).toBe('无法计算')
  })

  it('shows — for non-finite non-money values', () => {
    expect(formatMetric(NaN, 'count')).toBe('—')
  })

  it('keeps up to two decimals for people', () => {
    expect(formatMetric(1.68, 'people')).toBe('1.68')
  })

  it('does not force decimals for whole people values', () => {
    expect(formatMetric(720, 'people')).toBe('720')
  })

  it('formats percent with one decimal', () => {
    expect(formatMetric(0.05, 'percent')).toBe('5.0%')
  })
})

describe('diffMetrics', () => {
  it('rounds each side before subtracting', () => {
    const base = calculate(DEFAULT_INPUTS)
    const a = { ...base, profit: 100.4 }
    const b = { ...base, profit: 100.6 }

    const rows = diffMetrics(a, b)
    const profitRow = rows.find((row) => row.key === 'profit')

    expect(profitRow).toBeDefined()
    expect(profitRow?.a).toBe(100)
    expect(profitRow?.b).toBe(101)
    expect(profitRow?.diff).toBe(1)
  })

  it('returns a null diff when either side is not finite', () => {
    const base = calculate(DEFAULT_INPUTS)
    const a = { ...base, profit: Infinity }
    const b = { ...base, profit: 100 }

    const rows = diffMetrics(a, b)
    const profitRow = rows.find((row) => row.key === 'profit')

    expect(profitRow).toBeDefined()
    expect(profitRow?.diff).toBeNull()
  })
})

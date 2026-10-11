import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relTime } from '../contact-table-types'

describe('relTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 10, 6, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('same calendar day is 今天', () => {
    expect(relTime(new Date(2026, 9, 10, 2, 47).toISOString())).toBe('今天')
  })

  it('previous calendar day is 昨天 even when under 24 hours ago', () => {
    expect(relTime(new Date(2026, 9, 9, 23, 50).toISOString())).toBe('昨天')
    expect(relTime(new Date(2026, 9, 9, 6, 0).toISOString())).toBe('昨天')
  })

  it('counts calendar days for older dates', () => {
    expect(relTime(new Date(2026, 9, 8, 20, 37).toISOString())).toBe('2天前')
    expect(relTime(new Date(2026, 9, 7, 1, 0).toISOString())).toBe('3天前')
  })

  it('一年以内一律「N天前」，同一列不混两种写法（PM 2026-10-10）', () => {
    expect(relTime(new Date(2026, 8, 1, 12, 0).toISOString())).toBe('39天前')
    expect(relTime(new Date(2026, 6, 14, 12, 0).toISOString())).toBe('88天前')
  })

  it('超过一年才退回日期；null 给空串', () => {
    expect(relTime(new Date(2025, 8, 1, 12, 0).toISOString())).toMatch(/9\/1/)
    expect(relTime(null)).toBe('')
  })
})

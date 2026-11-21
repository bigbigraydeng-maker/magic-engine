import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../event-window'
import {
  conversionAgeLabel,
  conversionPastWindowNotice,
  conversionReviewWhat,
  displayCustomerFirst,
  pastEventWindowCutoffIso,
} from '../review-copy'

const NOW = new Date('2026-11-10T00:00:00Z')

describe('客人称呼跟核对页同一份', () => {
  it('名用首字母大写的全名，不用姓的缩写', () => {
    expect(displayCustomerFirst('maree')).toBe('Maree')
    expect(displayCustomerFirst('  maree  ')).toBe('Maree')
    expect(displayCustomerFirst(null)).toBeNull()
  })
})

describe('天数跟「能不能发」同一口径', () => {
  it('未满 1 天写今天，满了写取整的几天前', () => {
    const recent = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString()
    expect(conversionAgeLabel(recent, NOW)).toBe('今天')
    const two = new Date(NOW.getTime() - 2 * DAY_MS).toISOString()
    expect(conversionAgeLabel(two, NOW)).toBe('2 天前')
  })

  it('正好 7 天还没过窗口；过了 1 毫秒就是过期说明，不再只写「7 天前」', () => {
    const exact = new Date(NOW.getTime() - 7 * DAY_MS).toISOString()
    const justOver = new Date(NOW.getTime() - 7 * DAY_MS - 1).toISOString()
    const lead = {
      outcome_kind: 'lead' as const,
      customer_first: 'maree',
      amount_minor: null,
      currency: null,
      order_ref: null,
    }

    const still = conversionReviewWhat({ ...lead, occurred_at: exact }, NOW)
    expect(still.expired).toBe(false)
    expect(still.what).toContain('Maree')
    expect(still.what).toContain('7 天前')
    expect(still.what).not.toContain('已过去')

    const gone = conversionReviewWhat({ ...lead, occurred_at: justOver }, NOW)
    expect(gone.expired).toBe(true)
    expect(gone.what).toContain('Maree')
    expect(gone.what).toContain(conversionPastWindowNotice(7))
    expect(gone.what).not.toMatch(/7 天前来问过/)
    expect(gone.how).toContain('超过时限')
  })

  it('过期说明和核对页黄字是同一句', () => {
    expect(conversionPastWindowNotice(35)).toBe(
      '已过去 35 天，广告平台只收 7 天内的 —— 现在发也收不进去，选「不发送」即可。',
    )
  })
})

describe('列表分界', () => {
  it('正好 7 天的发生时间不小于分界，还能留在待核对里', () => {
    const cutoff = pastEventWindowCutoffIso(NOW)
    const exact = new Date(NOW.getTime() - 7 * DAY_MS).toISOString()
    expect(Date.parse(exact)).toBe(Date.parse(cutoff))
    expect(Date.parse(exact) < Date.parse(cutoff)).toBe(false)
  })
})

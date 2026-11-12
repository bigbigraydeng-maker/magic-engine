import { describe, expect, it } from 'vitest'
import { expiryBadgeText, touchesMetaAds } from '../card-display'

describe('card-display', () => {
  it('flags meta-touching cards from the what line', () => {
    expect(touchesMetaAds('记下要不要调每周预算')).toBe(false)
    expect(touchesMetaAds('暂停这个广告组')).toBe(true)
  })

  it('shows nz-day copy when the deadline ends at 23:59', () => {
    expect(expiryBadgeText('请在 11月10日 23:59（新西兰时间）前点。过了要重新出一张。')).toBe(
      '今天 23:59 前有效（新西兰时间）',
    )
  })

  it('shows urgent countdown copy for short windows', () => {
    const future = new Date(Date.now() + 18 * 60_000)
    const month = future.getMonth() + 1
    const day = future.getDate()
    const hour = future.getHours()
    const minute = future.getMinutes().toString().padStart(2, '0')
    const label = `请在 ${month}月${day}日 ${hour}:${minute}（新西兰时间）前点。过了要重新出一张。`
    expect(expiryBadgeText(label)).toMatch(/还剩 \d+ 分钟/)
  })
})

import { describe, expect, it } from 'vitest'
import { BRIEF_STALE_DAYS, briefAge } from '../brief-age'

// 新西兰夏令时（10 月最后一个周日起）= UTC+13。下面的「今天」都是 2026-10-27 NZ 日历日。
const NOW = new Date('2026-10-27T00:30:00Z') // NZ 10-27 13:30

describe('briefAge —— 按新西兰日历日算几天前', () => {
  it('今天生成', () => {
    expect(briefAge('2026-10-26T20:00:00Z', NOW)).toEqual({ label: '生成于 10月27日（今天）', stale: false })
  })

  it('🔴 昨晚 11 点（NZ）生成、今早看 → 昨天，不是 0 天前', () => {
    // NZ 10-26 23:00 = UTC 10-26 10:00，距 NOW 才 14.5 小时，但跨了日历日
    expect(briefAge('2026-10-26T10:00:00Z', NOW)).toEqual({ label: '生成于 10月26日（昨天）', stale: false })
  })

  it('2 天前：写天数，还不算过时', () => {
    expect(briefAge('2026-10-25T00:00:00Z', NOW)).toEqual({ label: '生成于 10月25日（2 天前）', stale: false })
  })

  it(`🔴 满 ${BRIEF_STALE_DAYS} 天算可能过时`, () => {
    const r = briefAge('2026-10-23T22:00:00Z', NOW) // NZ 10-24 → 3 天前
    expect(r?.label).toBe('生成于 10月24日（3 天前）')
    expect(r?.stale).toBe(true)
  })

  it('没有生成时间 / 读不懂 → null，卡上不写（不猜）', () => {
    expect(briefAge(null, NOW)).toBeNull()
    expect(briefAge(undefined, NOW)).toBeNull()
    expect(briefAge('', NOW)).toBeNull()
    expect(briefAge('不是时间', NOW)).toBeNull()
  })

  it('生成时间在未来（时钟对不上）→ null，不写「-1 天前」', () => {
    expect(briefAge('2026-10-29T00:00:00Z', NOW)).toBeNull()
  })

  it('接口真实返回的带毫秒、带 +00:00 的格式能读', () => {
    expect(briefAge('2026-10-26T10:11:40.905+00:00', NOW)?.label).toBe('生成于 10月26日（昨天）')
  })
})

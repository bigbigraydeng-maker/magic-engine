/**
 * 「建成预期」检查：建出来的是不是我们要的。
 * 每条规则都对应一类「看起来一切正常、其实不是」的静默错误。
 */
import { describe, it, expect } from 'vitest'
import { checkCreatedAsExpected, type CreatedExpectation, type CreatedReadback } from '../created-as-expected'

const EXP: CreatedExpectation = {
  optimizationGoal: 'CONVERSATIONS',
  destinationType: 'MESSENGER',
  adCount: 1,
  brandRedlines: [],
}

function got(over: Partial<CreatedReadback> = {}): CreatedReadback {
  return {
    campaignStatus: 'PAUSED',
    adSet: { id: 'as1', optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER', status: 'PAUSED' },
    ads: [{ adId: 'ad1', adName: 'DM ad', status: 'PAUSED', texts: ['Hello there'] }],
    ...over,
  }
}

const codes = (e: CreatedExpectation, g: CreatedReadback) => checkCreatedAsExpected(e, g).map((f) => f.code)

describe('checkCreatedAsExpected', () => {
  it('建成预期的样子 → 没有任何发现', () => {
    expect(checkCreatedAsExpected(EXP, got())).toEqual([])
  })

  it('状态大小写不敏感', () => {
    expect(codes(EXP, got({ campaignStatus: 'paused' }))).toEqual([])
  })

  it('全部发现都是 blocker', () => {
    const f = checkCreatedAsExpected(EXP, got({ campaignStatus: 'ACTIVE' }))
    expect(f.length).toBeGreaterThan(0)
    expect(f.every((x) => x.severity === 'blocker')).toBe(true)
  })
})

describe('not_paused — 「全程 PAUSED」要有回读证据', () => {
  it('系列是 ACTIVE → 拦', () => {
    expect(codes(EXP, got({ campaignStatus: 'ACTIVE' }))).toEqual(['not_paused'])
  })

  it('系列状态读不到(null) → 拦（读不到 ≠ 暂停着）', () => {
    const f = checkCreatedAsExpected(EXP, got({ campaignStatus: null }))
    expect(f.map((x) => x.code)).toEqual(['not_paused'])
    expect(f[0].message).toContain('读不到')
  })

  it('广告组是 ACTIVE / 缺失 → 拦', () => {
    const adSet = { id: 'as1', optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER' }
    expect(codes(EXP, got({ adSet: { ...adSet, status: 'ACTIVE' } }))).toEqual(['not_paused'])
    expect(codes(EXP, got({ adSet }))).toEqual(['not_paused'])
  })

  it('任意一条广告不是暂停 → 拦，并点名是哪条', () => {
    const f = checkCreatedAsExpected(EXP, got({
      ads: [{ adId: 'ad1', adName: 'good', status: 'PAUSED', texts: [] }, { adId: 'ad2', adName: 'bad one', status: 'ACTIVE', texts: [] }],
    }))
    const e2 = { ...EXP, adCount: 2 }
    const f2 = checkCreatedAsExpected(e2, got({
      ads: [{ adId: 'ad1', adName: 'good', status: 'PAUSED', texts: [] }, { adId: 'ad2', adName: 'bad one', status: 'ACTIVE', texts: [] }],
    }))
    expect(f.map((x) => x.code)).toContain('not_paused')
    expect(f2.find((x) => x.code === 'not_paused')?.message).toContain('bad one')
  })

  it('广告状态缺失 → 拦', () => {
    expect(codes(EXP, got({ ads: [{ adId: 'ad1', adName: 'x', texts: [] }] }))).toEqual(['not_paused'])
  })
})

describe('messaging_adset_mismatch — 名字叫私信，实际买别的', () => {
  it('目标不是 CONVERSATIONS → 拦', () => {
    const adSet = { id: 'as1', optimization_goal: 'LINK_CLICKS', destination_type: 'MESSENGER', status: 'PAUSED' }
    expect(codes(EXP, got({ adSet }))).toEqual(['messaging_adset_mismatch'])
  })

  it('落点不是 MESSENGER → 拦', () => {
    const adSet = { id: 'as1', optimization_goal: 'CONVERSATIONS', destination_type: 'WEBSITE', status: 'PAUSED' }
    expect(codes(EXP, got({ adSet }))).toEqual(['messaging_adset_mismatch'])
  })

  it('落点读不到 → 拦（缺失 ≠ 对）', () => {
    const adSet = { id: 'as1', optimization_goal: 'CONVERSATIONS', status: 'PAUSED' }
    const f = checkCreatedAsExpected(EXP, got({ adSet }))
    expect(f.map((x) => x.code)).toEqual(['messaging_adset_mismatch'])
    expect(f[0].message).toContain('读不到')
  })

  it('大小写不敏感', () => {
    const adSet = { id: 'as1', optimization_goal: 'conversations', destination_type: 'messenger', status: 'PAUSED' }
    expect(codes(EXP, got({ adSet }))).toEqual([])
  })
})

describe('ad_count_mismatch — 刚建完回读有最终一致性窗口', () => {
  it('建了 1 条回读到 0 条 → 拦（现有闸门对 0 条创意会放行）', () => {
    expect(codes(EXP, got({ ads: [] }))).toEqual(['ad_count_mismatch'])
  })

  it('建了 2 条回读到 1 条 → 拦', () => {
    expect(codes({ ...EXP, adCount: 2 }, got())).toEqual(['ad_count_mismatch'])
  })

  it('多出来的也拦', () => {
    const ads = [1, 2].map((n) => ({ adId: `ad${n}`, adName: `a${n}`, status: 'PAUSED', texts: [] }))
    expect(codes(EXP, got({ ads }))).toEqual(['ad_count_mismatch'])
  })
})

describe('brand_redline_in_readback — Meta 自己加的字要回读才看得见', () => {
  const E = { ...EXP, brandRedlines: ['founded in 1900'] }

  it('回读文案(含自动问候语)命中 → 拦', () => {
    const ads = [{ adId: 'ad1', adName: 'x', status: 'PAUSED', texts: ['Hi!', 'We were founded in １９００'] }]
    const f = checkCreatedAsExpected(E, got({ ads }))
    expect(f.map((x) => x.code)).toEqual(['brand_redline_in_readback'])
    expect(f[0].message).toContain('founded in 1900')
  })

  it('没命中 / 没配红线 → 不拦', () => {
    expect(codes(E, got())).toEqual([])
    expect(codes(EXP, got({ ads: [{ adId: 'ad1', adName: 'x', status: 'PAUSED', texts: ['founded in 1900'] }] }))).toEqual([])
  })
})

/**
 * 素材闸门的测试。
 *
 * PM 2026-08-05：「推广素材必须要严谨，不能随意更改」。
 * 这里守的是「严谨」那一半 —— 三条判据缺一不可，而且**不能互相顶替**。
 */
import { describe, it, expect } from 'vitest'
import {
  judgeAsset,
  pickUsableForListing,
  isVideoAsset,
  type AssetRow,
} from '../listing-asset-gate'

const LISTING = 'L1'

function asset(over: Partial<AssetRow> = {}): AssetRow {
  return {
    id: 'a1',
    clientId: 'c1',
    listingId: LISTING,
    source: 'client_verified',
    verifiedBy: 'fde@magiclab.co.nz',
    verifiedAt: '2026-08-05T00:00:00Z',
    archivedAt: null,
    mimeType: 'image/jpeg',
    storageUrl: 'https://x/1.jpg',
    ...over,
  }
}

describe('judgeAsset — 三条判据缺一不可', () => {
  it('三条都满足才可用', () => {
    expect(judgeAsset(asset(), LISTING).usable).toBe(true)
  })

  it('🔴 属于另一套房 → 拒（拿别的房子的画面卖这套 = 误导性广告）', () => {
    const v = judgeAsset(asset({ listingId: 'L2' }), LISTING)
    expect(v.usable).toBe(false)
    expect(v.reasons).toContain('wrong_listing')
    expect(v.why).toContain('误导')
  })

  it('🔴 同一个客户名下的另一套房也不行 —— 客户对了不代表房子对了', () => {
    expect(judgeAsset(asset({ clientId: 'c1', listingId: 'L2' }), LISTING).usable).toBe(false)
  })

  it('🔴 别的客户的素材 → 拒（用别人的照片卖房，最严重的那种误导）', () => {
    // 2026-08-05 魏征 P2-1：这个方向原来**零覆盖** —— judgeAsset 一次都没读过
    // asset.clientId，而上面那条测试之所以绿，是因为它测的是房源不同。
    const v = judgeAsset(asset({ clientId: 'OTHER' }), LISTING, 'c1')
    expect(v.usable).toBe(false)
    expect(v.reasons).toContain('wrong_client')
  })

  it('客户对得上就不报这条', () => {
    expect(judgeAsset(asset({ clientId: 'c1' }), LISTING, 'c1').usable).toBe(true)
  })

  it('不给客户就跳过这条检查（老调用方不受影响）', () => {
    expect(judgeAsset(asset({ clientId: 'OTHER' }), LISTING).reasons).not.toContain('wrong_client')
  })

  it('pickUsableForListing 把客户一路传下去', () => {
    const r = pickUsableForListing([asset({ id: 'x', clientId: 'OTHER' })], LISTING, 'c1')
    expect(r.usable).toHaveLength(0)
    expect(r.rejected[0].verdict.reasons).toContain('wrong_client')
  })

  it('没绑房源（老链接传的）→ 拒，且理由跟「绑错房」分开', () => {
    const v = judgeAsset(asset({ listingId: null }), LISTING)
    expect(v.reasons).toContain('no_listing')
    expect(v.reasons).not.toContain('wrong_listing')
  })

  it('🔴 AI 生成的 → 拒', () => {
    expect(judgeAsset(asset({ source: 'ai_generated' }), LISTING).reasons)
      .toContain('source_unusable')
  })

  it('🔴 图库素材 → 拒', () => {
    expect(judgeAsset(asset({ source: 'stock' }), LISTING).reasons)
      .toContain('source_unusable')
  })

  it('FDE 自己拍的 → 够硬', () => {
    expect(judgeAsset(asset({ source: 'fde_shot' }), LISTING).usable).toBe(true)
  })

  it('来源未知 → 拒（不知道来路一律不当真实画面）', () => {
    expect(judgeAsset(asset({ source: null }), LISTING).usable).toBe(false)
    expect(judgeAsset(asset({ source: 'unknown' }), LISTING).usable).toBe(false)
  })

  it('🔴 没人签字 → 拒。「客户传的」不等于「这套房实拍的」', () => {
    // 上传链接可以无限转发，客户完全可能从网上存一张再传进来。
    const v = judgeAsset(asset({ verifiedBy: null, verifiedAt: null }), LISTING)
    expect(v.reasons).toContain('not_verified')
  })

  it('只有时间没有签字人 → 仍然算没签（查不出是谁签的＝没法追责）', () => {
    expect(judgeAsset(asset({ verifiedBy: null }), LISTING).reasons).toContain('not_verified')
  })

  it('只有签字人没有时间 → 同样算没签', () => {
    expect(judgeAsset(asset({ verifiedAt: null }), LISTING).reasons).toContain('not_verified')
  })

  it('已归档 → 拒', () => {
    expect(judgeAsset(asset({ archivedAt: '2026-08-01T00:00:00Z' }), LISTING).reasons)
      .toContain('archived')
  })

  it('不通过的理由一次列全，不是撞到第一条就返回', () => {
    const v = judgeAsset(
      asset({ listingId: 'L2', source: 'ai_generated', verifiedBy: null, verifiedAt: null }),
      LISTING,
    )
    expect(v.reasons).toEqual(
      expect.arrayContaining(['wrong_listing', 'source_unusable']),
    )
  })

  it('三条判据不能互相顶替：签了字也救不了「是 AI 生成的」', () => {
    expect(judgeAsset(asset({ source: 'ai_generated' }), LISTING).usable).toBe(false)
  })

  it('三条判据不能互相顶替：客户传的也救不了「绑错房」', () => {
    expect(judgeAsset(asset({ source: 'client_verified', listingId: 'L2' }), LISTING).usable)
      .toBe(false)
  })
})

describe('pickUsableForListing — 被挡下的必须带理由，不能悄悄过滤', () => {
  it('挑出能用的，同时把不能用的连理由一起返回', () => {
    const r = pickUsableForListing(
      [asset({ id: 'ok' }), asset({ id: 'bad', source: 'ai_generated' })],
      LISTING,
    )
    expect(r.usable.map((a) => a.id)).toEqual(['ok'])
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].verdict.reasons).toContain('source_unusable')
  })

  it('🔴 「有素材但都不能用」和「一张都没传」必须说成两件事', () => {
    const noneUploaded = pickUsableForListing([], LISTING)
    const allRejected = pickUsableForListing([asset({ verifiedBy: null })], LISTING)

    expect(noneUploaded.summary).toContain('还没有任何素材')
    expect(allRejected.summary).toContain('不是没传')
    expect(allRejected.summary).not.toEqual(noneUploaded.summary)
  })

  it('有可用素材时也要说清还有几张没过关', () => {
    const r = pickUsableForListing([asset({ id: 'ok' }), asset({ id: 'x', archivedAt: 'now' })], LISTING)
    expect(r.summary).toContain('1 张可用')
    expect(r.summary).toContain('1 张不能用')
  })
})

describe('isVideoAsset', () => {
  it('按 mime 判，不按文件名', () => {
    expect(isVideoAsset(asset({ mimeType: 'video/mp4' }))).toBe(true)
    expect(isVideoAsset(asset({ mimeType: 'image/jpeg', storageUrl: 'https://x/a.mp4' }))).toBe(false)
  })

  it('mime 缺失当成非视频（宁可少当视频用）', () => {
    expect(isVideoAsset(asset({ mimeType: null }))).toBe(false)
  })
})

/**
 * 2026-08-05 魏征变异逃逸补测：5 条理由文案原来只有 1 条被断言过
 * （`wrong_listing` 的 `.toContain('误导')`）。把其余 4 条改成空字符串，测试全绿 ——
 * 而 UI 上唯一的解释就是 `verdict.why`，文案空了＝面板上那一栏空白，没人报警。
 */
describe('每条理由都必须真的说人话（逃逸补测）', () => {
  const CASES: [string, Partial<AssetRow>, string][] = [
    ['已归档', { archivedAt: '2026-08-01T00:00:00Z' }, '归档'],
    ['不属于这个客户', { clientId: 'OTHER' }, '不属于这个客户'],
    ['绑错房', { listingId: 'L2' }, '误导'],
    ['没绑房源', { listingId: null }, '哪套'],
    ['来源不行', { source: 'ai_generated' }, '换一张'],
    ['差签字', { source: 'client_provided' }, '点一下'],
  ]

  it.each(CASES)('「%s」的理由里必须有可读的说明', (_label, over, mustSay) => {
    const v = judgeAsset(asset(over), LISTING, 'c1')
    expect(v.usable).toBe(false)
    // 只要求「不是空的、不是一个字」——真正锁住文案的是下面那句关键词断言。
    expect(v.why.trim().length).toBeGreaterThan(3)
    expect(v.why).toContain(mustSay)
  })

  it('每条理由都要能显示成人话 —— 一条都不许是空的', () => {
    const all = judgeAsset(
      asset({ archivedAt: 'x', clientId: 'OTHER', listingId: null, source: 'stock' }),
      LISTING, 'c1',
    )
    // 每个理由码在 why 里都该有对应的一段，段数对得上
    expect(all.why.split('；').filter((x) => x.trim())).toHaveLength(all.reasons.length)
  })
})

describe('isVideoAsset 判据不能松（逃逸补测 M9）', () => {
  it('`startsWith` 不能改成 `includes` —— 否则 `image/video-thumb` 会被当视频', () => {
    expect(isVideoAsset(asset({ mimeType: 'image/video-thumbnail' }))).toBe(false)
    expect(isVideoAsset(asset({ mimeType: 'application/x-video' }))).toBe(false)
    expect(isVideoAsset(asset({ mimeType: 'video/quicktime' }))).toBe(true)
  })
})

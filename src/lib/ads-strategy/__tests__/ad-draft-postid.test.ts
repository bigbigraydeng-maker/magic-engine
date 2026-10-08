import { describe, it, expect } from 'vitest'
import { validateDraft, type AdDraft } from '../ad-draft'

function thruplayDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'video_thruplay',
    clientId: 'c1',
    campaignName: 'Kiteroa 养受众',
    adSetName: 'North Shore 买家',
    dailyBudget: 20,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: 'page1',
    creatives: [
      { name: 'Reel', primaryText: '', headline: '', postId: 'page1_123456' },
    ],
    ...over,
  }
}

const fields = (d: AdDraft) => validateDraft(d).map((x) => x.field)

describe('video_thruplay 用已发布的帖子当创意', () => {
  it('帖子编号合法 → 放行（帖子自带内容，不要求正文/标题/视频）', () => {
    expect(validateDraft(thruplayDraft())).toEqual([])
  })

  it('帖子编号不是这个主页的 → 拦', () => {
    expect(fields(thruplayDraft({
      creatives: [{ name: 'Reel', primaryText: '', headline: '', postId: 'other_123456' }],
    }))).toContain('creatives[0].postId')
  })

  it('帖子编号后半段不是数字 → 拦', () => {
    expect(fields(thruplayDraft({
      creatives: [{ name: 'Reel', primaryText: '', headline: '', postId: 'page1_abc' }],
    }))).toContain('creatives[0].postId')
  })

  it('帖子编号和视频素材同时给 → 拦', () => {
    expect(fields(thruplayDraft({
      creatives: [{ name: 'Reel', primaryText: '', headline: '', postId: 'page1_123456', videoId: 'v1' }],
    }))).toContain('creatives[0].postId')
  })

  it('留资类型用帖子 → 拦', () => {
    expect(fields(thruplayDraft({
      kind: 'lead_form',
      leadFormId: 'f1',
      creatives: [{ name: 'Reel', primaryText: '', headline: '', postId: 'page1_123456' }],
    }))).toContain('creatives[0].postId')
  })

  it('私信类型用帖子 → 拦', () => {
    expect(fields(thruplayDraft({
      kind: 'messenger_conversation',
      creatives: [{ name: 'Reel', primaryText: '', headline: '', postId: 'page1_123456', language: 'en' }],
    }))).toContain('creatives[0].postId')
  })

  it('帖子编号不是字符串 → 只报 creatives 形状问题', () => {
    const d = thruplayDraft({
      creatives: [{ name: 'x', primaryText: '', headline: '', postId: 123 as never }],
    })
    const p = validateDraft(d)
    expect(p).toHaveLength(1)
    expect(p[0].field).toBe('creatives')
  })
})

describe('没有 postId 时行为不变（回归）', () => {
  it('正文空 → 仍然报 creatives[0].primaryText', () => {
    expect(fields(thruplayDraft({
      creatives: [{ name: 'V', primaryText: '', headline: 'y', videoId: 'v1' }],
    }))).toContain('creatives[0].primaryText')
  })

  it('标题空 → 仍然报 creatives[0].headline', () => {
    expect(fields(thruplayDraft({
      creatives: [{ name: 'V', primaryText: 'x', headline: '', videoId: 'v1' }],
    }))).toContain('creatives[0].headline')
  })

  it('没给视频 → 仍然报 creatives[0].videoId', () => {
    expect(fields(thruplayDraft({
      creatives: [{ name: 'V', primaryText: 'x', headline: 'y' }],
    }))).toContain('creatives[0].videoId')
  })
})

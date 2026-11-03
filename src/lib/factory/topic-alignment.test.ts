import { describe, expect, it } from 'vitest'
import { officialWebsiteUrl, topicAlignmentGaps, type TopicAlignment } from './topic-alignment'

const now = new Date().toISOString()
const ready: TopicAlignment = {
  contentTitleSnapshot: 'China Streets at Night',
  videoFormat: 'short',
  primaryKeyword: 'china tours from nz',
  searchIntent: 'What does an evening street in China look like?',
  audienceMarket: 'New Zealand',
  googleEvidence: { status: 'observed', source: 'GSC', observedAt: now, dateRange: '2026-09-01 to 2026-10-01', market: 'NZ', finding: 'Site impressions', metricName: 'impressions', value: 1255 },
  youtubeEvidence: { status: 'observed', source: 'YouTube Studio', observedAt: now, dateRange: 'last 28 days', market: 'NZ', finding: 'Related search terms observed' },
  websiteUrl: 'https://www.ctstours.co.nz/china-tours-from-new-zealand',
  websiteTheme: 'China journeys from New Zealand',
  websiteCheck: { status: 'verified', url: 'https://www.ctstours.co.nz/china-tours-from-new-zealand', checkedAt: now, contentHash: 'abc' },
  promotionUrl: null,
  promotionCheck: { status: 'unverified' },
  promotionAlignment: 'not_applicable',
  promotionNote: 'No relevant live website promotion for this street topic',
  campaignBriefId: null,
  campaignSourceHash: null,
  adsAlignment: 'not_applicable',
  adsNote: 'No relevant active ad campaign for this street topic',
  socialPlanId: null,
  socialSourceHash: null,
  socialAlignment: 'not_applicable',
  socialNote: 'No related social plan for this editorial topic',
  contentPromise: 'Show three distinct street scenes',
}
const context = { title: ready.contentTitleSnapshot, keywords: ['china tours from nz'], campaignSourceHash: null, socialSourceHash: null }

describe('topic alignment gate', () => {
  it('accepts a sourced editorial topic with explicit no-campaign reasons', () => {
    expect(topicAlignmentGaps(ready, ['ctstours.co.nz'], context)).toEqual([])
  })

  it('blocks missing YouTube evidence, unrelated website and unknown ad alignment', () => {
    const gaps = topicAlignmentGaps({
      ...ready,
      youtubeEvidence: { status: 'not_collected' },
      websiteUrl: 'https://example.com/landing',
      adsAlignment: 'unknown',
    }, ['ctstours.co.nz'], context)
    expect(gaps).toContain('YouTube 选题证据未核')
    expect(gaps).toContain('官网承接页不属于已配置官网')
    expect(gaps).toContain('广告活动主题对应关系未核')
  })

  it('invalidates alignment when title or linked campaign changes', () => {
    const gaps = topicAlignmentGaps({ ...ready, adsAlignment: 'aligned', campaignBriefId: 'campaign-1', campaignSourceHash: 'old', adsNote: 'same theme' }, ['ctstours.co.nz'], {
      ...context, title: 'A Different Promise', campaignSourceHash: 'new',
    })
    expect(gaps).toContain('标题变更后尚未重新核对主题')
    expect(gaps).toContain('广告活动内容已变化，需重新核对')
  })

  it('requires a post linked to a campaign to check that same campaign', () => {
    expect(topicAlignmentGaps(ready, ['ctstours.co.nz'], { ...context, campaignId: 'campaign-1' }))
      .toContain('内容已关联广告活动，需核对同一活动')
  })

  it('keeps long videos and Shorts separate when the content has a fixed ratio', () => {
    expect(topicAlignmentGaps(ready, ['ctstours.co.nz'], { ...context, ratio: '16:9' }))
      .toContain('视频类型与内容画幅不一致')
  })

  it('never accepts a lookalike or non-https website', () => {
    expect(officialWebsiteUrl('https://ctstours.co.nz.evil.example/', ['ctstours.co.nz'])).toBeNull()
    expect(officialWebsiteUrl('http://ctstours.co.nz/', ['ctstours.co.nz'])).toBeNull()
  })
})

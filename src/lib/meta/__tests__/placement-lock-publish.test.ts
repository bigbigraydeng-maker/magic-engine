import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishDraftPaused } from '@/lib/meta/ad-publisher'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

const DRAFT: AdDraft = {
  kind: 'lead_form', clientId: 'c1', campaignName: '留资', adSetName: '买家',
  dailyBudget: 30, durationDays: 7, geoCountries: ['NZ'], pageId: 'p1', leadFormId: 'f1',
  linkUrl: 'https://example.co.nz',
  creatives: [{ name: 'EN', primaryText: 'Brand new home', headline: 'Book', imageHash: 'h1' }],
}

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

function mockGraph() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams(String(init?.body ?? '')) })
    const id = url.includes('/campaigns') ? 'camp1' : url.includes('/adsets') ? 'as1' : 'ad1'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

const targetingOf = () => JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)

describe('计划步骤的版位写进新建广告组', () => {
  it('留资写了只投 Instagram：广告组只带 instagram', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...DRAFT, placements: ['instagram_only'] }, 'act_1', 'tok')
    expect(targetingOf().publisher_platforms).toEqual(['instagram'])
    expect(targetingOf().facebook_positions).toBeUndefined()
  })

  it('看完类视频没写版位：仍锁 facebook + instagram', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const video = { name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }
    await publishDraftPaused({ ...DRAFT, kind: 'video_thruplay', creatives: [video] }, 'act_1', 'tok')
    expect(targetingOf().publisher_platforms).toEqual(['facebook', 'instagram'])
  })

  it('看完类视频写了只投 Instagram：计划收窄，不再强制两个平台', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const video = { name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }
    await publishDraftPaused(
      { ...DRAFT, kind: 'video_thruplay', creatives: [video], placements: ['instagram'] },
      'act_1',
      'tok',
    )
    expect(targetingOf().publisher_platforms).toEqual(['instagram'])
  })

  it('具体位置写进对应的位置数组', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...DRAFT, placements: ['instagram_reels', 'facebook_feed'] }, 'act_1', 'tok')
    expect(targetingOf().publisher_platforms).toEqual(['facebook', 'instagram'])
    expect(targetingOf().instagram_positions).toEqual(['reels'])
    expect(targetingOf().facebook_positions).toEqual(['feed'])
  })

  it('认不出的位置：一次都不写', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused({ ...DRAFT, placements: ['audience_network'] }, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('往已有广告组加广告还带版位：不改原组，一次都不写', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(
      { ...DRAFT, existingAdSetId: '800001', placements: ['instagram'] },
      'act_1',
      'tok',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不会改它的版位')
    expect(calls).toEqual([])
  })
})

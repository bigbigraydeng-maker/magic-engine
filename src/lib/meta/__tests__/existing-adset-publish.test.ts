/**
 * 往已有广告组加一条暂停视频广告。Meta 调用全部走被替换的 fetch。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { activatePublished, pausePublished, publishDraftPaused } from '../ad-publisher'

const ADSET = '800001'
const CAMPAIGN = '900001'
const DRAFT: AdDraft = {
  kind: 'video_thruplay',
  clientId: 'c1',
  campaignName: 'video campaign',
  adSetName: 'group',
  existingAdSetId: ADSET,
  dailyBudget: 15,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  linkUrl: 'https://example.co.nz',
  creatives: [{
    name: 'V', primaryText: 'Watch the route', headline: 'Play', videoId: 'v1', thumbnailImageHash: 'th1',
  }],
}

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

function mockGraph(opts: {
  accountId?: string
  campaignId?: unknown
  failAd?: boolean
  dailyBudget?: string | null
  lifetimeBudget?: string | null
  endTime?: string | null
  campaignDaily?: string | null
} = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: new URLSearchParams(String(init?.body ?? '')) })
    if (method === 'GET') {
      const id = (url.split('?')[0] ?? url).split('/').pop() ?? ADSET
      const campaignRead = id === CAMPAIGN
      const body: Record<string, unknown> = {
        id,
        account_id: opts.accountId ?? '1',
        ...(campaignRead ? {} : { campaign_id: opts.campaignId === undefined ? CAMPAIGN : opts.campaignId }),
      }
      const daily = campaignRead ? opts.campaignDaily : opts.dailyBudget
      if (daily) body.daily_budget = daily
      else if (!campaignRead && opts.dailyBudget === undefined) body.daily_budget = '1500'
      if (!campaignRead && opts.lifetimeBudget) body.lifetime_budget = opts.lifetimeBudget
      if (!campaignRead && opts.endTime) body.end_time = opts.endTime
      if (!campaignRead && opts.endTime) body.start_time = '2026-10-01T00:00:00+0000'
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
    }
    if (method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
    if (opts.failAd && url.includes('/ads')) {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"nope"}}' } as Response
    }
    const id = url.includes('/adcreatives') ? 'cr1' : 'ad9'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

const posts = () => calls.filter((c) => c.method === 'POST')

describe('往已有广告组加暂停视频广告', () => {
  it('只建创意和暂停广告，不新建系列、不新建组、不再上传视频', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r).toMatchObject({
      campaignId: CAMPAIGN, adSetId: ADSET, adIds: ['ad9'], reusedCampaign: true, reusedAdSet: true,
    })
    const paths = posts().map((c) => c.url)
    expect(paths.some((url) => url.includes('/campaigns') || url.includes('/adsets') || url.includes('/advideos'))).toBe(false)
    expect(paths.some((url) => url.includes('/adcreatives'))).toBe(true)
    const ad = posts().find((c) => c.url.includes('/ads'))
    expect(ad?.body.get('status')).toBe('PAUSED')
    expect(ad?.body.get('adset_id')).toBe(ADSET)
    const spec = JSON.parse(posts().find((c) => c.url.includes('/adcreatives'))!.body.get('object_story_spec')!)
    expect(spec.video_data.video_id).toBe('v1')
  })

  it('广告组不属于这个账户 → 一次都不写', async () => {
    vi.stubGlobal('fetch', mockGraph({ accountId: '2' }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    expect(posts()).toEqual([])
  })

  it('读不到所属系列 → 不建广告', async () => {
    vi.stubGlobal('fetch', mockGraph({ campaignId: 'nope' }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    expect(posts()).toEqual([])
  })

  it('广告没建成时不删除已有广告组', async () => {
    vi.stubGlobal('fetch', mockGraph({ failAd: true }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes(ADSET))).toBe(false)
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('cr1'))).toBe(true)
  })

  it('补暂停和开投都不碰已有组和已有系列', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const published = {
      campaignId: CAMPAIGN, adSetId: ADSET, adIds: ['ad9'], orphans: [],
      reusedCampaign: true, reusedAdSet: true,
    }
    await pausePublished(published, 'tok')
    await activatePublished(
      { campaignId: CAMPAIGN, adSetId: ADSET, adIds: ['ad9'] },
      'tok',
      { skipIds: [CAMPAIGN, ADSET] },
    )
    const touched = posts().map((c) => c.url)
    expect(touched.some((url) => url.includes(CAMPAIGN) || url.includes(ADSET))).toBe(false)
    expect(touched.some((url) => url.includes('ad9'))).toBe(true)
  })

  it('草稿写 15 元 7 天，真实是 100 元且没有结束日：不改组，确认用读到的数', async () => {
    vi.stubGlobal('fetch', mockGraph({ dailyBudget: '10000' }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.inheritedSpend).toEqual({ dailyBudget: 100, durationDays: null })
    expect(posts().some((c) => c.body.has('daily_budget') || c.body.has('end_time'))).toBe(false)
  })

  it('读不到每天预算就不建广告', async () => {
    vi.stubGlobal('fetch', mockGraph({ dailyBudget: null, campaignDaily: null }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('每天')
    expect(posts()).toEqual([])
  })

  it('总预算的广告组不拿草稿天数冒充排期', async () => {
    vi.stubGlobal('fetch', mockGraph({ dailyBudget: null, lifetimeBudget: '5000', campaignDaily: null }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('总预算')
    expect(posts()).toEqual([])
  })

  it('确认卡上的预算已经变了，就不建', async () => {
    vi.stubGlobal('fetch', mockGraph({ dailyBudget: '10000' }))
    const r = await publishDraftPaused(
      { ...DRAFT, inheritedSpend: { dailyBudget: 15, durationDays: 7 } },
      'act_1',
      'tok',
    )
    expect(r.ok).toBe(false)
    expect(posts()).toEqual([])
  })

  it('广告组自己没有日预算时，用系列的每天预算', async () => {
    vi.stubGlobal('fetch', mockGraph({ dailyBudget: null, campaignDaily: '10000' }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.inheritedSpend).toEqual({ dailyBudget: 100, durationDays: null })
  })
})

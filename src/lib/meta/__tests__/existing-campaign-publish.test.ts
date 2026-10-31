/**
 * 往已有系列加暂停广告组。Meta 调用全部走被替换的 fetch，不打真网。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { activatePublished, pausePublished, publishDraftPaused } from '../ad-publisher'

const CAMPAIGN = '900001'
const DRAFT: AdDraft = {
  kind: 'lead_form',
  clientId: 'c1',
  campaignName: 'lead campaign',
  existingCampaignId: CAMPAIGN,
  adSetName: 'group',
  dailyBudget: 30,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  leadFormId: 'f1',
  linkUrl: 'https://example.co.nz',
  creatives: [{ name: 'EN', primaryText: 'Book a tour', headline: 'See dates', imageHash: 'h1' }],
}

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

function mockGraph(opts: { accountId?: string; failAdSet?: boolean } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push({ url, method, body })
    if (method === 'GET') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: CAMPAIGN, account_id: opts.accountId ?? '1' }),
      } as Response
    }
    if (method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
    if (opts.failAdSet && url.includes('/adsets')) {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"nope"}}' } as Response
    }
    const id = url.includes('/adsets') ? 'as1' : url.includes('/adcreatives') ? 'cr1' : 'ad1'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

const posts = () => calls.filter((c) => c.method === 'POST')

describe('往已有系列加广告组', () => {
  it('不新建系列，新组挂在给定系列上并且是暂停的', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campaignId).toBe(CAMPAIGN)
    expect(r.reusedCampaign).toBe(true)
    expect(posts().some((c) => c.url.includes('/campaigns'))).toBe(false)
    const adSet = posts().find((c) => c.url.includes('/adsets'))
    expect(adSet?.body.get('campaign_id')).toBe(CAMPAIGN)
    expect(adSet?.body.get('status')).toBe('PAUSED')
    expect(posts().find((c) => c.url.includes('/ads'))?.body.get('status')).toBe('PAUSED')
  })

  it('系列不属于这个广告账户 → 一次都不写', async () => {
    vi.stubGlobal('fetch', mockGraph({ accountId: '2' }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.step).toBe('campaign')
    expect(posts()).toEqual([])
  })

  it('读不到系列 → 一次都不写', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('没有去建')
  })

  it('新组没建成时不删除已有系列', async () => {
    vi.stubGlobal('fetch', mockGraph({ failAdSet: true }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('补暂停和开投都跳过已有系列', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const published = {
      campaignId: CAMPAIGN, adSetId: 'as1', adIds: ['ad1'], orphans: [], reusedCampaign: true,
    }
    await pausePublished(published, 'tok')
    await activatePublished(
      { campaignId: CAMPAIGN, adSetId: 'as1', adIds: ['ad1'] },
      'tok',
      { skipIds: [CAMPAIGN] },
    )
    const touched = posts().map((c) => c.url)
    expect(touched.some((url) => url.includes(CAMPAIGN))).toBe(false)
    expect(touched.some((url) => url.includes('as1'))).toBe(true)
    expect(touched.some((url) => url.includes('ad1'))).toBe(true)
  })
})

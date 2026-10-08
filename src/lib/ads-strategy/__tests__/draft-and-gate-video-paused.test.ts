/**
 * 看完类视频（`video_thruplay`）的「建出来必须全是暂停」回读检查。
 *
 * 原来这条检查只对私信类型跑；这里守的是把它扩到看完类视频之后：
 *   - 三层（系列 / 广告组 / 广告）任一不是 PAUSED、或系列状态读不到 → blocked + 补暂停
 *   - 留资类型（lead_form）行为一字不变：不查系列状态、不补暂停
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/meta/ad-publisher', () => ({
  publishDraftPaused: vi.fn(),
  activatePublished: vi.fn(),
  pausePublished: vi.fn(),
}))
vi.mock('@/lib/meta/readback', () => ({
  fetchAdSetReadback: vi.fn(),
  fetchAdCreativesReadback: vi.fn(),
  fetchCampaignStatus: vi.fn(),
}))
vi.mock('@/lib/meta/asset-upload', () => ({
  waitForVideoReady: vi.fn(),
}))

import { publishDraftPaused, pausePublished } from '@/lib/meta/ad-publisher'
import { fetchAdSetReadback, fetchAdCreativesReadback, fetchCampaignStatus } from '@/lib/meta/readback'
import { createDraftForApproval, type DraftRecord } from '../draft-and-gate'
import type { AdDraft } from '../ad-draft'

const mPublish = vi.mocked(publishDraftPaused)
const mAdSet = vi.mocked(fetchAdSetReadback)
const mCreatives = vi.mocked(fetchAdCreativesReadback)
const mCampaignStatus = vi.mocked(fetchCampaignStatus)
const mPause = vi.mocked(pausePublished)

/** 记下每次写进账本的 payload，测试直接检查它。 */
function fakeSupabase(existing?: DraftRecord) {
  const inserted: DraftRecord[] = []
  const sb = {
    from: () => ({
      insert: (row: { payload: DraftRecord }) => {
        inserted.push(row.payload)
        return {
          select: () => ({ maybeSingle: async () => ({ data: { id: 'act1' }, error: null }) }),
        }
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: existing ? { id: 'act1', client_id: 'c1', payload: existing } : null,
              error: null,
            }),
          }),
          maybeSingle: async () => ({
            data: existing ? { id: 'act1', client_id: 'c1', payload: existing } : null,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
  return { sb, inserted }
}

const OK_PUBLISH = {
  ok: true as const, campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'], orphans: [],
}

const VIDEO: AdDraft = {
  kind: 'video_thruplay',
  clientId: 'c1',
  campaignName: 'Reel campaign',
  adSetName: 'S',
  dailyBudget: 20,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  creatives: [
    { name: 'Reel', primaryText: '', headline: '', postId: 'p1_123' },
  ],
}

const DRAFT: AdDraft = {
  kind: 'lead_form',
  clientId: 'c1',
  campaignName: 'Kiteroa 留资',
  adSetName: 'North Shore',
  dailyBudget: 30,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  leadFormId: 'f1',
  creatives: [
    { name: 'EN', primaryText: 'Brand new four bedroom home in Rothesay Bay', headline: 'Book a viewing', imageHash: 'h1' },
  ],
}

function videoReadback(over: { adSet?: object; ads?: object[]; campaignStatus?: string | null } = {}) {
  mAdSet.mockResolvedValue({
    id: 'as1', name: 'S', status: 'PAUSED', optimization_goal: 'THRUPLAY', destination_type: 'ON_VIDEO',
    targeting: { geo_locations: { countries: ['NZ'] }, publisher_platforms: ['facebook', 'instagram'] },
    ...over.adSet,
  } as never)
  mCreatives.mockResolvedValue((over.ads ?? [
    { adId: 'ad1', adName: 'Reel', status: 'PAUSED', texts: [] },
  ]) as never)
  mCampaignStatus.mockResolvedValue(over.campaignStatus === undefined ? 'PAUSED' : over.campaignStatus)
}

beforeEach(() => {
  vi.resetAllMocks()
  mPublish.mockResolvedValue(OK_PUBLISH)
  mPause.mockResolvedValue({ ok: true, failed: [] })
  videoReadback()
})

describe('createDraftForApproval — 看完类视频的暂停回读', () => {
  it('三层都是 PAUSED → 没有 not_paused，查了系列状态，没补暂停', async () => {
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(VIDEO, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.findings.map((f) => f.code)).not.toContain('not_paused')
    expect(mCampaignStatus).toHaveBeenCalledTimes(1)
    expect(mCampaignStatus).toHaveBeenCalledWith('camp1', 'tok')
    expect(mPause).not.toHaveBeenCalled()
  })

  it('系列是 ACTIVE → blocked + not_paused + 补暂停', async () => {
    videoReadback({ campaignStatus: 'ACTIVE' })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(VIDEO, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('not_paused')
    expect(mPause).toHaveBeenCalledTimes(1)
  })

  it('系列状态读不到(null) → blocked + not_paused + 补暂停', async () => {
    videoReadback({ campaignStatus: null })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(VIDEO, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('not_paused')
    expect(mPause).toHaveBeenCalledTimes(1)
  })

  it('广告是 ACTIVE（系列/广告组 PAUSED）→ blocked + not_paused + 补暂停', async () => {
    videoReadback({ ads: [{ adId: 'ad1', adName: 'Reel', status: 'ACTIVE', texts: [] }] })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(VIDEO, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('not_paused')
    expect(mPause).toHaveBeenCalledTimes(1)
  })

  it('广告组是 ACTIVE → blocked + not_paused + 补暂停', async () => {
    videoReadback({ adSet: { status: 'ACTIVE' } })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(VIDEO, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('not_paused')
    expect(mPause).toHaveBeenCalledTimes(1)
  })

  it('不是暂停时：账本记 blocked，并带上补暂停结果', async () => {
    videoReadback({ campaignStatus: 'ACTIVE' })
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(VIDEO, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('blocked')
    expect(inserted[0].status).toBe('blocked')
    expect(inserted[0].autoPause).toEqual({ ok: true, failed: [] })
  })
})

describe('createDraftForApproval — 留资类型行为不变（回归）', () => {
  it('留资草案：不查系列状态、不补暂停、没有 not_paused', async () => {
    mAdSet.mockResolvedValue({
      id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
      targeting: { geo_locations: { countries: ['NZ'] } },
    })
    mCreatives.mockResolvedValue([
      { adId: 'ad1', adName: 'EN', texts: ['Brand new four bedroom home in Rothesay Bay'] },
    ])
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(DRAFT, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(mCampaignStatus).not.toHaveBeenCalled()
    expect(mPause).not.toHaveBeenCalled()
    expect(r.findings.map((f) => f.code)).not.toContain('not_paused')
  })
})

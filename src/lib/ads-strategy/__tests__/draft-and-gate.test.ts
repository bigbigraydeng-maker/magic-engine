/**
 * 「ME 发广告」全链路的测试。
 *
 * 守的是三条不许绕的规矩：
 *   1. 建出来的一律暂停 —— 没有任何路径能让 ME 自己开始花钱
 *   2. 闸门拦下的不进审批队列
 *   3. 回读失败 ≠ 没问题，不许进审批队列
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/meta/ad-publisher', () => ({
  publishDraftPaused: vi.fn(),
  activatePublished: vi.fn(),
}))
vi.mock('@/lib/meta/readback', () => ({
  fetchAdSetReadback: vi.fn(),
  fetchAdCreativesReadback: vi.fn(),
}))

import { publishDraftPaused, activatePublished } from '@/lib/meta/ad-publisher'
import { fetchAdSetReadback, fetchAdCreativesReadback } from '@/lib/meta/readback'
import {
  createDraftForApproval,
  approveDraft,
  type DraftRecord,
} from '../draft-and-gate'
import type { AdDraft } from '../ad-draft'

const mPublish = vi.mocked(publishDraftPaused)
const mActivate = vi.mocked(activatePublished)
const mAdSet = vi.mocked(fetchAdSetReadback)
const mCreatives = vi.mocked(fetchAdCreativesReadback)

/** 记下每次写进账本的 payload，测试直接检查它。 */
function fakeSupabase(existing?: DraftRecord) {
  const inserted: DraftRecord[] = []
  const updated: DraftRecord[] = []
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
      update: (row: { payload: DraftRecord }) => {
        updated.push(row.payload)
        return { eq: async () => ({ data: null, error: null }) }
      },
    }),
  } as unknown as SupabaseClient
  return { sb, inserted, updated }
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

const OK_PUBLISH = {
  ok: true as const, campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'], orphans: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  mPublish.mockResolvedValue(OK_PUBLISH)
  mAdSet.mockResolvedValue({
    id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION',
    destination_type: 'ON_AD',
    targeting: { geo_locations: { countries: ['NZ'] } },
  })
  mCreatives.mockResolvedValue([
    { adId: 'ad1', adName: 'EN', texts: ['Brand new four bedroom home in Rothesay Bay'] },
  ])
})

describe('createDraftForApproval', () => {
  it('干净的草案 → 等人点头，并且把买家会看到的话存下来', async () => {
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(DRAFT, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('awaiting_approval')
    expect(inserted[0].buyerWillSee?.[0].lines[0]).toContain('Rothesay Bay')
    expect(inserted[0].adSetId).toBe('as1')
  })

  it('草案自己不合规 → 根本不去建（不浪费一次真实创建）', async () => {
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval({ ...DRAFT, leadFormId: undefined }, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(mPublish).not.toHaveBeenCalled()
    expect(r.status).toBe('failed')
    expect(inserted[0].error).toContain('leadFormId')
  })

  it('回读不出来 → blocked，绝不进审批队列', async () => {
    mAdSet.mockResolvedValue(null)
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(DRAFT, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('blocked')
    // 建出来的 id 必须留着 —— 否则那条暂停的广告在库里就没主了。
    expect(inserted[0].adSetId).toBe('as1')
  })

  it('闸门发现 blocker → blocked，不拿去问人', async () => {
    // Meta 把「允许投给名单以外的人」自动开了，而这是个声称重定向的组。
    mAdSet.mockResolvedValue({
      id: 'as1', name: '暖池重定向', optimization_goal: 'LEAD_GENERATION',
      targeting: {
        geo_locations: { countries: ['NZ'] },
        targeting_relaxation_types: { custom_audience: 1 },
      },
    })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(
      { ...DRAFT, adSetName: '暖池重定向' },
      { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' },
    )
    expect(r.status).toBe('blocked')
  })

  it('客户行业真的传进闸门文案（G11 接线）：travel 说「客户服务市场」，不说中性词', async () => {
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(DRAFT, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok', expectedGeo: 'Auckland', industry: 'travel',
    })
    const geo = r.findings.find((f) => f.code === 'geo_mismatch')
    expect(geo?.message).toContain('客户服务市场在「Auckland」')
    expect(geo?.message).not.toContain('客户业务')
  })

  it('建到一半失败 → failed，并且把没删干净的东西记下来', async () => {
    mPublish.mockResolvedValue({
      ok: false, step: 'creative', error: 'bad image_hash', orphans: ['camp1'],
    })
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(DRAFT, {
      supabase: sb, adAccountId: 'act_1', accessToken: 'tok',
    })
    expect(r.status).toBe('failed')
    expect(inserted[0].orphans).toEqual(['camp1'])
  })
})

describe('approveDraft — 唯一让钱动起来的地方', () => {
  const READY: DraftRecord = {
    status: 'awaiting_approval', draft: DRAFT, summary: 's',
    campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'],
  }

  it('等待批准的 → 开，并且把状态改成在投', async () => {
    mActivate.mockResolvedValue({ ok: true })
    const { sb, updated } = fakeSupabase(READY)
    const r = await approveDraft('act1', sb, 'tok')
    expect(r.ok).toBe(true)
    expect(updated[0].status).toBe('active')
  })

  it('已经开过的不能再开一次', async () => {
    const { sb } = fakeSupabase({ ...READY, status: 'active' })
    const r = await approveDraft('act1', sb, 'tok')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('active') })
    expect(mActivate).not.toHaveBeenCalled()
  })

  it('被闸门拦下的不能开', async () => {
    const { sb } = fakeSupabase({ ...READY, status: 'blocked' })
    const r = await approveDraft('act1', sb, 'tok')
    expect(r.ok).toBe(false)
    expect(mActivate).not.toHaveBeenCalled()
  })

  it('Meta 那边开失败 → 不许把状态改成在投', async () => {
    mActivate.mockResolvedValue({ ok: false, error: 'HTTP 400' })
    const { sb, updated } = fakeSupabase(READY)
    const r = await approveDraft('act1', sb, 'tok')
    expect(r.ok).toBe(false)
    expect(updated).toHaveLength(0)
  })

  it('找不到这条 → 报错，不是静默成功', async () => {
    const { sb } = fakeSupabase()
    const r = await approveDraft('nope', sb, 'tok')
    expect(r.ok).toBe(false)
  })
})

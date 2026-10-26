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
  pausePublished: vi.fn(),
}))
vi.mock('@/lib/meta/readback', () => ({
  fetchAdSetReadback: vi.fn(),
  fetchAdCreativesReadback: vi.fn(),
  fetchCampaignStatus: vi.fn(),
  fetchAccountMinDailyBudget: vi.fn(),
  fetchAccountCustomAudiences: vi.fn(),
}))
vi.mock('@/lib/meta/asset-upload', () => ({
  waitForVideoReady: vi.fn(),
}))

import { publishDraftPaused, activatePublished, pausePublished } from '@/lib/meta/ad-publisher'
import { fetchAdSetReadback, fetchAdCreativesReadback, fetchCampaignStatus, fetchAccountMinDailyBudget, fetchAccountCustomAudiences } from '@/lib/meta/readback'
import { waitForVideoReady } from '@/lib/meta/asset-upload'
import {
  createDraftForApproval,
  approveDraft,
  rejectDraft,
  type DraftRecord,
} from '../draft-and-gate'
import type { AdDraft } from '../ad-draft'

const PM = { actorUserId: 'u-pm', actorEmail: 'pm@magiclab.test', basis: 'global_admin' as const }

const mPublish = vi.mocked(publishDraftPaused)
const mActivate = vi.mocked(activatePublished)
const mAdSet = vi.mocked(fetchAdSetReadback)
const mCreatives = vi.mocked(fetchAdCreativesReadback)
const mCampaignStatus = vi.mocked(fetchCampaignStatus)
const mWait = vi.mocked(waitForVideoReady)
const mMinBudget = vi.mocked(fetchAccountMinDailyBudget)
const mAudiences = vi.mocked(fetchAccountCustomAudiences)
const mPause = vi.mocked(pausePublished)

/** 记下每次写进账本的 payload，测试直接检查它。 */
function fakeSupabase(
  existing?: DraftRecord,
  opts: {
    updateError?: { message: string } | null
    failAfterFirstUpdate?: boolean
    claimMatches?: boolean
  } = {},
) {
  const inserted: DraftRecord[] = []
  const updated: DraftRecord[] = []
  let updateCount = 0
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
        updateCount += 1
        const error = opts.failAfterFirstUpdate
          ? updateCount > 1
            ? { message: 'late fail' }
            : null
          : opts.updateError ?? null
        const matched = opts.claimMatches !== false
        const b = {
          eq: () => b,
          select: async () => ({ data: matched ? [{ id: 'act1' }] : [], error }),
          then: (resolve: (v: { data: null; error: { message: string } | null }) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error }).then(resolve, reject),
        }
        return b
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

  it('🔴 回读不到优化目标 + 草案是看完类视频 + 版位没锁 → 仍然 blocked（不能静默跳过版位检查）', async () => {
    mWait.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof waitForVideoReady>>)
    mAdSet.mockResolvedValue({ id: 'as1', name: '养受众', targeting: { geo_locations: { countries: ['NZ'] } } })
    const { sb } = fakeSupabase()
    const video = { name: 'V', primaryText: 'Watch our story', headline: 'Story', videoId: 'v1' }
    const r = await createDraftForApproval(
      { ...DRAFT, kind: 'video_thruplay', creatives: [video] },
      { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' },
    )
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('playback_placement_not_locked')
  })

  it('🔴 留资视频广告也要等转码；只有图的不等；转码超时 → failed 且不建', async () => {
    const { sb } = fakeSupabase()
    const leadVideo = { ...DRAFT, creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v9', thumbnailImageHash: 'th' }] }
    mWait.mockClear()
    mWait.mockResolvedValue({ ok: false, error: '视频还没转码好' } as Awaited<ReturnType<typeof waitForVideoReady>>)
    const r = await createDraftForApproval(leadVideo, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(mWait).toHaveBeenCalledTimes(1)
    expect(mWait.mock.calls[0][0]).toEqual(['v9'])
    expect(r.status).toBe('failed')
    mWait.mockClear()
    await createDraftForApproval(DRAFT, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(mWait).not.toHaveBeenCalled()
  })

  it('🔴 日预算低于账户最低日预算 → 不建，人话报错；读不到最低值 → 放行（Meta 兜底）', async () => {
    const { sb, inserted } = fakeSupabase()
    mPublish.mockClear()
    mMinBudget.mockResolvedValueOnce({ minDailyBudgetMinor: 178, currency: 'NZD' })
    const r = await createDraftForApproval({ ...DRAFT, dailyBudget: 1 }, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(r.status).toBe('failed')
    expect(r.error).toContain('最低日预算 1.78 NZD')
    expect(mPublish).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].minBudgetChecked).toBe(178)
    mMinBudget.mockResolvedValueOnce({ minDailyBudgetMinor: 178, currency: 'NZD' })
    await createDraftForApproval({ ...DRAFT, dailyBudget: 2 }, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(mPublish).toHaveBeenCalledTimes(1)
    mPublish.mockClear()
    mMinBudget.mockResolvedValueOnce(null)
    await createDraftForApproval({ ...DRAFT, dailyBudget: 1 }, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(mPublish).toHaveBeenCalledTimes(1)
    // 没读到 → 账本记 null（不是 0、不是漏记）；读到 → 记数字
    expect(inserted.at(-1)?.minBudgetChecked).toBeNull()
    mMinBudget.mockResolvedValueOnce({ minDailyBudgetMinor: 178, currency: 'NZD' })
    await createDraftForApproval({ ...DRAFT, dailyBudget: 2 }, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(inserted.at(-1)?.minBudgetChecked).toBe(178)
  })

  it('🔴 带视频的草案建广告有整次时间预算；纯图的不限（与等转码同口径）', async () => {
    const { sb } = fakeSupabase()
    mWait.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof waitForVideoReady>>)
    mPublish.mockClear()
    const leadVideo = { ...DRAFT, creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v9', thumbnailImageHash: 'th' }] }
    await createDraftForApproval(leadVideo, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(mPublish.mock.calls[0][3]).toMatchObject({ stopWritingAt: expect.any(Number) })
    mPublish.mockClear()
    await createDraftForApproval(DRAFT, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(mPublish.mock.calls[0][3]).toBeUndefined()
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
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(true)
    expect(updated.at(-1)?.status).toBe('active')
  })

  it('已经开过的不能再开一次', async () => {
    const { sb } = fakeSupabase({ ...READY, status: 'active' })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r).toEqual({ ok: false, error: expect.stringContaining('active') })
    expect(mActivate).not.toHaveBeenCalled()
  })

  it('被闸门拦下的不能开', async () => {
    const { sb } = fakeSupabase({ ...READY, status: 'blocked' })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    expect(mActivate).not.toHaveBeenCalled()
  })

  it('Meta 那边开失败 → 不许把状态改成在投', async () => {
    mActivate.mockResolvedValue({ ok: false, error: 'HTTP 400' })
    const { sb, updated } = fakeSupabase(READY)
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    expect(updated.every((u) => u.status !== 'active')).toBe(true)
    expect(updated.at(-1)?.status).toBe('awaiting_approval')
    expect(updated.at(-1)?.activation?.status).toBe('meta_failed')
  })

  it('找不到这条 → 报错，不是静默成功', async () => {
    const { sb } = fakeSupabase()
    const r = await approveDraft('nope', sb, 'tok', PM)
    expect(r.ok).toBe(false)
  })

  it('开之前先写授权回执：谁、哪个客户、哪个系列、依据、时间', async () => {
    const seenUpdateCounts: number[] = []
    mActivate.mockImplementation(async () => {
      seenUpdateCounts.push(updated.length)
      return { ok: true }
    })
    const { sb, updated } = fakeSupabase(READY)
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(true)
    expect(updated[0].status).toBe('activating')
    expect(updated[0].activation).toMatchObject({
      schema: 'ads.spend_activation_receipt.v1',
      entry: 'ad-approval',
      basis: 'global_admin',
      actor_user_id: 'u-pm',
      actor_email: 'pm@magiclab.test',
      client_id: 'c1',
      campaign_id: 'camp1',
      draft_action_id: 'act1',
      status: 'authorized_pending',
    })
    expect(typeof updated[0].activation?.authorized_at).toBe('string')
    expect(updated.at(-1)?.activation?.status).toBe('executed')
    expect(seenUpdateCounts).toEqual([1])
  })

  it('授权回执写不进去 → 不开，零 Meta 调用', async () => {
    const { sb } = fakeSupabase(READY, { updateError: { message: 'db down' } })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('授权回执')
    expect(mActivate).not.toHaveBeenCalled()
  })

  it('开成功但最后写账本失败 → 如实带 warning，不假装干净', async () => {
    mActivate.mockResolvedValue({ ok: true })
    const { sb } = fakeSupabase(READY, { failAfterFirstUpdate: true })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r).toEqual({ ok: true, warning: expect.stringContaining('late fail') })
  })

  it('同一条被并发批准：占不到位 → 不开，零 Meta 调用', async () => {
    const { sb } = fakeSupabase(READY, { claimMatches: false })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('别处处理过')
    expect(mActivate).not.toHaveBeenCalled()
  })

  it('占位之后开失败 → 退回等待批准并带失败回执，可重试', async () => {
    mActivate.mockResolvedValue({ ok: false, error: 'HTTP 400' })
    const { sb, updated } = fakeSupabase(READY)
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    expect(updated[0].status).toBe('activating')
    expect(updated.at(-1)?.status).toBe('awaiting_approval')
    expect(updated.at(-1)?.activation).toMatchObject({ status: 'meta_failed', error: 'HTTP 400' })
  })

  it('占位之后开失败且失败回执也写不进去 → 如实说停在开启中', async () => {
    mActivate.mockResolvedValue({ ok: false, error: 'HTTP 400' })
    const { sb } = fakeSupabase(READY, { failAfterFirstUpdate: true })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('开启中')
  })
})

describe('rejectDraft — 只能否决还在等待的', () => {
  const READY_DRAFT: DraftRecord = {
    status: 'awaiting_approval', draft: DRAFT, summary: 's',
    campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'],
  }

  it('等待批准的 → 否决成功，状态变 rejected', async () => {
    const { sb, updated } = fakeSupabase(READY_DRAFT)
    const r = await rejectDraft('act1', sb)
    expect(r.ok).toBe(true)
    expect(updated[0].status).toBe('rejected')
  })

  it('已经开了的不能再否决，账本不被改成假话', async () => {
    const { sb, updated } = fakeSupabase({ ...READY_DRAFT, status: 'active' })
    const r = await rejectDraft('act1', sb)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('active')
    expect(updated).toHaveLength(0)
  })

  it('开启中的不能否决', async () => {
    const { sb, updated } = fakeSupabase({ ...READY_DRAFT, status: 'activating' })
    const r = await rejectDraft('act1', sb)
    expect(r.ok).toBe(false)
    expect(updated).toHaveLength(0)
  })

  it('否决时被别处抢先改了 → 如实报，不假装成功', async () => {
    const { sb } = fakeSupabase(READY_DRAFT, { claimMatches: false })
    const r = await rejectDraft('act1', sb)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('别处处理过')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 私信（点击后进 Messenger 对话）类型 —— 全链路
// ─────────────────────────────────────────────────────────────────────────────

const MSG: AdDraft = {
  kind: 'messenger_conversation',
  clientId: 'c1',
  campaignName: 'DM campaign',
  adSetName: 'DM set',
  dailyBudget: 20,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  creatives: [
    { name: 'DM ad', primaryText: 'Join our Christmas tour', headline: 'Message us', videoId: 'v1', thumbnailImageHash: 'th1', language: 'en' },
    { name: 'DM ad 2', primaryText: 'See the route', headline: 'Ask us', videoId: 'v2', thumbnailImageHash: 'th2', language: 'en' },
  ],
}

const MSG_PUBLISH = { ok: true as const, campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1', 'ad2'], orphans: [] }
const T0 = 1_000_000

function messengerReadback(over: { adSet?: object; ads?: object[] } = {}) {
  mAdSet.mockResolvedValue({
    id: 'as1', name: 'DM set', optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER',
    status: 'PAUSED', targeting: { geo_locations: { countries: ['NZ'] } },
    ...over.adSet,
  })
  mCreatives.mockResolvedValue((over.ads ?? [
    { adId: 'ad1', adName: 'DM ad', status: 'PAUSED', texts: ['Join our Christmas tour', 'Hi! Please let us know how we can help you.'] },
    { adId: 'ad2', adName: 'DM ad 2', status: 'PAUSED', texts: ['See the route'] },
  ]) as never)
}

function deps(sb: SupabaseClient, over: object = {}) {
  return { supabase: sb, adAccountId: 'act_1', accessToken: 'tok', brandRedlines: [] as string[], now: () => T0, ...over }
}

describe('createDraftForApproval — 私信类型', () => {
  beforeEach(() => {
    mPublish.mockResolvedValue(MSG_PUBLISH)
    mWait.mockResolvedValue({ ok: true })
    mCampaignStatus.mockResolvedValue('PAUSED')
    mPause.mockResolvedValue({ ok: true, failed: [] })
    messengerReadback()
  })

  it('全链路：等转码 → 建 → 回读 → 过闸 → 等人点头；记下查了几条红线', async () => {
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb, { brandRedlines: ['a phrase', 'b phrase'] }))
    expect(r.status).toBe('awaiting_approval')
    expect(mWait).toHaveBeenCalledWith(['v1', 'v2'], 'tok', expect.objectContaining({ timeoutMs: 25_000 }))
    expect(mPublish).toHaveBeenCalledTimes(1)
    expect(inserted[0].redlinesChecked).toBe(2)
    // Meta 自动加的问候语也摊给人看
    expect(inserted[0].buyerWillSee?.[0].lines.join(' ')).toContain('Please let us know')
    expect(mPause).not.toHaveBeenCalled()
  })

  it('时间预算按请求开始时刻算：45 秒后不再写、80 秒后不再回滚', async () => {
    const { sb } = fakeSupabase()
    await createDraftForApproval(MSG, deps(sb))
    const opts = mPublish.mock.calls[0][3]
    expect(opts).toMatchObject({ stopWritingAt: T0 + 45_000, giveUpRollbackAt: T0 + 80_000 })
  })

  it('红线没加载(undefined) → 拒建：不等转码、不建、记 failed 且 redlinesChecked=null', async () => {
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb, { brandRedlines: undefined }))
    expect(r.status).toBe('failed')
    expect(inserted[0].error).toContain('brandRedlines')
    expect(inserted[0].redlinesChecked).toBeNull()
    expect(mWait).not.toHaveBeenCalled()
    expect(mPublish).not.toHaveBeenCalled()
  })

  it('名单里太短、没拿来比的条目不静默忽略：记进 redlinesSkipped', async () => {
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb, { brandRedlines: ['a', ' ', 'real phrase'] }))
    expect(r.status).toBe('awaiting_approval')
    expect(inserted[0].redlinesChecked).toBe(3)
    expect(inserted[0].redlinesSkipped).toEqual(['a', ' '])
  })

  it('名单都能用时不带 redlinesSkipped 字段', async () => {
    const { sb, inserted } = fakeSupabase()
    await createDraftForApproval(MSG, deps(sb, { brandRedlines: ['real phrase'] }))
    expect(inserted[0].redlinesSkipped).toBeUndefined()
  })

  it('文案命中客户禁用词 → 拒建', async () => {
    const { sb, inserted } = fakeSupabase()
    const d = { ...MSG, creatives: [{ ...MSG.creatives[0], primaryText: 'Proudly founded in １９００' }] }
    const r = await createDraftForApproval(d, deps(sb, { brandRedlines: ['founded in 1900'] }))
    expect(r.status).toBe('failed')
    expect(inserted[0].error).toContain('founded in 1900')
    expect(inserted[0].redlinesChecked).toBe(1)
    expect(mPublish).not.toHaveBeenCalled()
  })

  it('转码等不到 → failed，如实写原因；没建任何东西，没有 orphans', async () => {
    mWait.mockResolvedValue({ ok: false, reason: 'timeout', error: '等了 25 秒，视频还在转码（v2）—— 广告没建，稍后重试' })
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('failed')
    expect(r.error).toContain('广告没建')
    expect(mPublish).not.toHaveBeenCalled()
    expect(inserted[0].orphans).toBeUndefined()
  })

  it('建失败 → failed，orphans 带进账本', async () => {
    mPublish.mockResolvedValue({ ok: false, step: 'creative', error: 'bad', orphans: ['未确认是否已建成：广告「x」'] })
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('failed')
    expect(inserted[0].orphans).toEqual(['未确认是否已建成：广告「x」'])
  })

  it('回读发现广告组是 ACTIVE → blocked，并立刻补暂停，结果入账', async () => {
    messengerReadback({ adSet: { status: 'ACTIVE' } })
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('not_paused')
    expect(mPause).toHaveBeenCalledWith(
      { campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1', 'ad2'], orphans: [], ok: true },
      'tok',
      // 补暂停也有期限：从请求开始算 92 秒
      { deadlineAt: T0 + 92_000, now: expect.any(Function) },
    )
    expect(inserted[0].autoPause).toEqual({ ok: true, failed: [] })
    expect(inserted[0].readback).toContain('补暂停')
  })

  it('补暂停也失败 → 读报告的人能看到 🔴 和失败的 id', async () => {
    messengerReadback({ ads: [{ adId: 'ad1', adName: 'x', status: 'ACTIVE', texts: ['hi'] }, { adId: 'ad2', adName: 'y', status: 'PAUSED', texts: ['hi'] }] })
    mPause.mockResolvedValue({ ok: false, failed: ['ad1：HTTP 400'] })
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('blocked')
    expect(inserted[0].autoPause).toEqual({ ok: false, failed: ['ad1：HTTP 400'] })
    expect(inserted[0].readback).toContain('🔴')
    expect(inserted[0].readback).toContain('ad1：HTTP 400')
  })

  it('系列状态读不到(null) → blocked（读不到 ≠ 暂停着）', async () => {
    mCampaignStatus.mockResolvedValue(null)
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('not_paused')
  })

  it('目标 / 落点跟声明的不一样 → blocked', async () => {
    messengerReadback({ adSet: { optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE' } })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('messaging_adset_mismatch')
  })

  it('回读到的广告条数不对(含 0 条) → blocked，不放行', async () => {
    messengerReadback({ ads: [] })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('ad_count_mismatch')
  })

  it('Meta 自动加的问候语命中红线 → blocked', async () => {
    messengerReadback({ ads: [
      { adId: 'ad1', adName: 'a', status: 'PAUSED', texts: ['We were founded in 1900'] },
      { adId: 'ad2', adName: 'b', status: 'PAUSED', texts: ['ok'] },
    ] })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb, { brandRedlines: ['founded in 1900'] }))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('brand_redline_in_readback')
  })

  it('建完发现整次请求已经用掉太多时间 → 不回读，blocked（查不出来 ≠ 没问题），但 id 留着', async () => {
    const now = vi.fn().mockReturnValueOnce(T0).mockReturnValue(T0 + 80_000)
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb, { now }))
    expect(r.status).toBe('blocked')
    expect(r.error).toContain('没来得及回读')
    expect(mAdSet).not.toHaveBeenCalled()
    expect(inserted[0].adSetId).toBe('as1')
  })

  it('闸门原有的多语言 blocker 对私信类型照样生效（复用，不是重写）', async () => {
    messengerReadback({ ads: [
      { adId: 'ad1', adName: 'EN', status: 'PAUSED', texts: ['Join our Christmas tour'] },
      { adId: 'ad2', adName: 'ZH', status: 'PAUSED', texts: ['圣诞节新西兰双岛游，欢迎私信咨询'] },
    ] })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(MSG, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('mixed_script_messaging_adset')
  })
})

describe('createDraftForApproval — 请求体形状不对时不抛 500、要落账', () => {
  const MALFORMED = [[null], [5], [{ name: 'A', primaryText: 5, headline: 'h' }]]

  it('creatives 里有 null / 数字 / 非字符串 → failed 并落账，什么都不建（私信和留资都一样）', async () => {
    for (const kind of ['messenger_conversation', 'lead_form'] as const) {
      for (const creatives of MALFORMED) {
        mPublish.mockClear(); mWait.mockClear()
        const { sb, inserted } = fakeSupabase()
        const d = { ...(kind === 'lead_form' ? DRAFT : MSG), creatives } as unknown as AdDraft
        const r = await createDraftForApproval(d, deps(sb))
        expect(r.status, `${kind} ${JSON.stringify(creatives)}`).toBe('failed')
        expect(inserted).toHaveLength(1)
        expect(mPublish).not.toHaveBeenCalled()
        expect(mWait).not.toHaveBeenCalled()
      }
    }
  })

  it('creatives 不是数组 / kind 是陌生值 → 同样 failed 落账，不抛', async () => {
    for (const patch of [{ creatives: undefined }, { kind: 'weird' }]) {
      const { sb, inserted } = fakeSupabase()
      const r = await createDraftForApproval({ ...MSG, ...patch } as unknown as AdDraft, deps(sb))
      expect(r.status).toBe('failed')
      expect(inserted).toHaveLength(1)
    }
  })
})

describe('createDraftForApproval — 其它类型的行为不变', () => {
  it('留资草案：不等转码、不查期望、不给预算参数、不补暂停', async () => {
    mPublish.mockResolvedValue(OK_PUBLISH)
    mAdSet.mockResolvedValue({
      id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
      targeting: { geo_locations: { countries: ['NZ'] } },
    })
    mCreatives.mockResolvedValue([{ adId: 'ad1', adName: 'EN', texts: ['Brand new four bedroom home in Rothesay Bay'] }])
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(DRAFT, { supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
    expect(r.status).toBe('awaiting_approval')
    expect(mWait).not.toHaveBeenCalled()
    expect(mCampaignStatus).not.toHaveBeenCalled()
    expect(mPause).not.toHaveBeenCalled()
    expect(mPublish.mock.calls[0][3]).toBeUndefined()
  })
})

describe('approveDraft — 私信广告现在不能用「开」按钮打开', () => {
  const base = { status: 'awaiting_approval' as const, summary: 's', campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'] }

  it('私信类型即使状态是等待批准 → 拒，零 Meta 调用，账本不改', async () => {
    const { sb, updated } = fakeSupabase({ ...base, draft: MSG })
    const r = await approveDraft('act1', sb, 'tok', PM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('私信')
    expect(mActivate).not.toHaveBeenCalled()
    expect(updated).toHaveLength(0)
  })

  it('账本里 kind 陌生 / 缺失 / draft 缺失的旧记录 → 白名单一律拒', async () => {
    for (const draft of [{ ...DRAFT, kind: 'weird' }, { ...DRAFT, kind: undefined }, undefined]) {
      mActivate.mockClear()
      const { sb, updated } = fakeSupabase({ ...base, draft } as unknown as DraftRecord)
      const r = await approveDraft('act1', sb, 'tok', PM)
      expect(r.ok, JSON.stringify(draft?.kind)).toBe(false)
      expect(mActivate).not.toHaveBeenCalled()
      expect(updated).toHaveLength(0)
    }
  })

  it('原来的两种类型照样能开', async () => {
    mActivate.mockResolvedValue({ ok: true })
    for (const kind of ['lead_form', 'video_thruplay'] as const) {
      const { sb } = fakeSupabase({ ...base, draft: { ...DRAFT, kind } })
      expect((await approveDraft('act1', sb, 'tok', PM)).ok, kind).toBe(true)
    }
  })
})

describe('createDraftForApproval — 自定义受众（刀②）', () => {
  const AUD_DRAFT: AdDraft = { ...DRAFT, audienceIds: ['1111111'], excludedAudienceIds: ['2222222'] }
  const deps = (sb: SupabaseClient) => ({ supabase: sb, adAccountId: 'act_1', accessToken: 'tok' })
  const ACCOUNT_AUDIENCES = [
    { id: '1111111', name: 'Site visitors', subtype: 'WEBSITE', operationStatusCode: 200, approxCountLowerBound: 1000 },
    { id: '2222222', name: 'Past leads', subtype: 'CUSTOM', operationStatusCode: 200, approxCountLowerBound: 500 },
  ]
  const ATTACHED_ADSET = {
    id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
    targeting: {
      geo_locations: { countries: ['NZ'] },
      custom_audiences: [{ id: '1111111' }],
      excluded_custom_audiences: [{ id: '2222222' }],
      targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
      targeting_automation: { advantage_audience: 0 },
    },
  }

  it('无受众的草案不发请求：不查受众列表，账本记 null', async () => {
    const { sb, inserted } = fakeSupabase()
    await createDraftForApproval(DRAFT, deps(sb))
    expect(mAudiences).not.toHaveBeenCalled()
    expect(inserted[0].audiencesChecked).toBeNull()
  })

  it('受众列表读不到 → failed，不建', async () => {
    mAudiences.mockResolvedValue(null)
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('failed')
    expect(r.error).toContain('读不到这个广告账户的受众列表')
    expect(mPublish).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].status).toBe('failed')
  })

  it('排除受众的 id 不属于这个账户 → failed，不建', async () => {
    mAudiences.mockResolvedValue([ACCOUNT_AUDIENCES[0]])
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('failed')
    expect(r.error).toContain('2222222')
    expect(r.error).toContain('不属于这个广告账户')
    expect(mPublish).not.toHaveBeenCalled()
  })

  it('包含受众的 id 不属于这个账户 → failed，不建', async () => {
    mAudiences.mockResolvedValue([ACCOUNT_AUDIENCES[1]])
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('failed')
    expect(r.error).toContain('1111111')
    expect(mPublish).not.toHaveBeenCalled()
  })

  it('包含受众还没准备好（状态 400）→ failed，不建', async () => {
    mAudiences.mockResolvedValue([{ ...ACCOUNT_AUDIENCES[0], operationStatusCode: 400 }, ACCOUNT_AUDIENCES[1]])
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('failed')
    expect(r.error).toContain('还没准备好')
    expect(r.error).toContain('400')
    expect(mPublish).not.toHaveBeenCalled()
  })

  it('包含受众太小（99 人）→ failed，不建', async () => {
    mAudiences.mockResolvedValue([{ ...ACCOUNT_AUDIENCES[0], approxCountLowerBound: 99 }, ACCOUNT_AUDIENCES[1]])
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('failed')
    expect(r.error).toContain('不足 100 人')
    expect(mPublish).not.toHaveBeenCalled()
  })

  it('包含受众刚好 100 人 → 不拦，照常建', async () => {
    mAudiences.mockResolvedValue([{ ...ACCOUNT_AUDIENCES[0], approxCountLowerBound: 100 }, ACCOUNT_AUDIENCES[1]])
    const { sb } = fakeSupabase()
    await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(mPublish).toHaveBeenCalledTimes(1)
  })

  it('读不到状态 / 人数 → 不拦（Meta 兜底）', async () => {
    mAudiences.mockResolvedValue([
      { ...ACCOUNT_AUDIENCES[0], operationStatusCode: null, approxCountLowerBound: null },
      ACCOUNT_AUDIENCES[1],
    ])
    const { sb } = fakeSupabase()
    await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(mPublish).toHaveBeenCalledTimes(1)
  })

  it('排除受众不查状态 / 人数：状态 400、只有 5 人也照常建', async () => {
    mAudiences.mockResolvedValue([
      ACCOUNT_AUDIENCES[0],
      { ...ACCOUNT_AUDIENCES[1], operationStatusCode: 400, approxCountLowerBound: 5 },
    ])
    mAdSet.mockResolvedValue(ATTACHED_ADSET)
    const { sb } = fakeSupabase()
    await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(mPublish).toHaveBeenCalledTimes(1)
  })

  it('合法 → 建并记账：回读挂上了受众，无 blocker', async () => {
    mAudiences.mockResolvedValue(ACCOUNT_AUDIENCES)
    mAdSet.mockResolvedValue(ATTACHED_ADSET)
    const { sb, inserted } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('awaiting_approval')
    expect(mPublish).toHaveBeenCalledTimes(1)
    expect(inserted[0].audiencesChecked).toEqual({ included: ['1111111'], excluded: ['2222222'] })
    expect(r.findings.filter((f) => f.severity === 'blocker')).toHaveLength(0)
  })

  it('声明了包含受众但回读没挂上 → blocked', async () => {
    mAudiences.mockResolvedValue(ACCOUNT_AUDIENCES)
    mAdSet.mockResolvedValue({
      id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
      targeting: { geo_locations: { countries: ['NZ'] } },
    })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('audience_not_attached')
  })

  it('包含受众挂上了但排除受众没挂上 → blocked', async () => {
    mAudiences.mockResolvedValue(ACCOUNT_AUDIENCES)
    mAdSet.mockResolvedValue({
      id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
      targeting: {
        geo_locations: { countries: ['NZ'] },
        custom_audiences: [{ id: '1111111' }],
        targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
        targeting_automation: { advantage_audience: 0 },
      },
    })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval(AUD_DRAFT, deps(sb))
    expect(r.status).toBe('blocked')
    expect(r.findings.map((f) => f.code)).toContain('excluded_audience_not_attached')
  })

  it('只给排除受众不算重定向：不报 retargeting_without_audience', async () => {
    mAudiences.mockResolvedValue(ACCOUNT_AUDIENCES)
    mAdSet.mockResolvedValue({
      id: 'as1', name: 'North Shore', optimization_goal: 'LEAD_GENERATION', destination_type: 'ON_AD',
      targeting: {
        geo_locations: { countries: ['NZ'] },
        excluded_custom_audiences: [{ id: '2222222' }],
        targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
        targeting_automation: { advantage_audience: 0 },
      },
    })
    const { sb } = fakeSupabase()
    const r = await createDraftForApproval({ ...DRAFT, excludedAudienceIds: ['2222222'] }, deps(sb))
    expect(r.status).toBe('awaiting_approval')
    expect(r.findings.map((f) => f.code)).not.toContain('retargeting_without_audience')
  })
})

/**
 * 多个广告组建完之后的回读核对。
 *
 * 每一条都对着「建出来的不是我们要的」说话：不是暂停、预算数不对、没终点、
 * 年龄 / 国家不对、广告条数不对、系列花费上限没落地。任何一项读不到都不算通过。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/meta/readback', () => ({
  fetchAdSetReadback: vi.fn(),
  fetchAdCreativesReadback: vi.fn(),
  fetchCampaignReadback: vi.fn(),
}))

import { fetchAdSetReadback, fetchAdCreativesReadback, fetchCampaignReadback } from '@/lib/meta/readback'
import { checkMultiCreated, fetchMultiReadback, mergeMultiReports, type MultiReadback, type SetReadback } from '../draft-gate-multi'
import { adSetViews, type AdDraft, type AdDraftAdSet } from '../ad-draft'
import type { LaunchReadbackReport } from '../launch-readback'

const NOW = Date.UTC(2026, 10, 5, 0, 0, 0)
const DAY = 86_400_000
const CREATIVE = { name: 'EN', primaryText: 'Hello', headline: 'Sign up', imageHash: 'h1' }

function set(name: string, dailyBudget: number): AdDraftAdSet {
  return { name, dailyBudget, geoCountries: ['NZ'], ageMin: 35, ageMax: 65, creatives: [{ ...CREATIVE, name: `${name} 广告` }] }
}

const DRAFT: AdDraft = {
  kind: 'lead_form', clientId: 'c1', campaignName: '实验臂2', adSetName: '', dailyBudget: 30, durationDays: 14,
  geoCountries: [], pageId: 'p1', leadFormId: 'f1', creatives: [], budgetMode: 'ad_set',
  campaignSpendCapMinor: 42000,
  adSets: [set('组b', 9.5), set('组c', 10), set('组d', 10.5)],
}

/** 一个组读回来「全对」的样子；overrides 逐项改坏。 */
function goodSet(i: number, over: Partial<SetReadback['adSet']> = {}, ads?: SetReadback['ads']): SetReadback {
  const view = adSetViews(DRAFT)[i]
  return {
    view,
    adSetId: `as${i + 1}`,
    adSet: {
      id: `as${i + 1}`, name: view.adSetName, status: 'PAUSED',
      daily_budget: String(Math.round(view.dailyBudget * 100)),
      end_time: new Date(NOW + 14 * DAY).toISOString(),
      targeting: { age_min: 35, age_max: 65, geo_locations: { countries: ['NZ'] } },
      ...over,
    },
    ads: ads ?? [{ adId: `ad${i + 1}`, adName: `${view.adSetName} 广告`, status: 'PAUSED', texts: ['Hello'], leadFormId: 'f1' }],
  }
}

function good(over: Partial<MultiReadback> = {}): MultiReadback {
  return {
    campaign: { status: 'PAUSED', spendCap: '42000' },
    sets: [goodSet(0), goodSet(1), goodSet(2)],
    ...over,
  }
}

const codes = (rb: MultiReadback, draft: AdDraft = DRAFT) => checkMultiCreated(draft, rb, NOW).map((f) => f.code)

describe('checkMultiCreated — 全对时不出任何 blocker', () => {
  it('系列、3 个组、3 条广告都对 → 空', () => {
    expect(checkMultiCreated(DRAFT, good(), NOW)).toEqual([])
  })
})

describe('checkMultiCreated — 暂停', () => {
  it('系列不是暂停（或读不到）→ not_paused', () => {
    expect(codes(good({ campaign: { status: 'ACTIVE', spendCap: '42000' } }))).toContain('not_paused')
    expect(codes(good({ campaign: { status: null, spendCap: '42000' } }))).toContain('not_paused')
  })
  it('第 2 个组不是暂停 → not_paused，并且点名是哪个组', () => {
    const rb = good({ sets: [goodSet(0), goodSet(1, { status: 'ACTIVE' }), goodSet(2)] })
    const f = checkMultiCreated(DRAFT, rb, NOW).filter((x) => x.code === 'not_paused')
    expect(f).toHaveLength(1)
    expect(f[0].message).toContain('组c')
  })
  it('某条广告不是暂停（或读不到）→ not_paused', () => {
    const ads = [{ adId: 'ad3', adName: '组d 广告', status: 'ACTIVE', texts: ['Hello'], leadFormId: 'f1' }]
    expect(codes(good({ sets: [goodSet(0), goodSet(1), goodSet(2, {}, ads)] }))).toContain('not_paused')
    const unread = [{ adId: 'ad3', adName: '组d 广告', texts: ['Hello'], leadFormId: 'f1' }]
    expect(codes(good({ sets: [goodSet(0), goodSet(1), goodSet(2, {}, unread)] }))).toContain('not_paused')
  })
})

describe('checkMultiCreated — 每个组的日预算', () => {
  it('某个组的预算和草稿不一样 → adset_budget_mismatch', () => {
    const rb = good({ sets: [goodSet(0), goodSet(1, { daily_budget: '1100' }), goodSet(2)] })
    expect(codes(rb)).toEqual(['adset_budget_mismatch'])
  })
  it('预算读不到（缺失 / 不是数字）→ adset_budget_mismatch，不能当没问题', () => {
    expect(codes(good({ sets: [goodSet(0, { daily_budget: undefined }), goodSet(1), goodSet(2)] }))).toContain('adset_budget_mismatch')
    expect(codes(good({ sets: [goodSet(0, { daily_budget: 'abc' }), goodSet(1), goodSet(2)] }))).toContain('adset_budget_mismatch')
  })
})

describe('checkMultiCreated — 结束时间', () => {
  it('没有结束时间 → adset_end_time_mismatch', () => {
    expect(codes(good({ sets: [goodSet(0, { end_time: undefined }), goodSet(1), goodSet(2)] }))).toEqual(['adset_end_time_mismatch'])
  })
  it('结束时间和「现在 + 天数」差超过一天 → adset_end_time_mismatch；差在一天内放行', () => {
    const far = new Date(NOW + 20 * DAY).toISOString()
    expect(codes(good({ sets: [goodSet(0, { end_time: far }), goodSet(1), goodSet(2)] }))).toEqual(['adset_end_time_mismatch'])
    const near = new Date(NOW + 14 * DAY + 3600_000).toISOString()
    expect(codes(good({ sets: [goodSet(0, { end_time: near }), goodSet(1), goodSet(2)] }))).toEqual([])
  })
})

describe('checkMultiCreated — 定向（年龄 / 国家）', () => {
  it('年龄下限不是草稿写的 35 → adset_targeting_mismatch', () => {
    const t = { age_min: 25, age_max: 65, geo_locations: { countries: ['NZ'] } }
    expect(codes(good({ sets: [goodSet(0, { targeting: t }), goodSet(1), goodSet(2)] }))).toEqual(['adset_targeting_mismatch'])
  })
  it('年龄读不到 → adset_targeting_mismatch', () => {
    const t = { geo_locations: { countries: ['NZ'] } }
    expect(codes(good({ sets: [goodSet(0, { targeting: t }), goodSet(1), goodSet(2)] }))).toEqual(['adset_targeting_mismatch'])
  })
  it('国家对不上 → adset_targeting_mismatch', () => {
    const t = { age_min: 35, age_max: 65, geo_locations: { countries: ['AU'] } }
    expect(codes(good({ sets: [goodSet(0), goodSet(1), goodSet(2, { targeting: t })] }))).toEqual(['adset_targeting_mismatch'])
  })
})

describe('checkMultiCreated — 广告条数和表单', () => {
  it('某个组少了一条广告 → ad_count_mismatch', () => {
    expect(codes(good({ sets: [goodSet(0), goodSet(1, {}, []), goodSet(2)] }))).toContain('ad_count_mismatch')
  })
  it('广告挂的表单和草稿不是同一个 → ad_form_mismatch（blocker）', () => {
    const ads = [{ adId: 'ad1', adName: '组b 广告', status: 'PAUSED', texts: ['Hello'], leadFormId: 'other' }]
    const f = checkMultiCreated(DRAFT, good({ sets: [goodSet(0, {}, ads), goodSet(1), goodSet(2)] }), NOW)
    expect(f.map((x) => x.code)).toEqual(['ad_form_mismatch'])
    expect(f[0].severity).toBe('blocker')
  })
  it('回读里看不到表单编号 → 只是提醒（warn），不拦', () => {
    const ads = [{ adId: 'ad1', adName: '组b 广告', status: 'PAUSED', texts: ['Hello'] }]
    const f = checkMultiCreated(DRAFT, good({ sets: [goodSet(0, {}, ads), goodSet(1), goodSet(2)] }), NOW)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ code: 'ad_form_unreadable', severity: 'warn' })
  })
})

describe('checkMultiCreated — 视频留资：表单编号读不到就拦', () => {
  const VIDEO_DRAFT: AdDraft = {
    ...DRAFT,
    adSets: DRAFT.adSets!.map((s) => ({
      ...s,
      creatives: s.creatives.map((c) => ({ ...c, imageHash: undefined, videoId: 'v1', thumbnailUrl: 'https://img.example/t.jpg' })),
    })),
  }
  const videoSet = (i: number, ads?: SetReadback['ads']): SetReadback => ({ ...goodSet(i, {}, ads), view: adSetViews(VIDEO_DRAFT)[i] })
  const noForm = [{ adId: 'ad1', adName: '组b 广告', status: 'PAUSED', texts: ['Hello'] }]

  it('视频留资 + 回读里看不到表单编号 → ad_form_unreadable 是 blocker', () => {
    const f = checkMultiCreated(VIDEO_DRAFT, good({ sets: [videoSet(0, noForm), videoSet(1), videoSet(2)] }), NOW)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ code: 'ad_form_unreadable', severity: 'blocker' })
  })

  it('视频留资 + 表单编号读得到且一致 → 空', () => {
    expect(checkMultiCreated(VIDEO_DRAFT, good({ sets: [videoSet(0), videoSet(1), videoSet(2)] }), NOW)).toEqual([])
  })

  it('表单编号对不上：不管图片还是视频一律 blocker', () => {
    const wrong = [{ adId: 'ad1', adName: '组b 广告', status: 'PAUSED', texts: ['Hello'], leadFormId: 'other' }]
    const f = checkMultiCreated(VIDEO_DRAFT, good({ sets: [videoSet(0, wrong), videoSet(1), videoSet(2)] }), NOW)
    expect(f.map((x) => `${x.code}:${x.severity}`)).toEqual(['ad_form_mismatch:blocker'])
  })
})

describe('checkMultiCreated — 系列花费上限', () => {
  it('回读到的上限和草稿不一样 → spend_cap_mismatch', () => {
    expect(codes(good({ campaign: { status: 'PAUSED', spendCap: '0' } }))).toEqual(['spend_cap_mismatch'])
    expect(codes(good({ campaign: { status: 'PAUSED', spendCap: null } }))).toEqual(['spend_cap_mismatch'])
  })
  it('草稿没写上限 → 不核这一项', () => {
    const noCap: AdDraft = { ...DRAFT, campaignSpendCapMinor: undefined }
    expect(codes(good({ campaign: { status: 'PAUSED', spendCap: null } }), noCap)).toEqual([])
  })
})

describe('mergeMultiReports', () => {
  const report = (safe: boolean, message?: string): LaunchReadbackReport => ({
    findings: message ? [{ code: 'x', severity: safe ? 'warn' : 'blocker', message, learnedFrom: 't' }] : [],
    safeToActivate: safe,
    buyerWillSee: [{ adName: '广告', lines: ['Hello'] }],
  })

  it('每个组的发现带上组名；任何一个组不安全，整份就不安全', () => {
    const m = mergeMultiReports([{ setName: '组b', report: report(true) }, { setName: '组c', report: report(false, '坏了') }], [])
    expect(m.safeToActivate).toBe(false)
    expect(m.findings[0].message).toBe('【组c】坏了')
    expect(m.buyerWillSee.map((b) => b.adName)).toEqual(['【组b】广告', '【组c】广告'])
  })
  it('各组都安全但额外核对里有 blocker → 不安全；只有 warn → 仍安全', () => {
    const blockerF = { code: 'not_paused', severity: 'blocker' as const, message: 'm', learnedFrom: 't' }
    const warnF = { code: 'ad_form_unreadable', severity: 'warn' as const, message: 'm', learnedFrom: 't' }
    expect(mergeMultiReports([{ setName: '组b', report: report(true) }], [blockerF]).safeToActivate).toBe(false)
    expect(mergeMultiReports([{ setName: '组b', report: report(true) }], [warnF]).safeToActivate).toBe(true)
  })
})

describe('fetchMultiReadback — 读不全就是 null', () => {
  beforeEach(() => {
    vi.mocked(fetchCampaignReadback).mockResolvedValue({ status: 'PAUSED', spendCap: '42000' })
    vi.mocked(fetchAdSetReadback).mockImplementation(async (id) => ({ id }))
    vi.mocked(fetchAdCreativesReadback).mockResolvedValue([])
  })

  it('全读到 → 每个组一份，按草稿顺序', async () => {
    const rb = await fetchMultiReadback(DRAFT, { campaignId: 'camp1', adSetIds: ['as1', 'as2', 'as3'] }, 'tok')
    expect(rb?.sets.map((s) => s.adSetId)).toEqual(['as1', 'as2', 'as3'])
    expect(rb?.sets.map((s) => s.view.adSetName)).toEqual(['组b', '组c', '组d'])
  })
  it('某个组读不到 → null', async () => {
    vi.mocked(fetchAdSetReadback).mockImplementation(async (id) => (id === 'as2' ? null : { id }))
    expect(await fetchMultiReadback(DRAFT, { campaignId: 'camp1', adSetIds: ['as1', 'as2', 'as3'] }, 'tok')).toBeNull()
  })
  it('系列读不到 → null', async () => {
    vi.mocked(fetchCampaignReadback).mockResolvedValue(null)
    expect(await fetchMultiReadback(DRAFT, { campaignId: 'camp1', adSetIds: ['as1', 'as2', 'as3'] }, 'tok')).toBeNull()
  })
  it('建出来的组数和草稿对不上 → null（不去猜哪个是哪个）', async () => {
    expect(await fetchMultiReadback(DRAFT, { campaignId: 'camp1', adSetIds: ['as1', 'as2'] }, 'tok')).toBeNull()
  })
})

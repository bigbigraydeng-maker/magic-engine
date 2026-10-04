/**
 * 建广告的测试。
 *
 * 守的第一条、也是最重要的一条：**建出来的一律是暂停的**。
 * 这条一旦破了，ME 就能自己让客户的钱开始流出去 —— 整个「人点头才花钱」的
 * 设计就作废了，而且从数据上完全看不出来（广告跑得好好的）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishDraftPaused, activatePublished, audienceAutomationFor } from '../ad-publisher'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

const DRAFT: AdDraft = {
  kind: 'lead_form',
  clientId: 'c1',
  campaignName: 'Kiteroa 留资',
  adSetName: 'North Shore 买家',
  dailyBudget: 30,
  durationDays: 7,
  geoCountries: ['NZ'],
  pageId: 'p1',
  leadFormId: 'f1',
  linkUrl: 'https://example.co.nz',
  creatives: [
    { name: 'EN', primaryText: 'Brand new home', headline: 'Book a viewing', imageHash: 'h1' },
  ],
}

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

/** 记下每次调用，并按 url 决定返回什么。 */
function mockGraph(fail?: { onPath: string }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (fail && url.includes(fail.onPath) && init?.method === 'POST') {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"nope"}}' } as Response
    }
    if (init?.method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
    const id = url.includes('/campaigns') ? 'camp1'
      : url.includes('/adsets') ? 'as1'
      : url.includes('/adcreatives') ? 'cr1'
      : 'ad1'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('publishDraftPaused — 建出来的一律暂停', () => {
  it('系列 / 组 / 广告三层的 status 全是 PAUSED', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)

    const statuses = calls
      .filter((c) => c.method === 'POST' && c.body.has('status'))
      .map((c) => c.body.get('status'))
    expect(statuses.length).toBeGreaterThanOrEqual(3)
    expect(statuses.every((s) => s === 'PAUSED')).toBe(true)
    expect(statuses).not.toContain('ACTIVE')
  })

  it('预算按分传 —— 传元会变成 1/100 的钱，静默跑不出量', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const adset = calls.find((c) => c.url.includes('/adsets'))!
    expect(adset.body.get('daily_budget')).toBe('3000')
  })

  it('留资广告带上表单 id 和 ON_AD 落点（不把人带进私信）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const adset = calls.find((c) => c.url.includes('/adsets'))!
    expect(adset.body.get('destination_type')).toBe('ON_AD')
    const creative = calls.find((c) => c.url.includes('/adcreatives'))!
    expect(creative.body.get('object_story_spec')).toContain('f1')
  })

  it('视频广告走 ON_VIDEO —— 少了它 Meta 不按完播优化', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      { ...DRAFT, kind: 'video_thruplay', creatives: [
        { name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' },
      ] },
      'act_1', 'tok',
    )
    expect(calls.find((c) => c.url.includes('/adsets'))!.body.get('destination_type'))
      .toBe('ON_VIDEO')
  })

  it('有终点：end_time 必给，且晚于 start_time', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const b = calls.find((c) => c.url.includes('/adsets'))!.body
    expect(Number(b.get('end_time'))).toBeGreaterThan(Number(b.get('start_time')))
  })
})

describe('targetingFor — 城市和国家不能同时给（2026-08-04 事故：北岸的房投给了整个新西兰）', () => {
  it('给了城市 → geo_locations 只有 cities，不带 countries（Meta 按并集生效，两个都给等于城市半径形同虚设）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      { ...DRAFT, geoCountries: ['NZ'], geoCityKeys: ['2450022'] },
      'act_1', 'tok',
    )
    const geo = JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)
      .geo_locations
    expect(geo.cities).toEqual([{ key: '2450022', radius: 10, distance_unit: 'kilometer' }])
    expect(geo.countries).toBeUndefined()
  })

  it('没给城市 → geo_locations 退回国家（全国投放本来就是本意时，这条路径不受影响）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...DRAFT, geoCountries: ['NZ'], geoCityKeys: undefined }, 'act_1', 'tok')
    const geo = JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)
      .geo_locations
    expect(geo.countries).toEqual(['NZ'])
    expect(geo.cities).toBeUndefined()
  })

  it('城市数组给了但是空的 → 仍按国家算（空数组不是「有城市」）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...DRAFT, geoCountries: ['NZ'], geoCityKeys: [] }, 'act_1', 'tok')
    const geo = JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)
      .geo_locations
    expect(geo.countries).toEqual(['NZ'])
    expect(geo.cities).toBeUndefined()
  })
})

describe('audienceAutomationFor — [AD-ADV-1] 按打法显式传 Advantage+，不再无差别关闭', () => {
  it('冷启动（cold）→ advantage_audience=1，让 Meta 自动扩量找人', () => {
    const targeting = audienceAutomationFor('cold')
    expect(targeting.targeting_automation).toEqual({ advantage_audience: 1 })
  })

  it('再营销（warm_retarget）→ advantage_audience=0 且名单外扩展也显式关掉', () => {
    // 目前两种 DraftKind 都是冷启动，还没有真实的 warm_retarget 打法——
    // 这里直接测受众模式 → Meta 参数这条纯函数分支，不用等真的加出第三种草案类型。
    const targeting = audienceAutomationFor('warm_retarget')
    expect(targeting.targeting_automation).toEqual({ advantage_audience: 0 })
    expect(targeting.targeting_relaxation_types).toEqual({ custom_audience: 0 })
  })
})

describe('publishDraftPaused — [AD-ADV-1] 冷启动打法建出来的 targeting 显式带 advantage_audience=1', () => {
  it('留资广告（lead_form）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const targeting = JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)
    expect(targeting.targeting_automation).toEqual({ advantage_audience: 1 })
  })

  it('视频完播广告（video_thruplay）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      { ...DRAFT, kind: 'video_thruplay', creatives: [
        { name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' },
      ] },
      'act_1', 'tok',
    )
    const targeting = JSON.parse(calls.find((c) => c.url.includes('/adsets'))!.body.get('targeting')!)
    expect(targeting.targeting_automation).toEqual({ advantage_audience: 1 })
  })
})

describe('publishDraftPaused — 建到一半失败要收拾干净', () => {
  it('建组失败 → 把已建的系列删掉，不留半成品', async () => {
    vi.stubGlobal('fetch', mockGraph({ onPath: '/adsets' }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.step).toBe('adset')
    expect(r.orphans).toEqual([])
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('camp1'))).toBe(true)
  })

  it('删不掉的如实报出来，不假装干净', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams() })
      if (init?.method === 'DELETE') return { ok: false, status: 400, text: async () => '' } as Response
      if (url.includes('/adsets')) return { ok: false, status: 400, text: async () => 'x' } as Response
      return { ok: true, status: 200, text: async () => '{"id":"camp1"}' } as Response
    }))
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.orphans).toEqual(['camp1'])
  })
})

describe('activatePublished — 三层都要开', () => {
  it('广告 / 组 / 系列全部改成 ACTIVE（只开一层等于没开）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams(String(init?.body ?? '')) })
      // Meta 改状态回的是 {"success":true}，没有 id —— 当成失败就是个 bug。
      return { ok: true, status: 200, text: async () => '{"success":true}' } as Response
    }))
    const r = await activatePublished(
      { campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1', 'ad2'] }, 'tok',
    )
    expect(r.ok).toBe(true)
    const touched = calls.map((c) => c.url.split('/').pop()!.split('?')[0])
    expect(touched).toEqual(expect.arrayContaining(['ad1', 'ad2', 'as1', 'camp1']))
    expect(calls.every((c) => c.body.get('status') === 'ACTIVE')).toBe(true)
  })

  it('中间一层失败 → 如实返回失败，不吞', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('as1')
        ? ({ ok: false, status: 400, text: async () => 'boom' } as Response)
        : ({ ok: true, status: 200, text: async () => '{"success":true}' } as Response),
    ))
    const r = await activatePublished(
      { campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'] }, 'tok',
    )
    expect(r.ok).toBe(false)
  })
})

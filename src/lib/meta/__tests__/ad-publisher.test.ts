/**
 * 建广告的测试。
 *
 * 守的第一条、也是最重要的一条：**建出来的一律是暂停的**。
 * 这条一旦破了，ME 就能自己让客户的钱开始流出去 —— 整个「人点头才花钱」的
 * 设计就作废了，而且从数据上完全看不出来（广告跑得好好的）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishDraftPaused, activatePublished, pausePublished } from '../ad-publisher'
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

describe('整体请求体快照（防多发/改字段）', () => {
  it('系列请求体逐字段固定', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const b = calls.find((c) => c.url.includes('/campaigns') && c.method === 'POST')!.body
    const o = Object.fromEntries(b.entries()); delete o.access_token
    expect(o).toEqual({
      name: 'Kiteroa 留资', objective: 'OUTCOME_LEADS', status: 'PAUSED',
      special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false',
    })
  })

  it('广告组请求体：字段集合固定（start/end 时间单独测）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const b = calls.find((c) => c.url.includes('/adsets') && c.method === 'POST')!.body
    const o = Object.fromEntries(b.entries()); delete o.access_token
    expect(Object.keys(o).sort()).toEqual([
      'bid_strategy', 'billing_event', 'campaign_id', 'daily_budget', 'destination_type', 'end_time',
      'name', 'optimization_goal', 'promoted_object', 'start_time', 'status', 'targeting',
    ])
    expect(o.daily_budget).toBe('3000')
    expect(o.bid_strategy).toBe('LOWEST_COST_WITHOUT_CAP')
  })
})

describe('建系列必须声明 is_adset_budget_sharing_enabled（2026-10-26 试跑撞上 Meta 100/4834011）', () => {
  it('系列请求带 is_adset_budget_sharing_enabled=false，且仍是 PAUSED', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const camp = calls.find((c) => c.url.includes('/campaigns') && c.method === 'POST')!
    expect(camp.body.get('is_adset_budget_sharing_enabled')).toBe('false')
    expect(camp.body.get('status')).toBe('PAUSED')
  })
})

describe('建组必须声明竞价策略（2026-10-26 试跑第二次撞上 Meta 100/2490487）', () => {
  it('广告组请求带 bid_strategy=LOWEST_COST_WITHOUT_CAP 且不带 bid_amount，仍是 PAUSED', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const as = calls.find((c) => c.url.includes('/adsets') && c.method === 'POST')!
    expect(as.body.get('bid_strategy')).toBe('LOWEST_COST_WITHOUT_CAP')
    expect(as.body.has('bid_amount')).toBe(false)
    expect(as.body.get('status')).toBe('PAUSED')
  })
})

describe('lead_form 视频创意写法（实测过审的 video_data）', () => {
  const VID: AdDraft = {
    ...DRAFT,
    creatives: [{ name: 'V', primaryText: 'Tour text', headline: 'Sign up', description: 'desc', videoId: 'v9', thumbnailImageHash: 'th9' }],
  }

  it('带视频 → video_data（封面 + SIGN_UP + 表单 id），绝不再把 video_id 塞进 link_data', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(VID, 'act_1', 'tok')
    const spec = JSON.parse(calls.find((c) => c.url.includes('/adcreatives'))!.body.get('object_story_spec')!)
    expect(spec.link_data).toBeUndefined()
    expect(spec.video_data).toEqual({
      video_id: 'v9',
      message: 'Tour text',
      title: 'Sign up',
      link_description: 'desc',
      image_hash: 'th9',
      call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: 'f1' } },
    })
  })

  it('只给图 → 仍然是 link_data（老写法不变）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    const spec = JSON.parse(calls.find((c) => c.url.includes('/adcreatives'))!.body.get('object_story_spec')!)
    expect(spec.video_data).toBeUndefined()
    expect(spec.link_data.image_hash).toBe('h1')
    expect(spec.link_data.link).toBe('https://fb.me/')
    expect(spec.link_data.message).toBe('Brand new home')
    expect(spec.link_data.name).toBe('Book a viewing')
    expect(spec.link_data.video_id).toBeUndefined()
    expect(spec.link_data.call_to_action).toEqual({ type: 'SIGN_UP', value: { lead_gen_form_id: 'f1' } })
  })
})

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

  it('视频养受众（THRUPLAY）不发 destination_type（ON_VIDEO 是 limited beta、无实测过审记录）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      { ...DRAFT, kind: 'video_thruplay', creatives: [
        { name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' },
      ] },
      'act_1', 'tok',
    )
    expect(calls.find((c) => c.url.includes('/adsets'))!.body.has('destination_type')).toBe(false)
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

// ─────────────────────────────────────────────────────────────────────────────
// 私信（点击后进 Messenger 对话）类型
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
    {
      name: 'DM ad', primaryText: 'Join our Christmas tour', headline: 'Message us',
      description: 'Ask us anything', videoId: 'v1', thumbnailImageHash: 'th1', language: 'en',
    },
  ],
}

const bodyOf = (path: string) => calls.find((c) => c.url.includes(path))!.body

describe('publishDraftPaused — 私信类型的四步参数', () => {
  it('系列：互动目标 + 暂停', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MSG, 'act_1', 'tok')
    const b = bodyOf('/campaigns')
    expect(b.get('objective')).toBe('OUTCOME_ENGAGEMENT')
    expect(b.get('status')).toBe('PAUSED')
  })

  it('广告组：对话优化 + 落点 Messenger + 只带主页', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MSG, 'act_1', 'tok')
    const b = bodyOf('/adsets')
    expect(b.get('optimization_goal')).toBe('CONVERSATIONS')
    expect(b.get('destination_type')).toBe('MESSENGER')
    expect(b.get('billing_event')).toBe('IMPRESSIONS')
    expect(JSON.parse(b.get('promoted_object')!)).toEqual({ page_id: 'p1' })
    expect(b.get('daily_budget')).toBe('2000')
  })

  it('创意：视频 + 缩略图 hash + 发送消息按钮(app_destination)', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MSG, 'act_1', 'tok')
    const spec = JSON.parse(bodyOf('/adcreatives').get('object_story_spec')!)
    expect(spec.page_id).toBe('p1')
    expect(spec.video_data).toEqual({
      video_id: 'v1',
      message: 'Join our Christmas tour',
      title: 'Message us',
      link_description: 'Ask us anything',
      image_hash: 'th1',
      call_to_action: { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } },
    })
  })

  it('🔴 创意里不能出现任何 link（D13：接口建私信素材带 messenger_doc 链接会被 Meta 当场拒）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(MSG, 'act_1', 'tok')
    const raw = bodyOf('/adcreatives').get('object_story_spec')!
    expect(raw).not.toContain('"link"')
    expect(raw).not.toContain('messenger_doc')
    expect(raw).not.toContain('lead_gen_form_id')
  })

  it('缩略图：同时给了 hash 和链接 → 只传 hash；只有链接 → 传 image_url', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const mk = (c: object) => ({ ...MSG, creatives: [{ ...MSG.creatives[0], thumbnailImageHash: undefined, ...c }] })
    await publishDraftPaused(mk({ thumbnailImageHash: 'H', thumbnailUrl: 'https://a.test/t.jpg' }), 'act_1', 'tok')
    let vd = JSON.parse(bodyOf('/adcreatives').get('object_story_spec')!).video_data
    expect(vd.image_hash).toBe('H')
    expect(vd.image_url).toBeUndefined()

    calls = []
    await publishDraftPaused(mk({ thumbnailUrl: 'https://a.test/t.jpg' }), 'act_1', 'tok')
    vd = JSON.parse(bodyOf('/adcreatives').get('object_story_spec')!).video_data
    expect(vd.image_url).toBe('https://a.test/t.jpg')
    expect(vd.image_hash).toBeUndefined()
  })

  it('全程 PAUSED：每一个带 status 的写请求都是 PAUSED，整个过程没有 ACTIVE', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(
      { ...MSG, creatives: [MSG.creatives[0], { ...MSG.creatives[0], name: 'DM ad 2' }] }, 'act_1', 'tok',
    )
    expect(r.ok).toBe(true)
    const withStatus = calls.filter((c) => c.method === 'POST' && c.body.has('status'))
    expect(withStatus).toHaveLength(4) // 系列 + 组 + 2 条广告
    expect(withStatus.every((c) => c.body.get('status') === 'PAUSED')).toBe(true)
    expect(calls.some((c) => [...c.body.values()].some((v) => v.includes('ACTIVE')))).toBe(false)
  })

  it('每次写请求都带超时信号（卡死不能把整个请求拖过平台的超时线）', async () => {
    const seen: (AbortSignal | null | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(init?.signal)
      const id = url.includes('/campaigns') ? 'camp1' : url.includes('/adsets') ? 'as1' : url.includes('/adcreatives') ? 'cr1' : 'ad1'
      return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
    }))
    await publishDraftPaused(MSG, 'act_1', 'tok')
    expect(seen).toHaveLength(4)
    expect(seen.every((s) => s instanceof AbortSignal)).toBe(true)
  })

  it('陌生类型直接抛，不静默建成别的东西', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await expect(publishDraftPaused({ ...MSG, kind: 'nope' as never }, 'act_1', 'tok')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

describe('publishDraftPaused — 私信类型失败要收拾干净', () => {
  it('创意被 Meta 拒（例如按钮类型不被接受）→ 先删广告组再删系列，orphans 为空', async () => {
    vi.stubGlobal('fetch', mockGraph({ onPath: '/adcreatives' }))
    const r = await publishDraftPaused(MSG, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.step).toBe('creative')
    expect(r.orphans).toEqual([])
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => (c.url.includes('as1') ? 'as1' : 'camp1'))
    expect(deletes).toEqual(['as1', 'camp1']) // 逆序
  })

  it('第二条创意失败 → 第一条已建的创意 / 广告也要一起删', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams(String(init?.body ?? '')) })
      if (init?.method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
      if (url.includes('/adcreatives') && ++n === 2) {
        return { ok: false, status: 400, text: async () => 'nope' } as Response
      }
      const id = url.includes('/campaigns') ? 'camp1' : url.includes('/adsets') ? 'as1'
        : url.includes('/adcreatives') ? 'cr1' : 'ad1'
      return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
    }))
    const r = await publishDraftPaused(
      { ...MSG, creatives: [MSG.creatives[0], { ...MSG.creatives[0], name: 'second' }] }, 'act_1', 'tok',
    )
    expect(r.ok).toBe(false)
    const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop()!.split('?')[0])
    expect(deleted).toEqual(['ad1', 'cr1', 'as1', 'camp1'])
  })

  it('请求超时 / 断网（不知道 Meta 建成没有）→ 回滚已建的，并把名字记进 orphans', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams() })
      if (init?.method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
      if (url.includes('/adsets')) throw new Error('The operation was aborted due to timeout')
      return { ok: true, status: 200, text: async () => '{"id":"camp1"}' } as Response
    }))
    const r = await publishDraftPaused(MSG, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.orphans).toHaveLength(1)
    expect(r.orphans[0]).toContain('未确认是否已建成')
    expect(r.orphans[0]).toContain('DM set')
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('camp1'))).toBe(true)
  })

  it('网关超时(HTTP 502/504)可能是 Meta 建成之后才超时 → 也算「可能已建成」', async () => {
    for (const status of [502, 504]) {
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
        if (url.includes('/adsets')) return { ok: false, status, text: async () => 'gateway timeout' } as Response
        return { ok: true, status: 200, text: async () => '{"id":"camp1"}' } as Response
      }))
      const r = await publishDraftPaused(MSG, 'act_1', 'tok')
      expect(r.ok, String(status)).toBe(false)
      if (!r.ok) expect(r.orphans.join(' ')).toContain('未确认是否已建成')
    }
  })

  it('Meta 明确拒绝（HTTP 400）不算「可能已建成」，不往 orphans 里写名字', async () => {
    vi.stubGlobal('fetch', mockGraph({ onPath: '/adsets' }))
    const r = await publishDraftPaused(MSG, 'act_1', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.orphans).toEqual([])
  })
})

describe('publishDraftPaused — 时间预算', () => {
  it('过了 stopWritingAt → 一次写都不发，直接失败', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(MSG, 'act_1', 'tok', { stopWritingAt: 1_000, now: () => 5_000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('时间')
    expect(calls).toHaveLength(0)
  })

  it('建到一半时间到 → 停手并回滚已建的', async () => {
    vi.stubGlobal('fetch', mockGraph())
    let t = 0
    const now = () => (t += 40) // 每次取一次时间就走 40ms
    const r = await publishDraftPaused(MSG, 'act_1', 'tok', { stopWritingAt: 100, now })
    expect(r.ok).toBe(false)
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/campaigns'))).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/adcreatives'))).toBe(false)
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('camp1'))).toBe(true)
  })

  it('回滚也有期限：过了 giveUpRollbackAt 就不再删，没删的全部如实进 orphans', async () => {
    vi.stubGlobal('fetch', mockGraph({ onPath: '/adsets' }))
    const r = await publishDraftPaused(MSG, 'act_1', 'tok', { giveUpRollbackAt: 1, now: () => 1_000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.orphans).toEqual(['camp1'])
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('不给预算 → 现有行为不变（不限时）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(r.ok).toBe(true)
  })
})

describe('pausePublished — 回读发现不是暂停时补一刀', () => {
  it('三层同时发(不是一个等一个)：止损要快', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { ok: true, status: 200, text: async () => '{"success":true}' } as Response
    }))
    await pausePublished({ campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1', 'ad2'] }, 'tok')
    expect(peak).toBe(4)
  })

  it('广告 / 组 / 系列三层都改成 PAUSED', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams(String(init?.body ?? '')) })
      return { ok: true, status: 200, text: async () => '{"success":true}' } as Response
    }))
    const r = await pausePublished({ campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1', 'ad2'] }, 'tok')
    expect(r).toEqual({ ok: true, failed: [] })
    expect(calls.map((c) => c.url.split('/').pop()!.split('?')[0])).toEqual(['ad1', 'ad2', 'as1', 'camp1'])
    expect(calls.every((c) => c.body.get('status') === 'PAUSED')).toBe(true)
  })

  it('有期限：过了 deadlineAt 就不再试，没来得及的如实报出来（补暂停不能把整次请求拖过超时线）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams() })
      return { ok: true, status: 200, text: async () => '{"success":true}' } as Response
    }))
    let t = 0
    const r = await pausePublished(
      { campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'] }, 'tok',
      { deadlineAt: 100, now: () => (t += 60) }, // 第 1 次取 60 ≤ 100 过，之后都超
    )
    expect(calls).toHaveLength(1)
    expect(r.ok).toBe(false)
    expect(r.failed).toHaveLength(2)
    expect(r.failed.join(' ')).toContain('没来得及')
  })

  it('一层失败不影响其它层继续试，失败的如实返回', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: new URLSearchParams() })
      return url.includes('as1')
        ? ({ ok: false, status: 400, text: async () => 'boom' } as Response)
        : ({ ok: true, status: 200, text: async () => '{"success":true}' } as Response)
    }))
    const r = await pausePublished({ campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'] }, 'tok')
    expect(r.ok).toBe(false)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('as1')
    expect(calls).toHaveLength(3) // 失败了也继续试系列
  })
})

describe('targetingFor — 自定义受众（包含 / 排除）', () => {
  const targetingOf = () =>
    JSON.parse(calls.find((c) => c.url.includes('/adsets') && c.method === 'POST')!.body.get('targeting')!)

  it('有包含受众 → custom_audiences + 关掉受众扩展', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...DRAFT, audienceIds: ['1111111', '2222222'] }, 'act_1', 'tok')
    const t = targetingOf()
    expect(t.custom_audiences).toEqual([{ id: '1111111' }, { id: '2222222' }])
    expect(t.targeting_relaxation_types).toEqual({ custom_audience: 0, lookalike: 0 })
    expect(t.excluded_custom_audiences).toBeUndefined()
  })

  it('有排除受众 → excluded_custom_audiences，不带包含受众也不带扩展开关', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused({ ...DRAFT, excludedAudienceIds: ['3333333'] }, 'act_1', 'tok')
    const t = targetingOf()
    expect(t.excluded_custom_audiences).toEqual([{ id: '3333333' }])
    expect(t.custom_audiences).toBeUndefined()
    expect(t.targeting_relaxation_types).toBeUndefined()
  })

  it('都没给（含空数组）→ 键集合不变，仍带 targeting_automation', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(DRAFT, 'act_1', 'tok')
    expect(Object.keys(targetingOf()).sort()).toEqual([
      'age_max', 'age_min', 'geo_locations', 'targeting_automation',
    ])
    expect(targetingOf().targeting_automation).toEqual({ advantage_audience: 0 })

    calls = []
    await publishDraftPaused({
      ...DRAFT,
      expansion: {
        advantageAudience: true,
        customAudienceRelaxed: false,
        lookalikeRelaxed: false,
        source: 'ad-agent:default-advantage-plus',
      },
    }, 'act_1', 'tok')
    expect(targetingOf().targeting_automation).toEqual({ advantage_audience: 1 })

    calls = []
    await publishDraftPaused({ ...DRAFT, audienceIds: [], excludedAudienceIds: [] }, 'act_1', 'tok')
    expect(Object.keys(targetingOf()).sort()).toEqual([
      'age_max', 'age_min', 'geo_locations', 'targeting_automation',
    ])
    expect(targetingOf().targeting_automation).toEqual({ advantage_audience: 0 })
  })

  it('带受众时其余键不变，且系列 / 组 / 广告仍是 PAUSED', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      { ...DRAFT, audienceIds: ['1111111'], excludedAudienceIds: ['3333333'] },
      'act_1', 'tok',
    )
    const t = targetingOf()
    expect(Object.keys(t).sort()).toEqual([
      'age_max', 'age_min', 'custom_audiences', 'excluded_custom_audiences',
      'geo_locations', 'targeting_automation', 'targeting_relaxation_types',
    ])
    expect(t.targeting_automation).toEqual({ advantage_audience: 0 })

    const campaign = calls.find((c) => c.url.includes('/campaigns') && c.method === 'POST')!
    const adset = calls.find((c) => c.url.includes('/adsets') && c.method === 'POST')!
    const ad = calls.find((c) => c.url.includes('/ads') && c.method === 'POST')!
    expect(campaign.body.get('status')).toBe('PAUSED')
    expect(adset.body.get('status')).toBe('PAUSED')
    expect(ad.body.get('status')).toBe('PAUSED')

    // 受众路径也要守住前两次试跑撞出来的两条 Meta 规则
    expect(adset.body.get('bid_strategy')).toBe('LOWEST_COST_WITHOUT_CAP')
    expect(campaign.body.get('is_adset_budget_sharing_enabled')).toBe('false')
    expect([...adset.body.keys()].filter((k) => k !== 'access_token').sort()).toEqual([
      'bid_strategy', 'billing_event', 'campaign_id', 'daily_budget', 'destination_type', 'end_time',
      'name', 'optimization_goal', 'promoted_object', 'start_time', 'status', 'targeting',
    ])
  })

  it('视频养受众（video_thruplay）+ 受众：版位锁定与 custom_audiences / excluded_custom_audiences 并存', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      {
        ...DRAFT,
        kind: 'video_thruplay',
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }],
        audienceIds: ['1111111'],
        excludedAudienceIds: ['3333333'],
      },
      'act_1', 'tok',
    )
    expect(Object.keys(targetingOf()).sort()).toEqual([
      'age_max', 'age_min', 'custom_audiences', 'excluded_custom_audiences',
      'geo_locations', 'publisher_platforms', 'targeting_automation', 'targeting_relaxation_types',
    ])
    expect(targetingOf().custom_audiences).toEqual([{ id: '1111111' }])
    expect(targetingOf().excluded_custom_audiences).toEqual([{ id: '3333333' }])
    expect(Array.isArray(targetingOf().publisher_platforms)).toBe(true)
    expect(targetingOf().publisher_platforms.length).toBeGreaterThan(0)
    expect(targetingOf().targeting_automation).toEqual({ advantage_audience: 0 })
  })

  it('视频养受众只给排除受众：publisher_platforms 在、excluded_custom_audiences 在、没有 custom_audiences', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await publishDraftPaused(
      {
        ...DRAFT,
        kind: 'video_thruplay',
        creatives: [{ name: 'V', primaryText: 'x', headline: 'y', videoId: 'v1' }],
        excludedAudienceIds: ['3333333'],
      },
      'act_1', 'tok',
    )
    expect(Object.keys(targetingOf()).sort()).toEqual([
      'age_max', 'age_min', 'excluded_custom_audiences', 'geo_locations',
      'publisher_platforms', 'targeting_automation',
    ])
    expect(targetingOf().custom_audiences).toBeUndefined()
  })
})

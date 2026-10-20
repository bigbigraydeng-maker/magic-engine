/**
 * 按目标盯盘 · 读 Meta（只读）。用假的 fetch，不碰真网络。
 * 读一个系列的结构（广告组 / 广告 / 状态 / 最后修改时间）和三层洞察（整个系列 / 按广告组 / 按广告）。
 */
import { describe, expect, it, vi } from 'vitest'
import { parseMetricsRows, readSeriesFacts } from '../objective-watch-read'
import { makeGraphGet } from '../meta-reader'

const ACCOUNT = 'act_1234567890'
const CAMPAIGN = '555555555555'
const TOKEN = 'SECRET_TOKEN_VALUE_123'
const NOW = new Date('2026-10-20T19:00:00.000Z') // 新西兰 2026-10-21 08:00（UTC 还是 10-20：账户时区读错就会少一天）
const noSleep = async (): Promise<void> => {}

const MSG = 'onsite_conversion.messaging_conversation_started_7d'

const nodeBody = {
  id: CAMPAIGN, account_id: '1234567890', name: '测试系列', objective: 'OUTCOME_AWARENESS', status: 'ACTIVE', effective_status: 'ACTIVE',
  created_time: '2026-10-20T22:51:08+1300', updated_time: '2026-10-21T01:11:29+1300',
}
const adsetsBody = {
  data: [
    {
      id: '777000000001', name: '播放量 · v2', status: 'ACTIVE', effective_status: 'ACTIVE', updated_time: '2026-10-21T01:16:35+1300',
      start_time: '2026-10-21T01:16:00+1300', end_time: '2026-11-30T23:59:00+1300', destination_type: 'WHATSAPP',
    },
    { id: '777000000002', name: '播放量 · v1', status: 'PAUSED', effective_status: 'PAUSED', updated_time: '2026-10-21T01:15:09+1300' },
  ],
  paging: { cursors: { before: 'x', after: 'y' } },
}
const adsBody = {
  data: [
    { id: '888000000001', name: 'A2 价格悬念 · v2', adset_id: '777000000001', status: 'ACTIVE', effective_status: 'PENDING_REVIEW', updated_time: '2026-10-21T01:16:40+1300' },
  ],
}
const campaignInsights = {
  data: [{
    campaign_id: CAMPAIGN, campaign_name: '测试系列', spend: '12.40', impressions: '4000', reach: '3100', frequency: '1.29',
    video_thruplay_watched_actions: [{ action_type: 'video_view', value: '120' }],
    cost_per_thruplay: [{ action_type: 'video_view', value: '0.0517' }],
    actions: [{ action_type: 'video_view', value: '800' }],
  }],
}
const adsetInsights = {
  data: [{
    campaign_id: CAMPAIGN, adset_id: '777000000001', adset_name: '播放量 · v2', spend: '12.40', impressions: '4000', reach: '3100', frequency: '1.29',
    actions: [{ action_type: MSG, value: '5' }], cost_per_action_type: [{ action_type: MSG, value: '2.48' }],
  }],
}
const adInsights = {
  data: [{
    campaign_id: CAMPAIGN, adset_id: '777000000001', ad_id: '888000000001', ad_name: 'A2 价格悬念 · v2', spend: '12.40', impressions: '4000', reach: '3100', frequency: '1.29',
    video_thruplay_watched_actions: [{ action_type: 'video_view', value: '120' }],
  }],
}

type Route = (url: URL) => { status?: number; body: unknown }

function makeFetcher(overrides: Record<string, Route> = {}) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const routes: Record<string, Route> = {
    [ACCOUNT]: () => ({ body: { timezone_name: 'Pacific/Auckland', id: ACCOUNT } }),
    [CAMPAIGN]: () => ({ body: nodeBody }),
    [`${CAMPAIGN}/adsets`]: () => ({ body: adsetsBody }),
    [`${CAMPAIGN}/ads`]: () => ({ body: adsBody }),
    [`${CAMPAIGN}/insights`]: url => {
      const level = url.searchParams.get('level')
      return { body: level === 'campaign' ? campaignInsights : level === 'adset' ? adsetInsights : adInsights }
    },
    ...overrides,
  }
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, '')
    const route = routes[path]
    const out = route ? route(url) : { status: 404, body: { error: { message: `unexpected path ${path}`, code: 100 } } }
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  return { fetcher, calls }
}

const read = (fetcher: typeof fetch) =>
  readSeriesFacts({ adAccountId: ACCOUNT, campaignId: CAMPAIGN, token: TOKEN, fetcher, now: NOW, sleep: noSleep })

const pathOf = (u: URL): string => u.pathname.replace(/^\/v\d+\.\d+\//, '')

describe('readSeriesFacts · 读结构和三层洞察', () => {
  it('读到系列、广告组、广告（含状态和最后修改时间）和三层数字', async () => {
    const { fetcher } = makeFetcher()
    const out = await read(fetcher)
    expect(out.read).toBe(true)
    if (!out.read) return
    expect(out.campaign).toMatchObject({
      id: CAMPAIGN, objective: 'OUTCOME_AWARENESS', status: 'ACTIVE', effective_status: 'ACTIVE',
      created_at: '2026-10-20T09:51:08.000Z', updated_at: '2026-10-20T12:11:29.000Z',
    })
    expect(out.adsets.map(a => [a.id, a.effective_status])).toEqual([['777000000001', 'ACTIVE'], ['777000000002', 'PAUSED']])
    expect(out.adsets[0]).toMatchObject({ start_at: '2026-10-20T12:16:00.000Z', end_at: '2026-11-30T10:59:00.000Z', destination_type: 'WHATSAPP' })
    expect(out.adsets[1]).toMatchObject({ start_at: null, end_at: null, destination_type: null })
    expect(out.ads).toEqual([{
      id: '888000000001', name: 'A2 价格悬念 · v2', parent_id: '777000000001', status: 'ACTIVE',
      effective_status: 'PENDING_REVIEW', updated_at: '2026-10-20T12:16:40.000Z',
    }])
    expect(out.total).toMatchObject({
      id: CAMPAIGN, spend_cents: 1240, impressions: 4000, reach: 3100, frequency: 1.29, thruplays: 120, cost_per_thruplay: 0.0517,
    })
    expect(out.by_adset[0]).toMatchObject({ id: '777000000001', conversations: 5, cost_per_conversation: 2.48 })
    expect(out.by_ad[0]).toMatchObject({ id: '888000000001', name: 'A2 价格悬念 · v2', thruplays: 120 })
    expect(out.as_of).toBe(NOW.toISOString())
  })

  it('只发 GET、令牌只进 Authorization 头（不进网址）；洞察按创建日起、按账户时区算到今天，三层各读一次', async () => {
    const { fetcher, calls } = makeFetcher()
    await read(fetcher)
    expect(calls.every(c => (c.init?.method ?? 'GET') === 'GET')).toBe(true)
    expect(calls.every(c => (c.init?.headers as Record<string, string>).Authorization === `Bearer ${TOKEN}`)).toBe(true)
    expect(calls.some(c => c.url.toString().includes(TOKEN))).toBe(false)
    expect(calls.map(c => pathOf(c.url))).toEqual([
      ACCOUNT, CAMPAIGN, `${CAMPAIGN}/adsets`, `${CAMPAIGN}/ads`,
      `${CAMPAIGN}/insights`, `${CAMPAIGN}/insights`, `${CAMPAIGN}/insights`,
    ])
    const insights = calls.filter(c => pathOf(c.url).endsWith('/insights'))
    expect(insights.map(c => c.url.searchParams.get('level'))).toEqual(['campaign', 'adset', 'ad'])
    for (const c of insights) {
      expect(JSON.parse(c.url.searchParams.get('time_range') ?? '{}')).toEqual({ since: '2026-10-20', until: '2026-10-21' })
    }
    expect(insights[0].url.searchParams.get('fields')).toContain('video_thruplay_watched_actions')
    expect(insights[0].url.searchParams.get('fields')).toContain('cost_per_thruplay')
  })

  it('洞察没有数据行（还没花钱）→ read=true，total 为 null，各层为空——不是读失败', async () => {
    const { fetcher } = makeFetcher({ [`${CAMPAIGN}/insights`]: () => ({ body: { data: [] } }) })
    const out = await read(fetcher)
    expect(out.read).toBe(true)
    if (!out.read) return
    expect(out.total).toBeNull()
    expect(out.by_adset).toEqual([])
    expect(out.by_ad).toEqual([])
  })

  it('取不到账户时区 → 读不到（不悄悄退回 UTC 日期：新西兰早上会少算一天，当天才开始花钱的系列会被误报「没花钱」）', async () => {
    const { fetcher } = makeFetcher({ [ACCOUNT]: () => ({ status: 400, body: { error: { message: 'x', code: 100 } } }) })
    const out = await read(fetcher)
    expect(out.read).toBe(false)
    if (out.read) return
    expect(out.error).toContain('时区')
  })

  it('瞬时故障（5xx）自动再试一次，试得通就算读到了', async () => {
    let first = true
    const { fetcher } = makeFetcher({
      [CAMPAIGN]: () => {
        if (first) { first = false; return { status: 503, body: { error: { message: '暂时不可用', code: 2 } } } }
        return { body: nodeBody }
      },
    })
    const out = await read(fetcher)
    expect(out.read).toBe(true)
  })
})

describe('readSeriesFacts · 读不全 / 读不懂都不当成「没数据」', () => {
  it('系列节点读失败 → read=false；报错文字里回显的令牌被抹掉', async () => {
    const { fetcher } = makeFetcher({
      [CAMPAIGN]: () => ({ status: 400, body: { error: { message: `Invalid OAuth access token ${TOKEN}`, code: 190 } } }),
    })
    const out = await read(fetcher)
    expect(out.read).toBe(false)
    if (out.read) return
    expect(out.error).toContain('读取失败')
    expect(out.error).not.toContain(TOKEN)
  })

  it('广告组 / 广告列表有下一页（读不全）→ read=false', async () => {
    const paged = { data: adsetsBody.data, paging: { next: 'https://graph.example.test/next', cursors: { after: 'y' } } }
    const adsets = await read(makeFetcher({ [`${CAMPAIGN}/adsets`]: () => ({ body: paged }) }).fetcher)
    expect(adsets.read).toBe(false)
    const ads = await read(makeFetcher({ [`${CAMPAIGN}/ads`]: () => ({ body: { data: adsBody.data, paging: { next: 'https://graph.example.test/next' } } }) }).fetcher)
    expect(ads.read).toBe(false)
  })

  it('洞察返回 200 但没有 data 数组 / 有下一页 → read=false（不当成「还没花钱」）', async () => {
    const noData = await read(makeFetcher({ [`${CAMPAIGN}/insights`]: () => ({ body: { weird: true } }) }).fetcher)
    expect(noData.read).toBe(false)
    const paged = await read(makeFetcher({ [`${CAMPAIGN}/insights`]: () => ({ body: { data: [], paging: { next: 'https://graph.example.test/next' } } }) }).fetcher)
    expect(paged.read).toBe(false)
  })

  it('节点返回的编号和要读的对不上 / 不是对象 → read=false', async () => {
    const other = await read(makeFetcher({ [CAMPAIGN]: () => ({ body: { ...nodeBody, id: '999999999999' } }) }).fetcher)
    expect(other.read).toBe(false)
    const junk = await read(makeFetcher({ [CAMPAIGN]: () => ({ body: 'nope' }) }).fetcher)
    expect(junk.read).toBe(false)
  })

  it('系列不属于配置的广告账户（编号抄错读到了别家的）→ 读不到', async () => {
    const other = await read(makeFetcher({ [CAMPAIGN]: () => ({ body: { ...nodeBody, account_id: '9999999999' } }) }).fetcher)
    expect(other.read).toBe(false)
    if (!other.read) expect(other.error).toContain('账户')
    const missing = await read(makeFetcher({ [CAMPAIGN]: () => ({ body: { ...nodeBody, account_id: undefined } }) }).fetcher)
    expect(missing.read).toBe(false)
  })

  it('洞察里有行读不懂（缺编号）→ 整份读不到，不悄悄丢行（丢了会把「有数据」说成「没花钱」）', async () => {
    const rowsMissingId = { data: [{ campaign_name: '没编号的行', spend: '12.5' }] }
    const out = await read(makeFetcher({ [`${CAMPAIGN}/insights`]: () => ({ body: rowsMissingId }) }).fetcher)
    expect(out.read).toBe(false)
  })

  it('账户编号 / 系列编号格式不对 → 直接拒绝，一次请求都不发', async () => {
    const { fetcher, calls } = makeFetcher()
    const badAccount = await readSeriesFacts({ adAccountId: 'not-an-account', campaignId: CAMPAIGN, token: TOKEN, fetcher, now: NOW, sleep: noSleep })
    const badCampaign = await readSeriesFacts({ adAccountId: ACCOUNT, campaignId: '12/../34', token: TOKEN, fetcher, now: NOW, sleep: noSleep })
    expect(badAccount.read).toBe(false)
    expect(badCampaign.read).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('Graph 路径白名单 · 只多放开了「系列节点 + 广告组 / 广告 / 洞察」和账户的广告组列表', () => {
  const get = makeGraphGet(async () => new Response('{}', { status: 200 }), TOKEN, noSleep)

  it('放行：系列节点及其 adsets / ads / insights', async () => {
    await expect(get(CAMPAIGN, { fields: 'id,name' })).resolves.toEqual({})
    for (const path of [`${CAMPAIGN}/adsets`, `${CAMPAIGN}/ads`, `${CAMPAIGN}/insights`]) {
      await expect(get(path, {})).resolves.toEqual({})
    }
  })

  it('读系列节点只许要白名单里的字段：要 access_token 之类的 / 不带字段 → 拒绝', async () => {
    await expect(get(CAMPAIGN, { fields: 'id,name,objective,status,effective_status,created_time,updated_time,account_id' })).resolves.toEqual({})
    await expect(get(CAMPAIGN, { fields: 'access_token' })).rejects.toThrow('不允许')
    await expect(get(CAMPAIGN, { fields: 'id,name,access_token' })).rejects.toThrow('不允许')
    await expect(get(CAMPAIGN, {})).rejects.toThrow('不允许')
  })

  it('账户的广告组列表（预算门现读在投预算用）也放行；账户上别的边照样拒绝', async () => {
    await expect(get('act_1234567890/adsets', { fields: 'id' })).resolves.toEqual({})
    for (const path of ['act_1234567890/ads', 'act_1234567890/adcreatives', 'act_1234567890/users', 'act_1234567890/subscribed_apps']) {
      await expect(get(path, {})).rejects.toThrow('不允许的 Graph 路径')
    }
  })

  it('照样拒绝别的路径（用户自己的节点、订阅应用、写操作常用的边）', async () => {
    for (const path of ['me/accounts', `${CAMPAIGN}/subscribed_apps`, `${CAMPAIGN}/copies`, `${CAMPAIGN}/../me`]) {
      await expect(get(path, {})).rejects.toThrow('不允许的 Graph 路径')
    }
  })
})

describe('parseMetricsRows · 洞察行解析', () => {
  it('缺的字段：触达 / 频次 / 成本 = null（不是 0）；次数 = 0', () => {
    const rows = parseMetricsRows({
      data: [
        { campaign_id: 'c1', spend: '3.5' },
        { campaign_id: 'c2', campaign_name: '二号', spend: 'abc', reach: 'x', actions: [{ action_type: 'link_click', value: '9' }] },
      ],
    }, 'campaign')
    expect(rows).toEqual([
      { id: 'c1', name: 'c1', spend_cents: 350, impressions: 0, reach: null, frequency: null, thruplays: 0, cost_per_thruplay: null, conversations: 0, cost_per_conversation: null },
      { id: 'c2', name: '二号', spend_cents: 0, impressions: 0, reach: null, frequency: null, thruplays: 0, cost_per_thruplay: null, conversations: 0, cost_per_conversation: null },
    ])
  })

  it('开始聊天数只取一种口径（不同口径不相加）', () => {
    const rows = parseMetricsRows({
      data: [{
        ad_id: 'a1', ad_name: '甲', spend: '10',
        actions: [
          { action_type: 'onsite_conversion.total_messaging_connection', value: '9' },
          { action_type: MSG, value: '4' },
        ],
        cost_per_action_type: [{ action_type: MSG, value: '2.5' }],
      }],
    }, 'ad')
    expect(rows?.[0]).toMatchObject({ id: 'a1', conversations: 4, cost_per_conversation: 2.5 })
  })

  it('没有 data 数组 → null（读不懂，不是「没数据」）', () => {
    expect(parseMetricsRows({}, 'ad')).toBeNull()
    expect(parseMetricsRows(null, 'ad')).toBeNull()
  })

  it('有任何一行读不懂（不是对象 / 缺编号）→ 整份 null，不悄悄丢行', () => {
    expect(parseMetricsRows({ data: [{ campaign_id: 'c1', spend: '1' }, 'garbage'] }, 'campaign')).toBeNull()
    expect(parseMetricsRows({ data: [{ campaign_id: 'c1', spend: '1' }, { spend: '9' }] }, 'campaign')).toBeNull()
  })
})

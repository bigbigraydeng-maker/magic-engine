import { describe, expect, it, vi } from 'vitest'
import { dateInTimezone, parseInsightsBody, readCampaignPresence, readPostLaunchFacts } from '../post-launch'
import { RETRY_DELAY_MS } from '../retry'

const NOW = new Date('2026-10-22T10:30:00.000Z') // 新西兰时间 2026-10-22 23:30
const TOKEN = 'SECRET_TOKEN_VALUE_123'

describe('dateInTimezone · 在广告账户时区里「这一刻是哪一天」', () => {
  it('同一时刻在不同时区是不同的日期', () => {
    const t = new Date('2026-10-21T20:00:00.000Z')
    expect(dateInTimezone(t, 'Pacific/Auckland')).toBe('2026-10-22') // +13:00
    expect(dateInTimezone(t, 'America/Los_Angeles')).toBe('2026-10-21')
    expect(dateInTimezone(t, 'UTC')).toBe('2026-10-21')
  })

  it('时区名不认识 / 为空 → 退回 UTC 日期，不抛错', () => {
    const t = new Date('2026-10-21T20:00:00.000Z')
    expect(dateInTimezone(t, 'Not/AZone')).toBe('2026-10-21')
    expect(dateInTimezone(t, null)).toBe('2026-10-21')
  })
})

describe('parseInsightsBody · Meta 洞察响应 → 开投后的数字', () => {
  it('花费按元转分；点击、落地页浏览、留资取自 actions', () => {
    const body = {
      data: [{
        spend: '25.5', inline_link_clicks: '40',
        actions: [
          { action_type: 'landing_page_view', value: '32' },
          { action_type: 'lead', value: '3' },
          { action_type: 'offsite_conversion.fb_pixel_lead', value: '3' },
          { action_type: 'post_engagement', value: '99' },
        ],
      }],
    }
    expect(parseInsightsBody(body)).toEqual({ spend_cents: 2550, link_clicks: 40, landing_page_views: 32, leads: 3 })
  })

  it('没有汇总的 lead 时退用像素留资；两个都没有 → 0', () => {
    const pixelOnly = { data: [{ spend: '1', inline_link_clicks: '2', actions: [{ action_type: 'offsite_conversion.fb_pixel_lead', value: '4' }] }] }
    expect(parseInsightsBody(pixelOnly).leads).toBe(4)
    const none = { data: [{ spend: '1', inline_link_clicks: '2' }] }
    expect(parseInsightsBody(none)).toEqual({ spend_cents: 100, link_clicks: 2, landing_page_views: 0, leads: 0 })
  })

  it('一行都没有（还没开始花钱）→ 全 0；响应不是对象 → 全 0', () => {
    const zero = { spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0 }
    expect(parseInsightsBody({ data: [] })).toEqual(zero)
    expect(parseInsightsBody(null)).toEqual(zero)
    expect(parseInsightsBody('x')).toEqual(zero)
  })

  it('数字写成乱码的字段当 0，不抛错', () => {
    expect(parseInsightsBody({ data: [{ spend: 'abc', inline_link_clicks: null, actions: [{ action_type: 'lead', value: 'x' }] }] }))
      .toEqual({ spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0 })
  })

  // 按广告系列过滤时 Meta 按系列分行返回：各项加起来；每一行各自「汇总 lead 优先、没有才退用像素留资」，免得重复相加
  it('多行（按广告系列分行）→ 各项加起来；每行各自取留资数，不重复相加', () => {
    const body = {
      data: [
        { spend: '10', inline_link_clicks: '20', actions: [{ action_type: 'landing_page_view', value: '15' }, { action_type: 'lead', value: '2' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' }] },
        { spend: '5.5', inline_link_clicks: '4', actions: [{ action_type: 'landing_page_view', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '1' }] },
        'garbage-row',
      ],
    }
    expect(parseInsightsBody(body)).toEqual({ spend_cents: 1550, link_clicks: 24, landing_page_views: 18, leads: 3 })
  })

  it('给了 scope：只算编号 / 名字对得上的行', () => {
    const body = {
      data: [
        { campaign_id: '111111', campaign_name: 'a', spend: '10', inline_link_clicks: '5' },
        { campaign_id: '222222', campaign_name: '官网点击 · x', spend: '20', inline_link_clicks: '6' },
        { campaign_id: '333333', campaign_name: 'z', spend: '40', inline_link_clicks: '7' },
        { spend: '80', inline_link_clicks: '8' },
      ],
    }
    expect(parseInsightsBody(body, { ids: ['111111'], nameContains: ['官网点击'] })).toEqual({ spend_cents: 3000, link_clicks: 11, landing_page_views: 0, leads: 0 })
    // 名字关键词要全部含有才算
    expect(parseInsightsBody(body, { ids: [], nameContains: ['官网点击', '不存在的词'] })).toEqual({ spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0 })
  })
})

describe('readPostLaunchFacts', () => {
  function makeFetcher(opts: { insights?: unknown; insightsStatus?: number; throws?: boolean } = {}) {
    const urls: string[] = []
    const calls: RequestInit[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      if (init) calls.push(init)
      if (opts.throws) throw new Error(`boom access_token=${TOKEN}`)
      const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')
      if (path === 'act_1111111111') return new Response(JSON.stringify({ timezone_name: 'Pacific/Auckland' }), { status: 200 })
      if (path === 'act_1111111111/insights') {
        return new Response(JSON.stringify(opts.insights ?? { data: [{ campaign_id: '123456789012', campaign_name: '本次投放', spend: '10', inline_link_clicks: '20', actions: [{ action_type: 'landing_page_view', value: '15' }] }] }), { status: opts.insightsStatus ?? 200 })
      }
      return new Response('{}', { status: 404 })
    })
    return { fetcher, urls, calls }
  }

  const input = (fetcher: typeof fetch) => ({
    adAccountId: 'act_1111111111', token: TOKEN, fetcher, now: NOW, launchedAt: '2026-10-21T21:00:00.000Z', // 新西兰 10-22 10:00
    sleep: async (): Promise<void> => undefined,
    campaignIds: ['123456789012'],
  })

  it('用账户时区算「开投那天 → 今天」的日期区间，按系列读洞察', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await readPostLaunchFacts(input(fetcher))

    expect(out.errors).toEqual([])
    expect(out.facts).toMatchObject({ read: true, error: null, spend_cents: 1000, link_clicks: 20, landing_page_views: 15, leads: 0, as_of: NOW.toISOString() })
    const insightsUrl = new URL(urls.find(u => u.includes('/insights')) ?? '')
    expect(insightsUrl.searchParams.get('level')).toBe('campaign')
    expect(insightsUrl.searchParams.get('fields')).toContain('inline_link_clicks')
    expect(JSON.parse(insightsUrl.searchParams.get('time_range') ?? '{}')).toEqual({ since: '2026-10-22', until: '2026-10-22' })
  })

  it('给了 sinceDate 就直接拿它当起始日期（自动补排用：从窗口第一天起累计花费），不用开投时刻去推', async () => {
    const { fetcher, urls } = makeFetcher()
    await readPostLaunchFacts({ ...input(fetcher), sinceDate: '2026-10-20' })
    const range = JSON.parse(new URL(urls.find(u => u.includes('/insights')) ?? '').searchParams.get('time_range') ?? '{}')
    expect(range).toEqual({ since: '2026-10-20', until: '2026-10-22' })
  })

  it('sinceDate 格式不对 → 一个请求都不发，read false', async () => {
    const { fetcher } = makeFetcher()
    const out = await readPostLaunchFacts({ ...input(fetcher), sinceDate: '10/20/2026' })
    expect(out.facts.read).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('只发 GET、令牌只在 Authorization 头里、网址里没有令牌', async () => {
    const { fetcher, urls, calls } = makeFetcher()
    await readPostLaunchFacts(input(fetcher))
    for (const url of urls) {
      expect(url).not.toContain(TOKEN)
      expect(url).not.toContain('access_token')
    }
    for (const init of calls) {
      expect(init.method === undefined || init.method === 'GET').toBe(true)
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('洞察接口报错 → read false，原因里没有令牌，数字全 0', async () => {
    const { fetcher } = makeFetcher({ insights: { error: { message: `bad token ${TOKEN}`, code: 190 } }, insightsStatus: 400 })
    const out = await readPostLaunchFacts(input(fetcher))
    expect(out.facts.read).toBe(false)
    expect(out.facts.spend_cents).toBe(0)
    expect(out.errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })

  it('网络直接抛错 → 不 reject，read false，没有令牌', async () => {
    const { fetcher } = makeFetcher({ throws: true })
    const out = await readPostLaunchFacts(input(fetcher))
    expect(out.facts.read).toBe(false)
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })

  it('开投时间读不懂 / 账户编号不对 → 一个请求都不发，read false', async () => {
    const { fetcher } = makeFetcher()
    const badTime = await readPostLaunchFacts({ ...input(fetcher), launchedAt: 'garbage' })
    const badAccount = await readPostLaunchFacts({ ...input(fetcher), adAccountId: '../me' })
    expect(badTime.facts.read).toBe(false)
    expect(badAccount.facts.read).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('查不到账户时区时退用 UTC 日期，照样能读', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      urls.push(String(input))
      const path = new URL(String(input)).pathname.replace(/^\/v\d+\.\d+\//, '')
      if (path === 'act_1111111111') return new Response(JSON.stringify({ error: { message: 'nope', code: 10 } }), { status: 400 })
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    })
    const out = await readPostLaunchFacts(input(fetcher))
    expect(out.facts.read).toBe(true)
    const range = JSON.parse(new URL(urls.find(u => u.includes('/insights')) ?? '').searchParams.get('time_range') ?? '{}')
    expect(range).toEqual({ since: '2026-10-21', until: '2026-10-22' })
  })
})

describe('readPostLaunchFacts · 只看本次投放的广告系列（审查整改：不要用整个官方账户的花费）', () => {
  const CAMPAIGN_A = '123456789012'
  const CAMPAIGN_B = '123456789013'
  const noSleep = async (): Promise<void> => undefined
  const base = (fetcher: typeof fetch) => ({
    adAccountId: 'act_1111111111', token: TOKEN, fetcher, now: NOW, launchedAt: '2026-10-21T21:00:00.000Z', sleep: noSleep,
  })

  function accountFetcher(insights: (n: number) => Response) {
    const urls: string[] = []
    let n = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')
      if (path === 'act_1111111111') return new Response(JSON.stringify({ timezone_name: 'Pacific/Auckland' }), { status: 200 })
      if (path === 'act_1111111111/insights') { n += 1; return insights(n) }
      return new Response('{}', { status: 404 })
    })
    return { fetcher, urls }
  }
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const row = (campaignId: string, name: string, spend: string, clicks: string, lpv = '0', lead = '0') => ({
    campaign_id: campaignId, campaign_name: name, spend, inline_link_clicks: clicks,
    actions: [{ action_type: 'landing_page_view', value: lpv }, { action_type: 'lead', value: lead }],
  })

  it('按系列读：请求按系列分行（level=campaign，带编号和名字），只把编号对得上的系列算进去，别的系列的花费不算', async () => {
    const { fetcher, urls } = accountFetcher(() => ok({
      data: [
        row(CAMPAIGN_A, '官网点击 A', '10', '20', '15', '1'),
        row(CAMPAIGN_B, '官网点击 B', '5.5', '4', '3', '0'),
        row('999999999999', '别的系列（账户里本来就在花钱）', '300', '900', '800', '40'),
      ],
    }))
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A, CAMPAIGN_B] })
    expect(out.facts).toMatchObject({ read: true, error: null, spend_cents: 1550, link_clicks: 24, landing_page_views: 18, leads: 1 })
    const url = new URL(urls.find(u => u.includes('/insights')) ?? '')
    expect(url.searchParams.get('level')).toBe('campaign')
    expect(url.searchParams.get('fields')).toContain('campaign_id')
    expect(url.searchParams.get('fields')).toContain('campaign_name')
    expect(url.toString()).not.toContain(TOKEN)
  })

  it('编号变了也认得出来：名字里同时含全部关键词的系列同样算（草稿发布后编号可能变，名字不会）', async () => {
    const { fetcher } = accountFetcher(() => ok({
      data: [
        row('555555555555', '示例店 · 官网点击 · 20260101', '8', '10', '9', '1'),
        row('555555555556', '示例店 · 拉新 · 表单 · 20260101', '50', '60', '0', '12'),
        row('555555555557', '官网点击 · 20250101', '70', '80', '70', '3'),
      ],
    }))
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A], campaignNameContains: ['官网点击', '20260101'] })
    expect(out.facts).toMatchObject({ read: true, spend_cents: 800, link_clicks: 10, landing_page_views: 9, leads: 1 })
  })

  it('编号和名字任意一条对上就算，两条都对上也只算一次', async () => {
    const { fetcher } = accountFetcher(() => ok({
      data: [row(CAMPAIGN_A, '官网点击 · 20260101', '10', '20', '15', '1')],
    }))
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A], campaignNameContains: ['官网点击'] })
    expect(out.facts).toMatchObject({ spend_cents: 1000, link_clicks: 20 })
  })

  it('一个系列都对不上（比如还是草稿、还没发布）→ read 为 true，数字全 0（没开始花钱，不是读不到）', async () => {
    const { fetcher } = accountFetcher(() => ok({ data: [row('999999999999', '别的系列', '300', '900')] }))
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A] })
    expect(out.facts).toMatchObject({ read: true, spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0 })
  })

  // 🔴 第二轮审查整改：范围为空时不得静默退回整个账户（账户里别的系列早就在花钱，会把「没开投」读成「已开投」）
  it('不给编号也不给名字关键词（或都给空数组）→ 拒绝：read false、写明原因，一个请求都不发，绝不退回整个账户', async () => {
    for (const input of [{}, { campaignIds: [], campaignNameContains: [] }, { campaignIds: undefined, campaignNameContains: undefined }]) {
      const { fetcher } = accountFetcher(() => ok({ data: [{ spend: '10', inline_link_clicks: '20' }] }))
      const out = await readPostLaunchFacts({ ...base(fetcher), ...input })
      expect(out.facts.read, JSON.stringify(input)).toBe(false)
      expect(out.facts.spend_cents, JSON.stringify(input)).toBe(0)
      expect(out.facts.error, JSON.stringify(input)).toContain('广告系列')
      expect(out.errors.length, JSON.stringify(input)).toBeGreaterThan(0)
      expect(fetcher, JSON.stringify(input)).not.toHaveBeenCalled()
    }
  })

  it('编号格式不对（不是 6–20 位纯数字）/ 名字关键词不合格（空的、太长、带控制字符）→ 一个请求都不发，read false', async () => {
    const bads = [
      { campaignIds: ['abc'] }, { campaignIds: ['12345'] }, { campaignIds: [CAMPAIGN_A, '1; DROP'] }, { campaignIds: ['12345678901234567890123'] },
      { campaignNameContains: [''] }, { campaignNameContains: ['x'.repeat(61)] }, { campaignNameContains: ['坏\u0000词'] },
    ]
    for (const bad of bads) {
      const { fetcher } = accountFetcher(() => ok({ data: [] }))
      const out = await readPostLaunchFacts({ ...base(fetcher), ...bad })
      expect(out.facts.read, JSON.stringify(bad)).toBe(false)
      expect(out.facts.error, JSON.stringify(bad)).toContain('广告系列')
      expect(fetcher, JSON.stringify(bad)).not.toHaveBeenCalled()
    }
  })

  // 🔴 第三轮整改（同一类问题）：200 但读不懂的洞察响应不能当成「还没花钱」的全 0
  it('洞察响应是 200 但没有 data 数组 → 读不懂：read false、写明原因（不能当成「还没花钱」的全 0）', async () => {
    for (const body of [{}, { data: null }, { data: 'oops' }, { data: {} }, [], 'text', null]) {
      const { fetcher } = accountFetcher(() => ok(body))
      const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A] })
      expect(out.facts.read, JSON.stringify(body)).toBe(false)
      expect(out.facts.error, JSON.stringify(body)).toContain('读不懂')
      expect(out.errors.length, JSON.stringify(body)).toBeGreaterThan(0)
      expect(out.facts.spend_cents, JSON.stringify(body)).toBe(0)
    }
  })

  it('洞察的 data 是空数组 → 读到了，全 0（账户里这段时间还没有任何花费行）', async () => {
    const { fetcher } = accountFetcher(() => ok({ data: [] }))
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A] })
    expect(out.facts).toMatchObject({ read: true, error: null, spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0 })
  })

  it('洞察结果还有下一页（系列太多读不全）→ read false，不把半截数字当完整结果', async () => {
    const { fetcher } = accountFetcher(() => ok({
      data: [row(CAMPAIGN_A, '官网点击', '10', '20')],
      paging: { cursors: { after: 'AFTER' }, next: 'https://graph.example.test/next?access_token=LEAKY' },
    }))
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A] })
    expect(out.facts.read).toBe(false)
    expect(out.facts.spend_cents).toBe(0)
    expect(JSON.stringify(out)).not.toContain('LEAKY')
  })

  it('洞察第一次返回 503、第二次正常 → 读到数；中间等了一次', async () => {
    const sleeps: number[] = []
    const { fetcher } = accountFetcher(n =>
      n === 1
        ? new Response(JSON.stringify({ error: { message: 'down', code: 2 } }), { status: 503 })
        : ok({ data: [row(CAMPAIGN_A, '官网点击', '10', '20')] }),
    )
    const out = await readPostLaunchFacts({ ...base(fetcher), campaignIds: [CAMPAIGN_A], sleep: async ms => { sleeps.push(ms) } })
    expect(out.facts).toMatchObject({ read: true, spend_cents: 1000, link_clicks: 20 })
    expect(sleeps).toEqual([RETRY_DELAY_MS])
  })
})

describe('readCampaignPresence · 本次投放的系列在账户里有没有（不管花没花钱）', () => {
  const CAMPAIGN_A = '123456789012'
  const noSleep = async (): Promise<void> => undefined
  const base = (fetcher: typeof fetch) => ({
    adAccountId: 'act_1111111111', token: TOKEN, fetcher, sleep: noSleep, campaignIds: [CAMPAIGN_A] as readonly string[],
  })
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  function campaignsFetcher(respond: (n: number) => Response) {
    const urls: string[] = []
    const calls: RequestInit[] = []
    let n = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      urls.push(String(input))
      if (init) calls.push(init)
      n += 1
      return respond(n)
    })
    return { fetcher, urls, calls }
  }

  it('按编号找到 → found true；请求是只读的 GET，只要编号和名字，令牌只在 Authorization 头里', async () => {
    const { fetcher, urls, calls } = campaignsFetcher(() => ok({ data: [{ id: CAMPAIGN_A, name: '官网点击 A' }, { id: '999999999999', name: '别的' }] }))
    const out = await readCampaignPresence(base(fetcher))
    expect(out).toEqual({ read: true, found: true, error: null })
    const url = new URL(urls[0])
    expect(url.pathname.replace(/^\/v\d+\.\d+\//, '')).toBe('act_1111111111/campaigns')
    expect(url.searchParams.get('fields')).toBe('id,name')
    expect(urls[0]).not.toContain(TOKEN)
    expect(calls[0].method === undefined || calls[0].method === 'GET').toBe(true)
    expect((calls[0].headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('编号变了但名字里同时含全部关键词 → 照样 found true', async () => {
    const { fetcher } = campaignsFetcher(() => ok({ data: [{ id: '555555555555', name: '示例店 · 官网点击 · 20260101' }] }))
    const out = await readCampaignPresence({ ...base(fetcher), campaignIds: [CAMPAIGN_A], campaignNameContains: ['官网点击', '20260101'] })
    expect(out.found).toBe(true)
  })

  it('编号和名字都对不上（比如系列还是未发布的草稿，线上读不到）→ read 为 true、found 为 false', async () => {
    const { fetcher } = campaignsFetcher(() => ok({ data: [{ id: '999999999999', name: '官网点击 · 20250101' }] }))
    const out = await readCampaignPresence({ ...base(fetcher), campaignNameContains: ['官网点击', '20260101'] })
    expect(out).toEqual({ read: true, found: false, error: null })
  })

  // 🔴 第三轮整改：返回 200 但读不懂（没有 data 数组）不是「账户里一个系列都没有」——读不懂 = found 为 null
  it('响应是 200 但没有 data 数组（缺失 / null / 不是数组 / 整个响应不是对象）→ 读不懂：read false、found 为 null，不当成「找不到」', async () => {
    for (const body of [{}, { data: null }, { data: 'oops' }, { data: {} }, { error_free: true }, [], 'text', null]) {
      const { fetcher } = campaignsFetcher(() => ok(body))
      const out = await readCampaignPresence(base(fetcher))
      expect(out, JSON.stringify(body)).toMatchObject({ read: false, found: null })
      expect(out.error, JSON.stringify(body)).toContain('读不懂')
    }
  })

  it('data 是空数组 → 读到了：账户里一个系列都没有 → found 为 false（这是真的「找不到」）', async () => {
    const { fetcher } = campaignsFetcher(() => ok({ data: [] }))
    expect(await readCampaignPresence(base(fetcher))).toEqual({ read: true, found: false, error: null })
  })

  it('范围为空（编号和名字关键词都没有）→ 拒绝：read false，一个请求都不发', async () => {
    const { fetcher } = campaignsFetcher(() => ok({ data: [] }))
    const out = await readCampaignPresence({ ...base(fetcher), campaignIds: [], campaignNameContains: [] })
    expect(out.read).toBe(false)
    expect(out.found).toBeNull()
    expect(out.error).toContain('广告系列')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('编号 / 名字关键词格式不对 → 拒绝，一个请求都不发', async () => {
    const { fetcher } = campaignsFetcher(() => ok({ data: [] }))
    expect((await readCampaignPresence({ ...base(fetcher), campaignIds: ['abc'] })).read).toBe(false)
    expect((await readCampaignPresence({ ...base(fetcher), campaignIds: [], campaignNameContains: [''] })).read).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('还有下一页（系列太多读不全）→ read false、found 为 null（不当成「找不到」），也不外带 paging.next', async () => {
    const { fetcher } = campaignsFetcher(() => ok({
      data: [{ id: '999999999999', name: 'x' }],
      paging: { cursors: { after: 'A' }, next: 'https://graph.example.test/next?access_token=LEAKY' },
    }))
    const out = await readCampaignPresence(base(fetcher))
    expect(out.read).toBe(false)
    expect(out.found).toBeNull()
    expect(JSON.stringify(out)).not.toContain('LEAKY')
  })

  it('接口报错 / 网络直接抛错 → read false、found 为 null，原因里没有令牌', async () => {
    const bad = campaignsFetcher(() => new Response(JSON.stringify({ error: { message: `bad ${TOKEN}`, code: 190 } }), { status: 400 }))
    const out = await readCampaignPresence(base(bad.fetcher))
    expect(out).toMatchObject({ read: false, found: null })
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    const boom = vi.fn(async (): Promise<Response> => { throw new Error(`boom access_token=${TOKEN}`) })
    const out2 = await readCampaignPresence(base(boom as unknown as typeof fetch))
    expect(out2).toMatchObject({ read: false, found: null })
    expect(JSON.stringify(out2)).not.toContain(TOKEN)
  })

  it('第一次 503、第二次正常 → 读到；中间等了一次', async () => {
    const sleeps: number[] = []
    const { fetcher } = campaignsFetcher(n => n === 1
      ? new Response(JSON.stringify({ error: { message: 'down', code: 2 } }), { status: 503 })
      : ok({ data: [{ id: CAMPAIGN_A, name: 'x' }] }))
    const out = await readCampaignPresence({ ...base(fetcher), sleep: async ms => { sleeps.push(ms) } })
    expect(out).toEqual({ read: true, found: true, error: null })
    expect(sleeps).toEqual([RETRY_DELAY_MS])
  })

  it('账户编号格式不对 → 拒绝，一个请求都不发', async () => {
    const { fetcher } = campaignsFetcher(() => ok({ data: [] }))
    const out = await readCampaignPresence({ ...base(fetcher), adAccountId: '../me' })
    expect(out.read).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { dateInTimezone, parseInsightsBody, readPostLaunchFacts } from '../post-launch'

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
        return new Response(JSON.stringify(opts.insights ?? { data: [{ spend: '10', inline_link_clicks: '20', actions: [{ action_type: 'landing_page_view', value: '15' }] }] }), { status: opts.insightsStatus ?? 200 })
      }
      return new Response('{}', { status: 404 })
    })
    return { fetcher, urls, calls }
  }

  const input = (fetcher: typeof fetch) => ({
    adAccountId: 'act_1111111111', token: TOKEN, fetcher, now: NOW, launchedAt: '2026-10-21T21:00:00.000Z', // 新西兰 10-22 10:00
  })

  it('用账户时区算「开投那天 → 今天」的日期区间去读账户级洞察', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await readPostLaunchFacts(input(fetcher))

    expect(out.errors).toEqual([])
    expect(out.facts).toMatchObject({ read: true, error: null, spend_cents: 1000, link_clicks: 20, landing_page_views: 15, leads: 0, as_of: NOW.toISOString() })
    const insightsUrl = new URL(urls.find(u => u.includes('/insights')) ?? '')
    expect(insightsUrl.searchParams.get('level')).toBe('account')
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

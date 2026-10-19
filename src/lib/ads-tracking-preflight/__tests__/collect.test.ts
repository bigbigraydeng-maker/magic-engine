import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assemblePostLaunchReceipt,
  buildItemLinks,
  collectCrmFacts,
  collectPostLaunchFacts,
  collectLandingFacts,
  collectMetaFacts,
  runClientPreflight,
  type CollectDeps,
} from '../collect'
import { PREFLIGHT_GATE_KEYS, type TrackingClientConfig, type TrackingGateKey } from '../types'
import adspixelsFixture from './fixtures/graph-adspixels.json'
import statsPage1Fixture from './fixtures/graph-stats-page1.json'
import statsPage2Fixture from './fixtures/graph-stats-page2.json'
import datasetQualityFixture from './fixtures/graph-dataset-quality.json'
import accountFixture from './fixtures/graph-account.json'

// 全部虚构的域名 / 编号（平台通用代码的测试里不许出现真实客户的东西）。
const NOW = new Date('2026-10-19T10:30:00.000Z')
const SECRET = 'SECRET_TOKEN_VALUE_123'
const SITE = 'https://www.example-shop.test'
const LANDING_URL = `${SITE}/p?utm_content=a`
const OFFICIAL = '2000000000000001'
const APP_BASE = 'https://app.example.test'

const CONFIG: TrackingClientConfig = {
  ad_account_id: 'act_1111111111',
  site_url: SITE,
  landing_targets: [{ label: '落地页 A', url: LANDING_URL }],
  ga4_lead_events: ['generate_lead', 'enquiry_thank_you'],
  web_form_to_crm: true,
  planned_daily_budget_cents: 10100,
  official_daily_cap_cents: 11000,
  currency: 'NZD',
}

const HTML = `<noscript><img src="https://www.facebook.com/tr?id=${OFFICIAL}&ev=PageView&noscript=1"/></noscript>`

// ─── 假网络：官网页面 + Meta Graph ───────────────────────────────────────────

interface NetOpts { landingStatus?: number; graphThrows?: boolean }

function makeFetcher(opts: NetOpts = {}) {
  const urls: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    urls.push(url)
    const parsed = new URL(url)
    if (parsed.hostname === 'www.example-shop.test') {
      return new Response(HTML, { status: opts.landingStatus ?? 200 })
    }
    if (opts.graphThrows) throw new Error(`socket hang up access_token=${SECRET}`)
    const path = parsed.pathname.replace(/^\/v\d+\.\d+\//, '')
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (path === 'act_1111111111/adspixels') return json(adspixelsFixture)
    if (path === 'act_1111111111') return json(accountFixture)
    if (path === `${OFFICIAL}/stats`) return json(parsed.searchParams.get('after') === 'AFTER1' ? statsPage2Fixture : statsPage1Fixture)
    if (path === 'dataset_quality') return json(datasetQualityFixture)
    return new Response('{}', { status: 404 })
  })
  return { fetcher, urls }
}

// ─── 假库 ──────────────────────────────────────────────────────────────────

interface DbOpts { touchpoints?: number; crmError?: string }

function makeDb(opts: DbOpts = {}) {
  const tables: string[] = []
  const db = {
    from(table: string) {
      tables.push(table)
      const finish = () => {
        if (table === 'clients') return { data: { domain: 'shop.example.test' }, error: null }
        if (table === 'me_conversion_writebacks') return { data: [], error: null }
        if (table === 'cron_run_logs') return { data: [{ status: 'completed', finished_at: '2026-10-19T09:30:00Z', started_at: '2026-10-19T09:25:00Z' }], error: null }
        if (table === 'contact_touchpoints') {
          if (opts.crmError) return { data: null, count: null, error: { message: opts.crmError } }
          const n = opts.touchpoints ?? 6
          return { data: n > 0 ? [{ occurred_at: '2026-10-19T05:00:00Z' }] : [], count: n, error: null }
        }
        return { data: null, error: { message: `不该读这张表：${table}` } }
      }
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq', 'gte', 'order']) chain[m] = () => chain
      chain.limit = () => Promise.resolve(finish())
      chain.maybeSingle = () => Promise.resolve(finish())
      chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(finish()).then(ok, bad)
      return chain
    },
  }
  // 假库只实现被测代码真会调用的链式方法（已跑：整条链路的每个查询都对着它走过一遍），
  // 和 promo-plan-watch-items.test.ts 同款写法，所以这里把它交给 SupabaseClient 的位置。
  return { supabase: db as unknown as SupabaseClient, tables }
}

interface DepsOpts extends NetOpts, DbOpts {
  token?: string | null
  propertyId?: string | null
}

function makeDeps(opts: DepsOpts = {}) {
  const net = makeFetcher(opts)
  const db = makeDb(opts)
  const deps: CollectDeps = {
    now: NOW,
    fetcher: net.fetcher,
    supabase: db.supabase,
    env: { META_PIXEL_ID_SHOP_EXAMPLE_TEST: OFFICIAL },
    resolveMetaToken: async () => (opts.token === undefined ? SECRET : opts.token),
    capiPreflight: async () => ({ ok: true, detail: { token_valid: true, pixel_visible: true, pixel_id: OFFICIAL, token_scopes: ['ads_management'] } }),
    ga4: {
      loadPropertyId: async () => (opts.propertyId === undefined ? '111' : opts.propertyId),
      fetchEventCounts: async () => ({ generate_lead: 8, enquiry_thank_you: 5 }),
    },
  }
  return { deps, ...net, ...db }
}

function statusOf(receipt: Awaited<ReturnType<typeof runClientPreflight>>, key: TrackingGateKey): string | undefined {
  return receipt.gates.find(g => g.key === key)?.status
}

async function run(opts: DepsOpts = {}, cfg: TrackingClientConfig = CONFIG) {
  const world = makeDeps(opts)
  const receipt = await runClientPreflight({ clientId: 'c1', cfg, requestId: 'req-1', trigger: 'cron', appBase: APP_BASE, deps: world.deps })
  return { receipt, ...world }
}

describe('runClientPreflight · 整条链路（假网络 + 假库 + 真实形状的 Graph 响应）', () => {
  it('什么都正常 → 十道门全绿，前置条件满足，没有待办，不外带令牌', async () => {
    const { receipt } = await run()
    expect(receipt.gates.map(g => g.key)).toEqual([...PREFLIGHT_GATE_KEYS])
    for (const g of receipt.gates) expect(g.status, `${g.key}: ${g.reason}`).toBe('green')
    expect(receipt).toMatchObject({
      request_id: 'req-1', client_id: 'c1', trigger: 'cron', phase: 'preflight',
      overall: 'green', preconditions_met: true, items: [], read_errors: [], no_publish: true,
    })
    expect(receipt.checked_at).toBe(NOW.toISOString())
    expect(JSON.stringify(receipt)).not.toContain(SECRET)
  })

  it('读 Meta 之前先探落地页：像素编号来自页面，只对页面上出现的官方数据集读事件统计', async () => {
    const { urls } = await run()
    const firstGraph = urls.findIndex(u => u.includes('graph.facebook.com'))
    const landing = urls.findIndex(u => u.startsWith(SITE))
    expect(landing).toBeGreaterThanOrEqual(0)
    expect(landing).toBeLessThan(firstGraph)
    expect(urls.some(u => u.includes(`${OFFICIAL}/stats`))).toBe(true)
    expect(urls.some(u => u.includes('2000000000000002/stats'))).toBe(false)
  })

  it('没有可用的 Meta 令牌 → 一个 Graph 请求都不发；依赖 Meta 的门变灰；留下读取错误和待办', async () => {
    const { receipt, urls } = await run({ token: null })
    expect(urls.some(u => u.includes('graph.facebook.com'))).toBe(false)
    expect(statusOf(receipt, 'tracking.account_dataset_aligned')).toBe('gray')
    expect(statusOf(receipt, 'env.account_billing')).toBe('gray')
    expect(receipt.preconditions_met).toBe(false)
    expect(receipt.read_errors.some(e => e.source === 'meta' && e.error.includes('令牌'))).toBe(true)
    expect(receipt.items.length).toBeGreaterThan(0)
  })

  it('Graph 请求直接抛网络错误 → 照样出回执，错误里没有令牌', async () => {
    const { receipt } = await run({ graphThrows: true })
    expect(receipt.read_errors.some(e => e.source === 'meta')).toBe(true)
    expect(statusOf(receipt, 'tracking.pixel_alive')).toBe('gray')
    expect(JSON.stringify(receipt)).not.toContain(SECRET)
  })

  it('落地页 404 → 落地页那道门红；待办的链接直达那个落地页', async () => {
    const { receipt } = await run({ landingStatus: 404 })
    expect(statusOf(receipt, 'tracking.landing_ok')).toBe('red')
    const item = receipt.items.find(i => i.gate_key === 'tracking.landing_ok')
    expect(item?.href).toBe(LANDING_URL)
  })

  it('GA4 没连 → 只是软门灰，不挡前置条件，读取错误里记一笔', async () => {
    const { receipt } = await run({ propertyId: null })
    expect(statusOf(receipt, 'tracking.ga4_events')).toBe('gray')
    expect(receipt.preconditions_met).toBe(true)
    expect(receipt.read_errors.some(e => e.source === 'ga4')).toBe(true)
  })

  it('CRM 里没有官网表单线索但网站有留资信号 → 红', async () => {
    const { receipt } = await run({ touchpoints: 0 })
    expect(statusOf(receipt, 'tracking.lead_reaches_crm')).toBe('red')
    expect(receipt.preconditions_met).toBe(false)
  })

  it('该客户没有官网表单 → 一次 CRM 都不查，那道门标「不适用」', async () => {
    const { receipt, tables } = await run({}, { ...CONFIG, web_form_to_crm: false })
    expect(tables).not.toContain('contact_touchpoints')
    expect(receipt.gates.find(g => g.key === 'tracking.lead_reaches_crm')?.na).toBe(true)
    expect(receipt.overall).toBe('green')
  })

  it('CRM 读取出错 → 记进读取错误，那道门灰', async () => {
    const { receipt } = await run({ crmError: 'boom' })
    expect(statusOf(receipt, 'tracking.lead_reaches_crm')).toBe('gray')
    expect(receipt.read_errors.some(e => e.source === 'crm' && e.error.includes('boom'))).toBe(true)
  })

  it('探活返回的像素编号和权限列表不进回执（只比对，不外带）', async () => {
    const { receipt } = await run()
    expect(JSON.stringify(receipt)).not.toContain('ads_management')
  })
})

describe('分步收集函数（Inngest 每一步各调一个）', () => {
  it('collectLandingFacts 按配置顺序探每个落地页，探不通的错误标 landing', async () => {
    const { deps } = makeDeps({ landingStatus: 200 })
    const cfg = { ...CONFIG, landing_targets: [...CONFIG.landing_targets, { label: '站外页', url: 'https://evil.test/x?utm_content=b' }] }
    const out = await collectLandingFacts(cfg, deps)
    expect(out.facts.probes.map(p => p.label)).toEqual(['落地页 A', '站外页'])
    expect(out.facts.probes[1].http_status).toBeNull()
    expect(out.errors.some(e => e.source === 'landing')).toBe(true)
    expect(out.facts.as_of).toBe(NOW.toISOString())
  })

  it('collectMetaFacts 只对传进来的像素编号读事件统计', async () => {
    const { deps, urls } = makeDeps()
    const out = await collectMetaFacts('c1', CONFIG, [OFFICIAL], deps)
    expect(out.facts.read).toBe(true)
    expect(out.facts.account_dataset_ids).toEqual([OFFICIAL, '2000000000000002'])
    expect(urls.some(u => u.includes(`${OFFICIAL}/stats`))).toBe(true)
  })

  it('collectCrmFacts 不适用时不查库', async () => {
    const { deps, tables } = makeDeps()
    const out = await collectCrmFacts('c1', { ...CONFIG, web_form_to_crm: false }, deps)
    expect(tables).toEqual([])
    expect(out.errors).toEqual([])
  })
})

describe('buildItemLinks · 每道门的红灯直达哪里', () => {
  const links = buildItemLinks('c-1', CONFIG, { appBase: APP_BASE, datasetId: OFFICIAL })

  it('兜底是推广计划页', () => {
    expect(links.fallback).toBe(`${APP_BASE}/dashboard/clients/c-1/promo-plan`)
  })

  it('像素 / 数据集 / 回传相关 → Events Manager 的那个数据集页', () => {
    for (const key of ['tracking.account_dataset_aligned', 'tracking.pixel_alive', 'tracking.lead_event_seen', 'tracking.lead_event_quality', 'tracking.capi_ready'] as const) {
      expect(links.byGate?.[key], key).toBe(`https://business.facebook.com/events_manager2/list/dataset/${OFFICIAL}`)
    }
  })

  it('没有数据集编号时退到 Events Manager 首页', () => {
    const noDataset = buildItemLinks('c-1', CONFIG, { appBase: APP_BASE, datasetId: null })
    expect(noDataset.byGate?.['tracking.pixel_alive']).toBe('https://business.facebook.com/events_manager2')
  })

  it('其余几道门各去各的地方', () => {
    expect(links.byGate?.['tracking.ga4_events']).toBe('https://analytics.google.com/analytics/web/')
    expect(links.byGate?.['tracking.landing_ok']).toBe(LANDING_URL)
    expect(links.byGate?.['tracking.lead_reaches_crm']).toBe(`${APP_BASE}/dashboard/clients/c-1/crm`)
    expect(links.byGate?.['env.token_and_crons']).toBe(`${APP_BASE}/dashboard/admin/cron-health`)
    expect(links.byGate?.['env.account_billing']).toBe('https://business.facebook.com/billing_hub/payment_settings?asset_id=1111111111')
  })
})

describe('开投后读回', () => {
  const LAUNCHED_AT = '2026-10-19T09:00:00.000Z'

  it('collectPostLaunchFacts 没有令牌 → 一个请求都不发，标 insights', async () => {
    const { deps, urls } = makeDeps({ token: null })
    const out = await collectPostLaunchFacts('c1', CONFIG, LAUNCHED_AT, deps)
    expect(urls).toEqual([])
    expect(out.facts.read).toBe(false)
    expect(out.errors.some(e => e.source === 'insights' && e.error.includes('令牌'))).toBe(true)
  })

  it('assemblePostLaunchReceipt：一道门（post.t24h），花了钱没点击 → 红，出待办，不是前置条件问题', async () => {
    const receipt = assemblePostLaunchReceipt({
      requestId: 'req-p', clientId: 'c1', cfg: CONFIG, phase: 'post_t24h', appBase: APP_BASE, now: NOW, launchedAt: LAUNCHED_AT,
      insights: { facts: { read: true, error: null, as_of: NOW.toISOString(), spend_cents: 5000, link_clicks: 0, landing_page_views: 0, leads: 0 }, errors: [] },
    })
    expect(receipt).toMatchObject({ trigger: 'postlaunch', phase: 'post_t24h', overall: 'red', preconditions_met: true, no_publish: true, launched_at: LAUNCHED_AT })
    expect(receipt.gates.map(g => g.key)).toEqual(['post.t24h'])
    expect(receipt.items.map(i => i.gate_key)).toEqual(['post.t24h'])
    expect(receipt.items[0].href).toBe(`${APP_BASE}/dashboard/clients/c1/promo-plan`)
  })
})

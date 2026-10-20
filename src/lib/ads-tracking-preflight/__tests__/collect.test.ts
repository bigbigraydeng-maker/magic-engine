import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  baseSpec as basePlanSpec,
  evaluateApproval as evaluatePlanApproval,
  goodFacts as goodPlanFacts,
  NOW as PLAN_NOW,
} from '@/lib/marketing-plan/promo/__tests__/fixtures'
import {
  assemblePostLaunchReceipt,
  buildItemLinks,
  collectBudgetFacts,
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
  // 预算数字不再写死：上限读库、在投预算读 Meta；这两个配置字段只用来跟库 / 线上对一对（null = 不对）
  planned_daily_budget_cents: null,
  official_daily_cap_cents: null,
  currency: 'NZD',
}

const HTML = `<noscript><img src="https://www.facebook.com/tr?id=${OFFICIAL}&ev=PageView&noscript=1"/></noscript>`

// ─── 假网络：官网页面 + Meta Graph ───────────────────────────────────────────

interface NetOpts { landingStatus?: number; graphThrows?: boolean; adsets?: unknown[] }

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
    // 在投的系列 / 广告组（预算门现读）：默认一个 ABO 系列 + 一个日预算 NZ$134 的广告组
    if (path === 'act_1111111111/campaigns') return json({ data: [{ id: '5001', effective_status: 'ACTIVE' }] })
    if (path === 'act_1111111111/adsets') {
      return json({ data: opts.adsets ?? [{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '13400' }] })
    }
    return new Response('{}', { status: 404 })
  })
  return { fetcher, urls }
}

// ─── 假库 ──────────────────────────────────────────────────────────────────

interface DbOpts {
  touchpoints?: number
  crmError?: string
  /** 自己指定 contact_touchpoints 返回哪些行（带 metadata.source_url）；不给 = 一条从广告落地页（/p）提交的线索 */
  touchpointRows?: { occurred_at: string; metadata: unknown }[]
  /** 预算门读库：库里的账户级 / 客户级日上限（分）；不给 = 15000；capsError = 两张上限表都读失败 */
  accountCap?: number | null
  clientCap?: number | null
  capsError?: string
}

function makeDb(opts: DbOpts = {}) {
  const tables: string[] = []
  const db = {
    from(table: string) {
      tables.push(table)
      const finish = () => {
        if (table === 'clients') return { data: { domain: 'shop.example.test' }, error: null }
        if (table === 'me_conversion_writebacks') return { data: [], error: null }
        if (table === 'client_meta_ad_accounts' || table === 'ad_strategy_configs') {
          if (opts.capsError) return { data: null, error: { message: opts.capsError } }
          if (table === 'ad_strategy_configs') return { data: { daily_budget_cap_cents: opts.clientCap === undefined ? 15000 : opts.clientCap }, error: null }
          return { data: [{ ad_account_id: 'act_1111111111', daily_budget_cap_cents: opts.accountCap === undefined ? 15000 : opts.accountCap }], error: null }
        }
        if (table === 'cron_run_logs') return { data: [{ status: 'completed', finished_at: '2026-10-19T09:30:00Z', started_at: '2026-10-19T09:25:00Z' }], error: null }
        if (table === 'contact_touchpoints') {
          if (opts.crmError) return { data: null, count: null, error: { message: opts.crmError } }
          const n = opts.touchpoints ?? 6
          const rows = opts.touchpointRows ?? (n > 0 ? [{ occurred_at: '2026-10-19T05:00:00Z', metadata: { source_url: '/p' } }] : [])
          return { data: rows, count: opts.touchpointRows ? opts.touchpointRows.length : n, error: null }
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
    // 测试里不真等：失败重试前的等待直接略过
    sleep: async () => undefined,
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

  // 🔴 第四轮：官网表单线索必须有从广告落地页（配置里的 /p）提交的，才算「广告这条路通了」
  it('CRM 里的官网表单线索全是联系页（/contact）提交的、没有一条来自广告落地页 → 灰「只验证了联系页表单」：挡前置条件，并出一条硬门灰的待办（带测试步骤和直达链接）', async () => {
    const { receipt } = await run({ touchpointRows: [{ occurred_at: '2026-10-19T09:00:00Z', metadata: { source_url: '/contact' } }] })
    const gate = receipt.gates.find(g => g.key === 'tracking.lead_reaches_crm')
    expect(gate?.status).toBe('gray')
    expect(gate?.hard).toBe(true)
    expect(gate?.reason).toContain('只验证了')
    expect(gate?.evidence).toMatchObject({ ad_landing_form_touchpoints_7d: 0, ad_landing_paths: ['/p'] })
    expect(receipt.preconditions_met).toBe(false)
    const item = receipt.items.find(i => i.gate_key === 'tracking.lead_reaches_crm')
    expect(item).toBeDefined()
    expect(item?.hard).toBe(true)
    expect(item?.what).toContain('只验证了')
    expect(item?.how).toContain('内部测试表单')
    expect(item?.href).toBe(`${APP_BASE}/dashboard/clients/c1/crm`)
  })

  it('有一条从广告落地页（/p）提交的线索、时间在 48 小时内 → 绿；联系页那条不影响', async () => {
    const { receipt } = await run({
      touchpointRows: [
        { occurred_at: '2026-10-19T09:30:00Z', metadata: { source_url: '/contact' } },
        { occurred_at: '2026-10-19T08:00:00Z', metadata: { source_url: 'https://www.example-shop.test/p?utm_content=a' } },
      ],
    })
    expect(statusOf(receipt, 'tracking.lead_reaches_crm')).toBe('green')
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

describe('collectCrmFacts · 广告落地页路径来自落地页配置', () => {
  it('把配置里每个落地页的路径（规范化、去重）交给读取器，事实里带回认的路径和广告落地页上的条数', async () => {
    const cfg: TrackingClientConfig = {
      ...CONFIG,
      landing_targets: [
        { label: 'A', url: `${SITE}/p?utm_content=a` },
        { label: 'B', url: `${SITE}/P/?utm_content=b` },
        { label: 'C', url: `${SITE}/q` },
      ],
    }
    const { deps } = makeDeps({
      touchpointRows: [
        { occurred_at: '2026-10-19T09:00:00Z', metadata: { source_url: '/contact' } },
        { occurred_at: '2026-10-19T08:00:00Z', metadata: { source_url: '/q' } },
      ],
    })
    const out = await collectCrmFacts('c1', cfg, deps)
    expect(out.facts).toMatchObject({
      read: true, web_form_touchpoints_7d: 2, ad_landing_paths: ['/p', '/q'],
      ad_landing_form_touchpoints_7d: 1, latest_ad_landing_form_at: '2026-10-19T08:00:00Z',
    })
  })

  it('没配落地页 → 不分类：事实里没有广告落地页那三项', async () => {
    const { deps } = makeDeps()
    const out = await collectCrmFacts('c1', { ...CONFIG, landing_targets: [] }, deps)
    expect(out.facts).not.toHaveProperty('ad_landing_paths')
    expect(out.facts.read).toBe(true)
  })

  it('没有官网表单的客户 → 不查库，事实里也没有分类项', async () => {
    const { deps, tables } = makeDeps()
    const out = await collectCrmFacts('c1', { ...CONFIG, web_form_to_crm: false }, deps)
    expect(tables).not.toContain('contact_touchpoints')
    expect(out.facts).not.toHaveProperty('ad_landing_paths')
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

describe('预算门 · 读库读线上（假网络 + 假库）', () => {
  const billing = (receipt: Awaited<ReturnType<typeof runClientPreflight>>) => receipt.gates.find(g => g.key === 'env.account_billing')

  it('collectBudgetFacts：账户级 + 客户级上限读库，在投日预算合计现读 Meta；错误标 budget 且不带令牌', async () => {
    const { deps, urls } = makeDeps()
    const out = await collectBudgetFacts('c1', CONFIG, deps)
    expect(out.errors).toEqual([])
    expect(out.facts).toMatchObject({
      read: true, account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 1,
      live_daily_budget_cents: 13400, live_entity_count: 1,
    })
    expect(urls.some(u => u.includes('act_1111111111/campaigns'))).toBe(true)
    expect(urls.some(u => u.includes('act_1111111111/adsets'))).toBe(true)
    expect(urls.some(u => u.includes(SECRET))).toBe(false)
  })

  it('整条链路：在投合计 NZ$134 ≤ 库里上限 NZ$150 → 预算门绿，证据里写明库里的上限和现读的合计', async () => {
    const { receipt } = await run()
    expect(billing(receipt)).toMatchObject({
      status: 'green',
      evidence: { account_cap_cents: 15000, client_cap_cents: 15000, live_daily_budget_cents: 13400, budget_read: true },
    })
  })

  it('🔴 在投合计超过库里的上限 → 红（以前拿写死的旧数字互相比，这种情况是假绿）', async () => {
    const { receipt } = await run({ adsets: [{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '16000' }] })
    expect(billing(receipt)?.status).toBe('red')
    expect(billing(receipt)?.reason).toContain('160.00')
    expect(receipt.preconditions_met).toBe(false)
  })

  it('🔴 库读失败 → 灰（硬门的灰会挡批准，黄不挡），哪怕客户配置里写死的数字看起来都对；错误记进读取错误（来源 budget）', async () => {
    const cfgLooksFine: TrackingClientConfig = { ...CONFIG, planned_daily_budget_cents: 10100, official_daily_cap_cents: 11000 }
    const { receipt } = await run({ capsError: 'boom' }, cfgLooksFine)
    expect(billing(receipt)?.status).toBe('gray')
    expect(billing(receipt)?.reason).toContain('没读到')
    expect(receipt.read_errors.some(e => e.source === 'budget' && e.error.includes('boom'))).toBe(true)
    expect(receipt.preconditions_met).toBe(false)
  })

  it('🔴 客户配置里被人重新写死的旧数字（计划 10100 / 官方上限 11000）再也变不成绿：跟库 / 线上对不上 → 黄', async () => {
    const reHardcoded: TrackingClientConfig = { ...CONFIG, planned_daily_budget_cents: 10100, official_daily_cap_cents: 11000 }
    const { receipt } = await run({}, reHardcoded)
    const g = billing(receipt)
    expect(g?.status).toBe('yellow')
    expect(g?.reason).toContain('110.00')
    expect(g?.reason).toContain('150.00')
    expect(g?.reason).toContain('101.00')
    expect(g?.reason).toContain('134.00')
  })

  it('没有可用的 Meta 令牌 → 预算那半边一个 Graph 请求都不发；库里的上限照读；读取错误里有 budget 一笔', async () => {
    const { deps, urls } = makeDeps({ token: null })
    const out = await collectBudgetFacts('c1', CONFIG, deps)
    expect(urls.filter(u => u.includes('graph.facebook.com'))).toEqual([])
    expect(out.facts).toMatchObject({ read: false, account_cap_cents: 15000, live_daily_budget_cents: null })
    expect(out.errors.some(e => e.source === 'budget' && e.error.includes('令牌'))).toBe(true)
  })

  it('找令牌第一次抛错、第二次正常 → 照常读；一直抛错 → 记「找 Meta 令牌时出错」', async () => {
    let n = 0
    const flaky = makeDeps()
    flaky.deps.resolveMetaToken = async () => { n += 1; if (n === 1) throw new Error('db blip'); return SECRET }
    expect((await collectBudgetFacts('c1', CONFIG, flaky.deps)).facts.read).toBe(true)

    const broken = makeDeps()
    broken.deps.resolveMetaToken = async () => { throw new Error('db down') }
    const out = await collectBudgetFacts('c1', CONFIG, broken.deps)
    expect(out.facts.read).toBe(false)
    expect(out.errors.some(e => e.error.includes('找 Meta 令牌时出错'))).toBe(true)
  })
})

// 🔴 魏征独立审查 #1（最严重）：读不到判黄但黄不拦批准 = 读不到当绿。
//    这一组把「真实的收集 → 真实的判灯 → 推广计划批准清单里的 blockers」整条接起来：
//    红 / 灰必须拦住批准，黄 / 绿不拦；每一种「读不到 / 没设 / 算不全」都必须落在会拦的那一边。
describe('预算门 · 判灯一路到批准拦截（端到端）', () => {
  const budgetBlocks = async (opts: DepsOpts, cfg: TrackingClientConfig = CONFIG) => {
    const { receipt } = await run(opts, cfg)
    const gates = receipt.gates
    const plan = evaluatePlanApproval(
      basePlanSpec(),
      goodPlanFacts({ tracking: { receipt: { checked_at: new Date(PLAN_NOW.getTime() - 2 * 3_600_000).toISOString(), gates } } }),
    )
    return {
      status: gates.find(g => g.key === 'env.account_billing')?.status,
      blocked: plan.blockers.some(b => b.key === 'env.account_billing'),
      listedAsUnverified: plan.unverified.some(b => b.key === 'env.account_billing'),
    }
  }

  it('健康（读全了、没超上限）→ 绿，不拦', async () => {
    expect(await budgetBlocks({})).toEqual({ status: 'green', blocked: false, listedAsUnverified: false })
  })

  it('超上限 → 红，拦', async () => {
    const r = await budgetBlocks({ adsets: [{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '16000' }] })
    expect(r).toMatchObject({ status: 'red', blocked: true })
  })

  it('🔴 读不到 / 没设 / 算不全 → 灰，拦（每一种都试一遍）', async () => {
    const cases: [string, DepsOpts][] = [
      ['库读失败', { capsError: 'boom' }],
      ['没有令牌', { token: null }],
      ['账户级和客户级上限都没设', { accountCap: null, clientCap: null }],
      ['账户级上限是 0（配置无效）', { accountCap: 0 }],
      ['客户级上限是 0（配置无效）', { clientCap: 0 }],
      ['有终身预算折不出日预算', { adsets: [{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '0', lifetime_budget: '90000' }] }],
      ['广告组预算乱码', { adsets: [{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: 'abc' }] }],
    ]
    for (const [name, opts] of cases) {
      const r = await budgetBlocks(opts)
      expect(r, name).toMatchObject({ status: 'gray', blocked: true })
    }
  })

  it('🔴 账户里一个在投的都没有（空返回）→ 黄，不出绿；黄不拦，但会列在「未核实」里提醒', async () => {
    const r = await budgetBlocks({ adsets: [] })
    expect(r).toEqual({ status: 'yellow', blocked: false, listedAsUnverified: true })
  })

  it('客户配置里的数字跟库 / 线上对不上 → 黄，不拦（读到的事实本身没问题，只是配置过期了）', async () => {
    const stale: TrackingClientConfig = { ...CONFIG, planned_daily_budget_cents: 10100, official_daily_cap_cents: 11000 }
    expect(await budgetBlocks({}, stale)).toEqual({ status: 'yellow', blocked: false, listedAsUnverified: true })
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

  // 🔴 第三轮整改：读回「没读到」= 灰灯 + 一条开发欠账；「还没花钱」= 灰灯但没有欠账。
  //    这条走真实的收集 → 判灯 → 组装回执，证明「读取错误」真的一路传到了欠账。
  it('端到端：没令牌 / 范围被拒 → 灰灯 + 一条欠账（带原因）；读到了但还没花钱 → 灰灯、没有欠账', async () => {
    const withSeries: TrackingClientConfig = {
      ...CONFIG,
      launch_watch: { from: '2026-10-19', days: 4, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'] },
    }
    const assemble = async (cfg: TrackingClientConfig, world: ReturnType<typeof makeDeps>) =>
      assemblePostLaunchReceipt({
        requestId: 'req-e2e', clientId: 'c1', cfg, phase: 'post_t1h', appBase: APP_BASE, now: NOW, launchedAt: LAUNCHED_AT,
        insights: await collectPostLaunchFacts('c1', cfg, LAUNCHED_AT, world.deps),
      })

    const noToken = await assemble(withSeries, makeDeps({ token: null }))
    expect(noToken.gates.map(g => g.status)).toEqual(['gray'])
    expect(noToken.items.map(i => i.gate_key)).toEqual(['post.t1h'])
    expect(noToken.items[0].what).toContain('令牌')
    expect(noToken.read_errors.some(e => e.source === 'insights')).toBe(true)

    const scopeRefused = await assemble(CONFIG, makeDeps()) // 配置里没有盯盘窗口 / 广告系列
    expect(scopeRefused.gates.map(g => g.status)).toEqual(['gray'])
    expect(scopeRefused.items).toHaveLength(1)
    expect(scopeRefused.items[0].what).toContain('广告系列')

    const noSpend = makeDeps()
    const inner = noSpend.deps.fetcher
    noSpend.deps.fetcher = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname.endsWith('/insights')
        ? new Response(JSON.stringify({ data: [] }), { status: 200 })
        : inner(input, init)) as typeof fetch
    const notSpendingYet = await assemble(withSeries, noSpend)
    expect(notSpendingYet.gates.map(g => g.status)).toEqual(['gray'])
    expect(notSpendingYet.gates[0].reason).toContain('还没开始花钱')
    expect(notSpendingYet.read_errors).toEqual([])
    expect(notSpendingYet.items).toEqual([])
  })
})

describe('收集函数 · 瞬时故障重试一次 + 广告系列范围（审查整改）', () => {
  it('找 Meta 令牌第一次抛错、第二次正常 → 照常读 Meta，没有「找令牌出错」', async () => {
    let n = 0
    const world = makeDeps()
    world.deps.resolveMetaToken = async () => { n += 1; if (n === 1) throw new Error('db blip'); return SECRET }
    const out = await collectMetaFacts('c1', CONFIG, [OFFICIAL], world.deps)
    expect(out.facts.read).toBe(true)
    expect(out.errors.some(e => e.error.includes('令牌'))).toBe(false)
    expect(n).toBe(2)
  })

  it('开投后读回：找令牌第一次抛错、第二次正常 → 照常发请求', async () => {
    let n = 0
    const world = makeDeps()
    world.deps.resolveMetaToken = async () => { n += 1; if (n === 1) throw new Error('db blip'); return SECRET }
    const withSeries: TrackingClientConfig = {
      ...CONFIG,
      launch_watch: { from: '2026-10-19', days: 4, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'] },
    }
    await collectPostLaunchFacts('c1', withSeries, '2026-10-19T09:00:00.000Z', world.deps)
    expect(world.urls.some(u => u.includes('/insights'))).toBe(true)
  })

  it('落地页第一次连接失败 → 用 deps 里的 sleep 等一下再试，第二次成功就是正常的', async () => {
    const sleeps: number[] = []
    let hits = 0
    const world = makeDeps()
    const inner = world.deps.fetcher
    world.deps.fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).hostname === 'www.example-shop.test') { hits += 1; if (hits === 1) throw new Error('reset') }
      return inner(input, init)
    }) as typeof fetch
    world.deps.sleep = async ms => { sleeps.push(ms) }
    const out = await collectLandingFacts(CONFIG, world.deps)
    expect(out.facts.probes[0].http_status).toBe(200)
    expect(out.errors).toEqual([])
    expect(sleeps).toHaveLength(1)
  })

  it('开投后读回按配置里本次投放的广告系列过滤（配置里没有盯盘窗口时看整个账户）', async () => {
    const withWatch: TrackingClientConfig = {
      ...CONFIG,
      launch_watch: { from: '2026-10-19', days: 4, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'] },
    }
    const scoped = makeDeps()
    await collectPostLaunchFacts('c1', withWatch, '2026-10-19T09:00:00.000Z', scoped.deps)
    const scopedUrl = new URL(scoped.urls.find(u => u.includes('/insights')) ?? '')
    expect(scopedUrl.searchParams.get('level')).toBe('campaign')
    expect(scopedUrl.searchParams.get('fields')).toContain('campaign_name')

    // 只给名字关键词（编号为空）也要按系列读
    const namesOnly: TrackingClientConfig = {
      ...CONFIG,
      launch_watch: { from: '2026-10-19', days: 4, timezone: 'Pacific/Auckland', campaign_ids: [], campaign_name_contains: ['官网点击'] },
    }
    const byName = makeDeps()
    await collectPostLaunchFacts('c1', namesOnly, '2026-10-19T09:00:00.000Z', byName.deps)
    expect(new URL(byName.urls.find(u => u.includes('/insights')) ?? '').searchParams.get('level')).toBe('campaign')

    // 🔴 第二轮审查整改：没配盯盘窗口 / 配了窗口没配系列 → 拒绝，绝不退回整个账户
    for (const cfg of [
      CONFIG,
      { ...CONFIG, launch_watch: { from: '2026-10-19', days: 4, timezone: 'Pacific/Auckland', campaign_ids: [] } },
      { ...CONFIG, launch_watch: { from: '2026-10-19', days: 4, timezone: 'Pacific/Auckland', campaign_ids: [], campaign_name_contains: [] } },
    ] as TrackingClientConfig[]) {
      const rejected = makeDeps()
      const out = await collectPostLaunchFacts('c1', cfg, '2026-10-19T09:00:00.000Z', rejected.deps)
      expect(out.facts.read).toBe(false)
      expect(out.errors.some(e => e.source === 'insights' && e.error.includes('广告系列'))).toBe(true)
      expect(rejected.urls.filter(u => u.includes('/insights'))).toEqual([])
    }
  })
})

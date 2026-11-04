import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildItemLinks, collectBudgetFacts, collectMetaFacts } from '../collect'
import { judgeAccountBilling } from '../judge'
import type { TrackingClientConfig } from '../types'
import adspixelsFixture from './fixtures/graph-adspixels.json'

// 全部虚构的编号。官方账户放像素 / 数据集；投放账户是另一个账户（广告实际在那里花钱）。
const OFFICIAL = 'act_1111111111'
const SPEND = 'act_2222222222'
const NOW = new Date('2026-10-28T00:00:00.000Z')

const CONFIG: TrackingClientConfig = {
  ad_account_id: OFFICIAL,
  site_url: 'https://www.example-shop.test',
  landing_targets: [],
  ga4_lead_events: [],
  web_form_to_crm: false,
  planned_daily_budget_cents: null,
  official_daily_cap_cents: null,
  currency: 'NZD',
}

function makeFetcher() {
  const urls: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    urls.push(url)
    const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (path === `${OFFICIAL}/adspixels`) return json(adspixelsFixture)
    if (path === OFFICIAL) return json({ account_status: 1, disable_reason: 0, funding_source: '3000000000000001', currency: 'NZD', spend_cap: '0', amount_spent: '0' })
    // 投放账户：状态码 2（不是正常状态），用来证明「账户与付款」读的是它而不是官方账户
    if (path === SPEND) return json({ account_status: 2, disable_reason: 0, funding_source: '3000000000000002', currency: 'NZD', spend_cap: '0', amount_spent: '0' })
    if (path === `${SPEND}/campaigns`) return json({ data: [{ id: '7001', effective_status: 'ACTIVE' }] })
    if (path === `${SPEND}/adsets`) return json({ data: [{ id: '8001', campaign_id: '7001', effective_status: 'ACTIVE', daily_budget: '8000' }] })
    if (path === `${OFFICIAL}/campaigns` || path === `${OFFICIAL}/adsets`) return json({ data: [] })
    return new Response('{}', { status: 404 })
  })
  return { fetcher, urls }
}

function makeDb(): SupabaseClient {
  const finish = (table: string) => {
    if (table === 'ad_strategy_configs') return { data: { daily_budget_cap_cents: 15000 }, error: null }
    if (table === 'client_meta_ad_accounts') {
      return {
        data: [
          { ad_account_id: OFFICIAL, daily_budget_cap_cents: 100 },
          { ad_account_id: SPEND, daily_budget_cap_cents: 14999 },
        ],
        error: null,
      }
    }
    return { data: null, error: { message: `不该读这张表：${table}` } }
  }
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq', 'gte', 'order']) chain[m] = () => chain
      chain.limit = () => Promise.resolve(finish(table))
      chain.maybeSingle = () => Promise.resolve(finish(table))
      chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(finish(table)).then(ok, bad)
      return chain
    },
  } as unknown as SupabaseClient
}

describe('spend_ad_account_id：广告实际投放的账户', () => {
  const cfg: TrackingClientConfig = { ...CONFIG, spend_ad_account_id: SPEND }

  it('数据集仍按官方账户读，账户状态改读投放账户', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await collectMetaFacts('c1', cfg, [], { now: NOW, fetcher, resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(out.facts.account?.status).toBe(2)
    expect(out.facts.account_dataset_ids.length).toBeGreaterThan(0)
    expect(urls.some(u => u.includes(`${OFFICIAL}/adspixels`))).toBe(true)
    expect(urls.some(u => u.includes(`${SPEND}/adspixels`))).toBe(false)
    expect(urls.some(u => new URL(u).pathname.endsWith(`/${SPEND}`))).toBe(true)
  })

  it('不写 spend_ad_account_id = 行为和以前完全一样（账户状态读官方账户）', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await collectMetaFacts('c1', CONFIG, [], { now: NOW, fetcher, resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(out.facts.account?.status).toBe(1)
    expect(urls.some(u => new URL(u).pathname.endsWith(`/${SPEND}`))).toBe(false)
  })

  it('写成和官方账户同一个 = 不多读一次', async () => {
    const { fetcher, urls } = makeFetcher()
    await collectMetaFacts('c1', { ...CONFIG, spend_ad_account_id: OFFICIAL }, [], { now: NOW, fetcher, resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(urls.filter(u => new URL(u).pathname.endsWith(`/${OFFICIAL}`)).length).toBe(1)
  })

  it('🔴 投放账户读不到时账户状态是 null、「账户与付款」判灰，绝不退回官方账户的状态当成绿', async () => {
    const urls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '')
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
      if (path === `${OFFICIAL}/adspixels`) return json(adspixelsFixture)
      if (path === OFFICIAL) return json({ account_status: 1, disable_reason: 0, funding_source: '3000000000000001', currency: 'NZD', spend_cap: '0', amount_spent: '0' })
      if (path === `${SPEND}/campaigns` || path === `${SPEND}/adsets`) return json({ data: [] })
      return new Response('{}', { status: 404 }) // 投放账户本身读不到
    })
    const meta = await collectMetaFacts('c1', cfg, [], { now: NOW, fetcher, resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(meta.facts.account).toBeNull()
    expect(meta.errors.length).toBeGreaterThan(0)
    const budget = await collectBudgetFacts('c1', cfg, { now: NOW, fetcher, supabase: makeDb(), resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(judgeAccountBilling({ config: cfg, meta: meta.facts, budget: budget.facts }).status).toBe('gray')
  })

  it('🔴 投放账户编号格式不对：账户状态 null，不发请求读它，也不退回官方账户', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await collectMetaFacts('c1', { ...CONFIG, spend_ad_account_id: 'not-an-account' }, [], { now: NOW, fetcher, resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(out.facts.account).toBeNull()
    expect(out.errors.some(e => e.error.includes('编号格式不对'))).toBe(true)
    expect(urls.some(u => u.includes('not-an-account'))).toBe(false)
  })

  it('没有 Meta 令牌：什么都不读，账户状态 null（和以前一样，不因新配置改变）', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await collectMetaFacts('c1', cfg, [], { now: NOW, fetcher, resolveMetaToken: async () => null, sleep: async () => {} })
    expect(out.facts.account).toBeNull()
    expect(urls.length).toBe(0)
  })

  it('预算：在投合计和上限都按投放账户读，不是官方账户', async () => {
    const { fetcher, urls } = makeFetcher()
    const out = await collectBudgetFacts('c1', cfg, { now: NOW, fetcher, supabase: makeDb(), resolveMetaToken: async () => 'T', sleep: async () => {} })
    expect(out.errors).toEqual([])
    expect(out.facts).toMatchObject({ read: true, live_daily_budget_cents: 8000, account_cap_cents: 14999, client_cap_cents: 15000 })
    expect(urls.some(u => u.includes(`${SPEND}/adsets`))).toBe(true)
    expect(urls.some(u => u.includes(`${OFFICIAL}/adsets`))).toBe(false)
  })

  it('账户与付款的红灯链接指向投放账户', () => {
    const links = buildItemLinks('c1', cfg, { appBase: 'https://app.example.test', datasetId: null })
    expect(links.byGate?.['env.account_billing']).toContain('2222222222')
    expect(links.byGate?.['env.account_billing']).not.toContain('1111111111')
    expect(buildItemLinks('c1', CONFIG, { appBase: 'https://app.example.test', datasetId: null }).byGate?.['env.account_billing']).toContain('1111111111')
  })
})

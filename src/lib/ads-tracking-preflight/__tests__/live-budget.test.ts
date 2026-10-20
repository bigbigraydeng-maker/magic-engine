/**
 * 批准那一刻现读「广告账户与付款 / 在投预算」这一道门（只读）。
 * 假库 + 假 fetch，不碰真网络。
 *
 * 为什么要有它：这道门的存档回执 12 小时过期，每天只在新西兰早上 7 点刷新一次；
 * 晚上批准时存档已过期，门判灰、挡批准，而手动触发的入口产品经理够不着。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { baseSpec, evaluateApproval, goodFacts, NOW as PLAN_NOW } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { loadTrackingGateFacts } from '../load-receipt'
import { buildClientReceipt, buildRunReceipt } from '../receipt'
import { HARD_GATE, PREFLIGHT_GATE_KEYS, type TrackingClientConfig, type TrackingGateReceipt } from '../types'
import accountFixture from './fixtures/graph-account.json'
import adspixelsFixture from './fixtures/graph-adspixels.json'

// 全部虚构的编号（平台通用代码的测试里不许出现真实客户的东西）。
const h = vi.hoisted((): { CONFIG: TrackingClientConfig } => ({
  CONFIG: {
    ad_account_id: 'act_1111111111',
    site_url: 'https://www.example-shop.test',
    landing_targets: [],
    ga4_lead_events: [],
    web_form_to_crm: false,
    planned_daily_budget_cents: null,
    official_daily_cap_cents: null,
    currency: 'NZD',
  },
}))

vi.mock('../client-config', () => ({
  getTrackingClientConfig: (id: string) => {
    if (id === 'broken') throw new Error('配置读坏了')
    return id === 'client-1' ? h.CONFIG : null
  },
  listTrackingClientIds: () => ['client-1'],
}))

// 让 collectBudgetFacts 默认走真函数，个别用例再让它抛错，验证「永不 reject」
vi.mock('../collect', async importOriginal => {
  const mod = await importOriginal<typeof import('../collect')>()
  return { ...mod, collectBudgetFacts: vi.fn(mod.collectBudgetFacts) }
})

import { collectBudgetFacts } from '../collect'
import { LIVE_BUDGET_DEADLINE_MS, readLiveBudgetGate, readLiveBudgetGateCached, resetLiveBudgetCache } from '../live-budget'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const TOKEN = 'SECRET_TOKEN_VALUE_123'
const noSleep = async (): Promise<void> => {}

interface World { adsetDaily?: string }

function fakeDb(): SupabaseClient {
  const finish = (table: string) => {
    if (table === 'client_meta_ad_accounts') return { data: [{ ad_account_id: 'act_1111111111', daily_budget_cap_cents: 15000 }], error: null }
    if (table === 'ad_strategy_configs') return { data: { daily_budget_cap_cents: 15000 }, error: null }
    return { data: null, error: { message: `unexpected table ${table}` } }
  }
  const db = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => finish(table),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(finish(table)).then(ok, bad),
      }
      return chain
    },
  }
  // 假库只实现被测代码真会调用的链式方法（select / eq / maybeSingle / 直接 await）。已跑：下面每条用例的查询都对着它走过一遍；
  // 写方法根本不存在，被测代码一旦调用就是 TypeError（证伪路径），不会静默通过。
  return db as unknown as SupabaseClient
}

function fakeFetcher(world: World) {
  const paths: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input)).pathname.replace(/^\/v\d+\.\d+\//, '')
    paths.push(path)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (path === 'act_1111111111/adspixels') return json(adspixelsFixture)
    if (path === 'act_1111111111') return json(accountFixture)
    if (path === 'act_1111111111/campaigns') return json({ data: [{ id: '5001', effective_status: 'ACTIVE' }] })
    if (path === 'act_1111111111/adsets') {
      return json({ data: [{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: world.adsetDaily ?? '13400' }] })
    }
    return new Response('{}', { status: 404 })
  })
  return { fetcher, paths }
}

function setup(over: { world?: World; token?: string | null; fetcher?: typeof fetch } = {}) {
  const net = fakeFetcher(over.world ?? {})
  return {
    net,
    deps: {
      now: NOW,
      fetcher: over.fetcher ?? net.fetcher,
      supabase: fakeDb(),
      resolveMetaToken: async () => (over.token === undefined ? TOKEN : over.token),
      sleep: noSleep,
    },
  }
}

beforeEach(() => {
  resetLiveBudgetCache()
  vi.mocked(collectBudgetFacts).mockClear()
})

describe('readLiveBudgetGate · 现读一次，判同一道门', () => {
  it('读到了 → 返回「广告账户与付款」这一道门的回执：灯来自同一个判灯函数，读取时间 = 现在，硬门', async () => {
    const { deps } = setup()
    const gate = await readLiveBudgetGate('client-1', deps)
    expect(gate).toMatchObject({ key: 'env.account_billing', status: 'green', hard: true, as_of: NOW.toISOString() })
    expect(gate?.reason).toContain('134.00')
    expect(gate?.evidence).toMatchObject({ live_daily_budget_cents: 13400, account_cap_cents: 15000, budget_read: true })
  })

  it('在投合计超过库里的上限 → 红（现读不是放行通道）', async () => {
    const { deps } = setup({ world: { adsetDaily: '16000' } })
    const gate = await readLiveBudgetGate('client-1', deps)
    expect(gate?.status).toBe('red')
    expect(gate?.reason).toContain('160.00')
  })

  it('🔴 没有令牌 → 读不到，是灰的回执（不是 null、更不是绿）；一个 Meta 请求都不发', async () => {
    const { deps, net } = setup({ token: null })
    const gate = await readLiveBudgetGate('client-1', deps)
    expect(gate).toMatchObject({ key: 'env.account_billing', status: 'gray', hard: true })
    expect(net.paths).toEqual([])
  })

  it('客户没配置追踪检查 → null，什么都不读', async () => {
    const { deps, net } = setup()
    await expect(readLiveBudgetGate('stranger', deps)).resolves.toBeNull()
    expect(net.paths).toEqual([])
  })

  it('只发 GET 读取类请求：账户、数据集列表、在投系列、在投广告组；不写任何东西', async () => {
    const { deps, net } = setup()
    await readLiveBudgetGate('client-1', deps)
    expect([...net.paths].sort()).toEqual(['act_1111111111', 'act_1111111111/adsets', 'act_1111111111/adspixels', 'act_1111111111/campaigns'])
    for (const call of net.fetcher.mock.calls) expect(call[1]?.method).toBe('GET')
  })

  it('🔴 永不 reject：查客户配置本身抛错 → null', async () => {
    const { deps } = setup()
    await expect(readLiveBudgetGate('broken', deps)).resolves.toBeNull()
    await expect(readLiveBudgetGateCached('broken', deps)).resolves.toBeNull()
  })

  it('🔴 永不 reject：读取过程里意外抛错 → null', async () => {
    vi.mocked(collectBudgetFacts).mockRejectedValueOnce(new Error('boom'))
    const { deps } = setup()
    await expect(readLiveBudgetGate('client-1', deps)).resolves.toBeNull()
  })

  it('🔴 有总时限：Meta 一直不回 → 到点返回 null，不拖住批准请求', async () => {
    const hang: typeof fetch = () => new Promise<Response>(() => {})
    const { deps } = setup({ fetcher: hang })
    const started = Date.now()
    await expect(readLiveBudgetGate('client-1', deps, { deadlineMs: 30 })).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
    expect(LIVE_BUDGET_DEADLINE_MS).toBeGreaterThan(0)
    expect(LIVE_BUDGET_DEADLINE_MS).toBeLessThanOrEqual(15_000)
  })
})

describe('readLiveBudgetGateCached · 不能被刷', () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms)

  it('同一个客户 60 秒内只读一次 Meta；同时进来的请求共用同一次读取；满 60 秒重新读', async () => {
    const { deps, net } = setup()
    const [a, b] = await Promise.all([readLiveBudgetGateCached('client-1', deps), readLiveBudgetGateCached('client-1', deps)])
    expect(a).toBe(b)
    const oneRound = net.fetcher.mock.calls.length
    expect(oneRound).toBe(4)

    await readLiveBudgetGateCached('client-1', { ...deps, now: at(59_000) })
    expect(net.fetcher.mock.calls.length).toBe(oneRound)

    await readLiveBudgetGateCached('client-1', { ...deps, now: at(60_000) })
    expect(net.fetcher.mock.calls.length).toBe(oneRound * 2)
  })

  it('按客户分开缓存：别的客户不会拿到这个客户的结果', async () => {
    const { deps } = setup()
    await readLiveBudgetGateCached('client-1', deps)
    await expect(readLiveBudgetGateCached('stranger', deps)).resolves.toBeNull()
  })

  it('没读成（null）的只缓存 10 秒：让人很快能重试，但也不会每次刷新都重读', async () => {
    vi.mocked(collectBudgetFacts).mockRejectedValueOnce(new Error('boom'))
    const { deps } = setup()
    await expect(readLiveBudgetGateCached('client-1', deps)).resolves.toBeNull()
    // 10 秒内：还是上一次的结果（null），没有重读
    await expect(readLiveBudgetGateCached('client-1', { ...deps, now: at(9_000) })).resolves.toBeNull()
    expect(vi.mocked(collectBudgetFacts)).toHaveBeenCalledTimes(1)
    // 满 10 秒：重读，这次读成了
    const retry = await readLiveBudgetGateCached('client-1', { ...deps, now: at(10_000) })
    expect(retry?.status).toBe('green')
    expect(vi.mocked(collectBudgetFacts)).toHaveBeenCalledTimes(2)
  })
})

// ─── 端到端：存档过期的晚上 ──────────────────────────────────────────────────
// 真实读取 → 真实判灯 → 真实装进检查清单 → 批准清单的硬门（blockers）。
// 这条链路上任何一环断了，晚上批准要么永远灰（老毛病），要么该挡的没挡住。
describe('端到端 · 存档过期的晚上（载入存档 → 现读预算门 → 批准清单）', () => {
  const KEY = 'env.account_billing'
  const at = (hoursAgo: number): string => new Date(PLAN_NOW.getTime() - hoursAgo * 3_600_000).toISOString()

  /** 20 小时前写的一份全绿存档；cron_run_logs 以外的表照常走上面的假库。 */
  function storedReceiptDb(): SupabaseClient {
    const gates: TrackingGateReceipt[] = PREFLIGHT_GATE_KEYS.map(key =>
      ({ key, status: 'green', reason: 'ok', how: '', evidence: {}, as_of: at(20), hard: HARD_GATE[key] }))
    const client = buildClientReceipt({
      requestId: 'r-1', clientId: 'client-1', checkedAt: at(20), trigger: 'cron', phase: 'preflight',
      gates, readErrors: [], links: { fallback: 'https://app.example.test/plan' },
    })
    const run = buildRunReceipt({ requestId: 'run-1', checkedAt: at(20), trigger: 'cron', clients: [client] })
    const db = {
      from() {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: async () => ({ data: [{ status: 'completed', started_at: at(20), summary: run }], error: null }),
        }
        return chain
      },
    }
    // 只实现被测代码真会调用的链式方法（已跑：每条用例都走过 select / eq / order / limit）
    return db as unknown as SupabaseClient
  }

  async function approvalBlockers(over: { world?: World; token?: string | null; live: boolean }) {
    const net = fakeFetcher(over.world ?? {})
    const deps = {
      now: PLAN_NOW,
      fetcher: net.fetcher,
      supabase: fakeDb(),
      resolveMetaToken: async () => (over.token === undefined ? TOKEN : over.token),
      sleep: noSleep,
    }
    const tracking = await loadTrackingGateFacts(storedReceiptDb(), 'client-1', {
      now: PLAN_NOW,
      ...(over.live ? { readLiveBudget: (id: string) => readLiveBudgetGate(id, deps) } : {}),
    })
    return evaluateApproval(baseSpec(), goodFacts({ tracking })).blockers.map(b => b.key)
  }

  it('🔴 没要求现读：存档 20 小时 → 预算门灰、挡批准（老毛病，证明这条链路确实是靠现读才通的）', async () => {
    expect(await approvalBlockers({ live: false })).toContain(KEY)
  })

  it('现读到了、没超上限 → 预算门不再挡批准', async () => {
    expect(await approvalBlockers({ live: true })).not.toContain(KEY)
  })

  it('🔴 现读到在投预算超过库里的上限 → 红，挡批准（现读不是放行通道）', async () => {
    expect(await approvalBlockers({ live: true, world: { adsetDaily: '16000' } })).toContain(KEY)
  })

  it('🔴 现读读不到（没有令牌）→ 灰，挡批准——存档里那份 20 小时前的绿不能顶替', async () => {
    expect(await approvalBlockers({ live: true, token: null })).toContain(KEY)
  })
})

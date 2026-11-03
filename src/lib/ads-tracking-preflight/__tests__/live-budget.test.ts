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
import { LIVE_BUDGET_DEADLINE_MS, linkSignals, readLiveBudgetGate, readLiveBudgetGateCached, resetLiveBudgetCache } from '../live-budget'

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

  it('🔴 有总时限，到点真取消：Meta 一直不回 → 到点返回 null，底层请求一并被 abort，不留在后台继续跑', async () => {
    const signals: AbortSignal[] = []
    let inFlight = 0
    const hang: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      inFlight += 1
      const signal = init?.signal
      if (signal) signals.push(signal)
      signal?.addEventListener('abort', () => {
        inFlight -= 1
        reject(new Error('aborted'))
      })
    })
    const { deps } = setup({ fetcher: hang })
    const started = Date.now()
    await expect(readLiveBudgetGate('client-1', deps, { deadlineMs: 30 })).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every(sig => sig.aborted)).toBe(true)
    expect(inFlight).toBe(0)
    expect(LIVE_BUDGET_DEADLINE_MS).toBeGreaterThan(0)
    expect(LIVE_BUDGET_DEADLINE_MS).toBeLessThanOrEqual(15_000)
  })

  it('读得完的时候不取消：正常读完后底层请求的信号没有被 abort', async () => {
    const signals: AbortSignal[] = []
    const { deps, net } = setup()
    const spy: typeof fetch = (input, init) => {
      if (init?.signal) signals.push(init.signal)
      return net.fetcher(input, init)
    }
    await readLiveBudgetGate('client-1', { ...deps, fetcher: spy })
    expect(signals.length).toBe(4)
    expect(signals.every(sig => !sig.aborted)).toBe(true)
  })
})

describe('linkSignals · 两个取消信号并成一个', () => {
  it('读取器自己的 15 秒超时信号和我们的总时限信号，任一触发都取消；没有外层信号就直接用我们的', () => {
    const inner = new AbortController()
    expect(linkSignals(undefined, inner.signal)).toBe(inner.signal)
    expect(linkSignals(null, inner.signal)).toBe(inner.signal)

    const outerA = new AbortController()
    const innerA = new AbortController()
    const merged = linkSignals(outerA.signal, innerA.signal)
    expect(merged.aborted).toBe(false)
    outerA.abort()
    expect(merged.aborted).toBe(true)

    const outerB = new AbortController()
    const innerB = new AbortController()
    const mergedB = linkSignals(outerB.signal, innerB.signal)
    innerB.abort()
    expect(mergedB.aborted).toBe(true)
  })

  it('任一信号一开始就已经取消 → 并出来的信号也是已取消', () => {
    const done = new AbortController()
    done.abort()
    const fresh = new AbortController()
    expect(linkSignals(done.signal, fresh.signal).aborted).toBe(true)
    expect(linkSignals(fresh.signal, done.signal).aborted).toBe(true)
  })
})

describe('readLiveBudgetGateCached · 不能被刷', () => {
  // 假时钟：缓存的计时只看它，不看真实时间
  function fakeClock() {
    let t = 1_000_000
    return { now: () => t, advance: (ms: number) => { t += ms } }
  }

  it('同一个客户 60 秒内只读一次 Meta；同时进来的请求共用同一次读取；从读完起满 60 秒重新读', async () => {
    const { deps, net } = setup()
    const clk = fakeClock()
    const opts = { clock: clk.now }
    const [a, b] = await Promise.all([readLiveBudgetGateCached('client-1', deps, opts), readLiveBudgetGateCached('client-1', deps, opts)])
    expect(a).toBe(b)
    const oneRound = net.fetcher.mock.calls.length
    expect(oneRound).toBe(4)

    clk.advance(59_000)
    await readLiveBudgetGateCached('client-1', deps, opts)
    expect(net.fetcher.mock.calls.length).toBe(oneRound)

    clk.advance(1_000)
    await readLiveBudgetGateCached('client-1', deps, opts)
    expect(net.fetcher.mock.calls.length).toBe(oneRound * 2)
  })

  it('按客户分开缓存：别的客户不会拿到这个客户的结果', async () => {
    const { deps } = setup()
    const opts = { clock: fakeClock().now }
    await readLiveBudgetGateCached('client-1', deps, opts)
    await expect(readLiveBudgetGateCached('stranger', deps, opts)).resolves.toBeNull()
  })

  it('没读成（null）的只缓存 10 秒：让人很快能重试，但也不会每次刷新都重读', async () => {
    vi.mocked(collectBudgetFacts).mockRejectedValueOnce(new Error('boom'))
    const { deps } = setup()
    const clk = fakeClock()
    const opts = { clock: clk.now }
    await expect(readLiveBudgetGateCached('client-1', deps, opts)).resolves.toBeNull()
    // 10 秒内：还是上一次的结果（null），没有重读
    clk.advance(9_000)
    await expect(readLiveBudgetGateCached('client-1', deps, opts)).resolves.toBeNull()
    expect(vi.mocked(collectBudgetFacts)).toHaveBeenCalledTimes(1)
    // 满 10 秒：重读，这次读成了
    clk.advance(1_000)
    const retry = await readLiveBudgetGateCached('client-1', deps, opts)
    expect(retry?.status).toBe('green')
    expect(vi.mocked(collectBudgetFacts)).toHaveBeenCalledTimes(2)
  })

  it('🔴 失败缓存的 10 秒从「读完」那一刻起算，不是从请求开始：读了 12 秒才超时，紧接着的请求仍命中失败缓存，不会再叠一轮读取', async () => {
    const clk = fakeClock()
    let calls = 0
    const slowAndHung: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      calls += 1
      clk.advance(12_000) // 这一轮读取在假时钟上花了 12 秒
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
    const { deps } = setup({ fetcher: slowAndHung })
    const opts = { clock: clk.now, deadlineMs: 30 }
    await expect(readLiveBudgetGateCached('client-1', deps, opts)).resolves.toBeNull()
    const callsAfterFirst = calls
    expect(callsAfterFirst).toBeGreaterThan(0)
    // 紧接着再来一次：按“读完那一刻”算还在 10 秒内 → 命中，没有新请求
    await expect(readLiveBudgetGateCached('client-1', deps, opts)).resolves.toBeNull()
    expect(calls).toBe(callsAfterFirst)
    // 又过了 10 秒才重读
    clk.advance(10_000)
    await expect(readLiveBudgetGateCached('client-1', deps, opts)).resolves.toBeNull()
    expect(calls).toBeGreaterThan(callsAfterFirst)
  })

  it('读的过程中进来的请求共用同一次读取（不管读了多久）；读完后一直读到的就是同一个结果', async () => {
    const clk = fakeClock()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const { deps, net } = setup()
    const slow: typeof fetch = async (input, init) => {
      await gate
      return net.fetcher(input, init)
    }
    const opts = { clock: clk.now }
    const first = readLiveBudgetGateCached('client-1', { ...deps, fetcher: slow }, opts)
    clk.advance(120_000) // 读了两分钟还没读完：仍算“在读”，不能再起一轮
    const second = readLiveBudgetGateCached('client-1', { ...deps, fetcher: slow }, opts)
    expect(second).toBe(first)
    release?.()
    expect((await first)?.status).toBe('green')
  })
})

// ─── 端到端：存档过期的晚上 / 存档还新但有人加了广告 ───────────────────────────
// 真实读取 → 真实判灯 → 真实装进检查清单 → 批准清单的硬门（blockers）。
// 这条链路上任何一环断了，晚上批准要么永远灰（老毛病），要么该挡的没挡住。
describe('端到端 · 载入存档 → 现读预算门 → 批准清单', () => {
  const KEY = 'env.account_billing'
  const at = (hoursAgo: number): string => new Date(PLAN_NOW.getTime() - hoursAgo * 3_600_000).toISOString()

  /** N 小时前写的一份存档（全绿）；cron_run_logs 以外的表照常走上面的假库。 */
  function storedReceiptDb(ageHours: number): SupabaseClient {
    const gates: TrackingGateReceipt[] = PREFLIGHT_GATE_KEYS.map(key =>
      ({ key, status: 'green', reason: 'ok', how: '', evidence: {}, as_of: at(ageHours), hard: HARD_GATE[key] }))
    const client = buildClientReceipt({
      requestId: 'r-1', clientId: 'client-1', checkedAt: at(ageHours), trigger: 'cron', phase: 'preflight',
      gates, readErrors: [], links: { fallback: 'https://app.example.test/plan' },
    })
    const run = buildRunReceipt({ requestId: 'run-1', checkedAt: at(ageHours), trigger: 'cron', clients: [client] })
    const db = {
      from() {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: async () => ({ data: [{ status: 'completed', started_at: at(ageHours), summary: run }], error: null }),
        }
        return chain
      },
    }
    // 只实现被测代码真会调用的链式方法（已跑：每条用例都走过 select / eq / order / limit）
    return db as unknown as SupabaseClient
  }

  interface Run { world?: World; token?: string | null; ageHours?: number; live?: 'if_needed' | 'always' }

  async function approval(over: Run) {
    const net = fakeFetcher(over.world ?? {})
    const deps = {
      now: PLAN_NOW,
      fetcher: net.fetcher,
      supabase: fakeDb(),
      resolveMetaToken: async () => (over.token === undefined ? TOKEN : over.token),
      sleep: noSleep,
    }
    const tracking = await loadTrackingGateFacts(storedReceiptDb(over.ageHours ?? 20), 'client-1', {
      now: PLAN_NOW,
      ...(over.live ? { readLiveBudget: (id: string) => readLiveBudgetGate(id, deps), liveMode: over.live } : {}),
    })
    const verdict = evaluateApproval(baseSpec(), goodFacts({ tracking }))
    return { blockers: verdict.blockers.map(b => b.key), budget: verdict.results.find(r => r.key === KEY), reads: net.paths.length }
  }

  beforeEach(() => resetLiveBudgetCache())

  it('🔴 没要求现读：存档 20 小时 → 预算门灰、挡批准（老毛病，证明这条链路确实是靠现读才通的）', async () => {
    expect((await approval({})).blockers).toContain(KEY)
  })

  it('现读到了、没超上限 → 预算门不再挡批准，来源标「现读」', async () => {
    const out = await approval({ live: 'if_needed' })
    expect(out.blockers).not.toContain(KEY)
    expect(out.budget?.source).toBe('live')
  })

  it('🔴 现读到在投预算超过库里的上限 → 红，挡批准（现读不是放行通道）', async () => {
    expect((await approval({ live: 'if_needed', world: { adsetDaily: '16000' } })).blockers).toContain(KEY)
  })

  it('🔴 现读读不到（没有令牌）→ 灰，挡批准——存档里那份 20 小时前的绿不能顶替', async () => {
    expect((await approval({ live: 'if_needed', token: null })).blockers).toContain(KEY)
  })

  it('🔴 存档才 1 小时、是绿，但这会儿有人在广告后台加了广告（在投合计 160 > 上限 150）：if_needed 采信存档的绿（旧），always 现读 → 红，挡批准——所以批准路由必须用 always', async () => {
    const stale = await approval({ ageHours: 1, live: 'if_needed', world: { adsetDaily: '16000' } })
    expect(stale.blockers).not.toContain(KEY)
    expect(stale.budget?.source).toBe('receipt')
    expect(stale.reads).toBe(0) // 存档够新，没多打一次 Meta

    const fresh = await approval({ ageHours: 1, live: 'always', world: { adsetDaily: '16000' } })
    expect(fresh.blockers).toContain(KEY)
    expect(fresh.budget).toMatchObject({ light: 'red', source: 'live' })
  })

  it('🔴 always 且现读得到的是灰（没有令牌）：灰的现读结果优先于存档里的绿，挡批准——读不到就不放行', async () => {
    const out = await approval({ ageHours: 1, live: 'always', token: null })
    expect(out.budget).toMatchObject({ light: 'gray', source: 'live' })
    expect(out.blockers).toContain(KEY)
  })

  it('🔴 现读整个失败（超时 / 抛错 → null）：always（授权）一律灰挡批准，哪怕存档才 1 小时、是绿；if_needed（只是展示）存档还新就照存档，并留底「想现读没读成」', async () => {
    const tracking = async (liveMode: 'if_needed' | 'always', ageHours: number) =>
      loadTrackingGateFacts(storedReceiptDb(ageHours), 'client-1', { now: PLAN_NOW, readLiveBudget: async () => null, liveMode })
    const verdict = async (liveMode: 'if_needed' | 'always', ageHours: number) => {
      const v = evaluateApproval(baseSpec(), goodFacts({ tracking: await tracking(liveMode, ageHours) }))
      return { blocked: v.blockers.some(b => b.key === KEY), budget: v.results.find(r => r.key === KEY) }
    }
    const always = await verdict('always', 1)
    expect(always.blocked).toBe(true)
    expect(always.budget?.light).toBe('gray')
    expect(always.budget?.source).toBeUndefined()

    const display = await verdict('if_needed', 1) // 存档 1 小时、绿 → 本来就不会现读
    expect(display.blocked).toBe(false)
    const displayStale = await verdict('if_needed', 20) // 存档过期 + 现读失败 → 灰
    expect(displayStale.blocked).toBe(true)
  })
})

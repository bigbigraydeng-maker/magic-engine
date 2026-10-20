import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client-config', () => ({
  getTrackingClientConfig: (id: string) => (id === 'c1' ? {} : null),
  listTrackingClientIds: () => ['c1'],
}))

import { loadTrackingGateFacts } from '../load-receipt'
import { TRACKING_PREFLIGHT_JOB, buildClientReceipt, buildRunReceipt } from '../receipt'
import { HARD_GATE, type TrackingGateReceipt } from '../types'

const AT = '2026-10-19T07:00:00.000Z'

function receiptFor(clientId: string) {
  return buildClientReceipt({
    requestId: `r-${clientId}`, clientId, checkedAt: AT, trigger: 'cron', phase: 'preflight',
    gates: [{ key: 'tracking.pixel_alive', status: 'green', reason: 'ok', how: '', evidence: {}, as_of: AT, hard: HARD_GATE['tracking.pixel_alive'] }],
    readErrors: [], links: { fallback: 'https://app.example.test/plan' },
  })
}

interface Recorded { table: string; filters: [string, unknown][]; order: string | null; limit: number | null }

function fakeDb(result: { data: unknown; error: { message: string } | null } | 'throw') {
  const rec: Recorded = { table: '', filters: [], order: null, limit: null }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (c: string, v: unknown) => { rec.filters.push([c, v]); return chain }
  chain.order = (c: string) => { rec.order = c; return chain }
  chain.limit = async (n: number) => {
    rec.limit = n
    if (result === 'throw') throw new Error('连接断了')
    return result
  }
  // 假库只实现被测代码真会调用的链式方法（已跑：下面每条用例都走过它），仓库里其它测试同款写法
  const supabase = { from: (t: string) => { rec.table = t; return chain } } as unknown as SupabaseClient
  return { supabase, rec }
}

describe('loadTrackingGateFacts · 给推广计划检查清单读最近一份回执', () => {
  it('客户没配置追踪检查 → undefined（清单里不出现追踪门），而且一次库都不读', async () => {
    // 一碰就炸的假库：证明没配置的客户一次库都不读（已跑：这条用例会在被测代码读库时直接红）
    const supabase = { from: () => { throw new Error('不该读库') } } as unknown as SupabaseClient
    await expect(loadTrackingGateFacts(supabase, 'stranger')).resolves.toBeUndefined()
  })

  it('配置了、最近的运行记录里有这个客户的回执 → 带回时间和各道门', async () => {
    const run = buildRunReceipt({ requestId: 'run', checkedAt: AT, trigger: 'cron', clients: [receiptFor('c1')] })
    const { supabase, rec } = fakeDb({ data: [{ status: 'completed', started_at: AT, summary: run }], error: null })

    const out = await loadTrackingGateFacts(supabase, 'c1')

    expect(out?.receipt?.checked_at).toBe(AT)
    expect(out?.receipt?.gates.map(g => g.key)).toEqual(['tracking.pixel_alive'])
    expect(rec.table).toBe('cron_run_logs')
    expect(rec.filters).toContainEqual(['job_name', TRACKING_PREFLIGHT_JOB])
    expect(rec.order).toBe('started_at')
    expect(rec.limit).toBeGreaterThanOrEqual(10)
  })

  it('配置了但最近的运行里没有这个客户 → receipt 为 null（全灰），不是 undefined', async () => {
    const run = buildRunReceipt({ requestId: 'run', checkedAt: AT, trigger: 'cron', clients: [receiptFor('other')] })
    const { supabase } = fakeDb({ data: [{ status: 'completed', started_at: AT, summary: run }], error: null })
    await expect(loadTrackingGateFacts(supabase, 'c1')).resolves.toEqual({ receipt: null, client_id: 'c1' })
  })

  // 🔴 审查整改：开投后读回的回执和体检写在同一个任务名下，不挑阶段会让看板十道门全灰
  const postRunFor = (clientId: string, checkedAt: string) => buildRunReceipt({
    requestId: 'run-post', checkedAt, trigger: 'postlaunch',
    clients: [buildClientReceipt({
      requestId: `r-post-${clientId}`, clientId, checkedAt, trigger: 'postlaunch', phase: 'post_t1h', launchedAt: AT,
      gates: [{ key: 'post.t1h', status: 'green', reason: 'ok', how: '', evidence: {}, as_of: checkedAt, hard: HARD_GATE['post.t1h'] }],
      readErrors: [], links: { fallback: 'https://app.example.test/plan' },
    })],
  })

  it('更新的一轮是开投后读回（只有 post.t1h 一道门）→ 仍读更早的开投前回执，不被读回顶掉', async () => {
    const pre = buildRunReceipt({ requestId: 'run-pre', checkedAt: AT, trigger: 'cron', clients: [receiptFor('c1')] })
    const laterAt = '2026-10-19T09:30:00.000Z'
    const { supabase } = fakeDb({
      data: [
        { status: 'completed', started_at: laterAt, summary: postRunFor('c1', laterAt) },
        { status: 'completed', started_at: AT, summary: pre },
      ],
      error: null,
    })
    const out = await loadTrackingGateFacts(supabase, 'c1')
    expect(out?.receipt?.checked_at).toBe(AT)
    expect(out?.receipt?.gates.map(g => g.key)).toEqual(['tracking.pixel_alive'])
  })

  it('最近几轮里只有开投后读回 → receipt 为 null（全灰），不拿读回当体检', async () => {
    const { supabase } = fakeDb({ data: [{ status: 'completed', started_at: AT, summary: postRunFor('c1', AT) }], error: null })
    await expect(loadTrackingGateFacts(supabase, 'c1')).resolves.toEqual({ receipt: null, client_id: 'c1' })
  })

  it('读库报错 / 直接抛错 → receipt 为 null（读不到就灰，不当成没问题）', async () => {
    await expect(loadTrackingGateFacts(fakeDb({ data: null, error: { message: 'boom' } }).supabase, 'c1')).resolves.toEqual({ receipt: null, client_id: 'c1' })
    await expect(loadTrackingGateFacts(fakeDb('throw').supabase, 'c1')).resolves.toEqual({ receipt: null, client_id: 'c1' })
  })
})

// ─── 批准 / 看板现读预算门（readLiveBudget）──────────────────────────────────
describe('loadTrackingGateFacts · 存档的预算门不可用时现读', () => {
  const KEY = 'env.account_billing'
  const NOW = new Date('2026-10-21T10:00:00.000Z') // 新西兰晚上 23:00
  const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()

  const budgetGate = (status: TrackingGateReceipt['status'], at: string): TrackingGateReceipt =>
    ({ key: KEY, status, reason: 'x', how: '', evidence: {}, as_of: at, hard: HARD_GATE[KEY] })

  /** 一份只含「预算门」的存档回执，写在 checkedAt 那一刻。 */
  function dbWith(checkedAt: string, gates: TrackingGateReceipt[]) {
    const clientReceipt = buildClientReceipt({
      requestId: 'r-c1', clientId: 'c1', checkedAt, trigger: 'cron', phase: 'preflight',
      gates, readErrors: [], links: { fallback: 'https://app.example.test/plan' },
    })
    const run = buildRunReceipt({ requestId: 'run', checkedAt, trigger: 'cron', clients: [clientReceipt] })
    return fakeDb({ data: [{ status: 'completed', started_at: checkedAt, summary: run }], error: null }).supabase
  }

  const LIVE: TrackingGateReceipt = budgetGate('green', NOW.toISOString())

  it('调用方没要求现读（没传 readLiveBudget）→ 只读存档，live_budget 不出现——后台任务不去打 Meta', async () => {
    const out = await loadTrackingGateFacts(dbWith(hoursAgo(20), [budgetGate('green', hoursAgo(20))]), 'c1', { now: NOW })
    expect(out).toMatchObject({ client_id: 'c1', receipt: { checked_at: hoursAgo(20) } })
    expect(out && 'live_budget' in out).toBe(false)
  })

  it('存档够新（12 小时内）而且是绿或黄 → 直接用存档，不现读', async () => {
    for (const status of ['green', 'yellow'] as const) {
      const readLiveBudget = vi.fn(async () => LIVE)
      const out = await loadTrackingGateFacts(dbWith(hoursAgo(11), [budgetGate(status, hoursAgo(11))]), 'c1', { now: NOW, readLiveBudget })
      expect(readLiveBudget, status).not.toHaveBeenCalled()
      expect(out && 'live_budget' in out, status).toBe(false)
    }
  })

  it('🔴 存档过期（超过 12 小时）→ 现读，结果放进 live_budget；晚上不再永远灰', async () => {
    const readLiveBudget = vi.fn(async () => LIVE)
    const out = await loadTrackingGateFacts(dbWith(hoursAgo(13), [budgetGate('green', hoursAgo(13))]), 'c1', { now: NOW, readLiveBudget })
    expect(readLiveBudget).toHaveBeenCalledTimes(1)
    expect(readLiveBudget).toHaveBeenCalledWith('c1')
    expect(out?.live_budget).toEqual(LIVE)
    // 恰好 12 小时还算新鲜（跟 gates.ts 的“超过 12 小时才过期”同一口径）
    const edge = vi.fn(async () => LIVE)
    await loadTrackingGateFacts(dbWith(hoursAgo(12), [budgetGate('green', hoursAgo(12))]), 'c1', { now: NOW, readLiveBudget: edge })
    expect(edge).not.toHaveBeenCalled()
  })

  it('存档够新但预算门是红或灰 → 也现读（人可能刚把问题修掉了，不用等第二天早上 7 点）', async () => {
    for (const status of ['red', 'gray'] as const) {
      const readLiveBudget = vi.fn(async () => LIVE)
      const out = await loadTrackingGateFacts(dbWith(hoursAgo(2), [budgetGate(status, hoursAgo(2))]), 'c1', { now: NOW, readLiveBudget })
      expect(readLiveBudget, status).toHaveBeenCalledTimes(1)
      expect(out?.live_budget, status).toEqual(LIVE)
    }
  })

  it('🔴 always（批准这类授权动作）：存档再新、再绿也现读——存档里的绿 / 黄最多能用 12 小时，期间有人在广告后台加了广告', async () => {
    for (const status of ['green', 'yellow'] as const) {
      const readLiveBudget = vi.fn(async () => LIVE)
      const out = await loadTrackingGateFacts(dbWith(hoursAgo(1), [budgetGate(status, hoursAgo(1))]), 'c1', { now: NOW, readLiveBudget, liveMode: 'always' })
      expect(readLiveBudget, status).toHaveBeenCalledTimes(1)
      expect(out?.live_budget, status).toEqual(LIVE)
    }
  })

  it('always 时带上 live_required（授权动作：现读没读成不许回落存档）；if_needed 不带', async () => {
    const stale = dbWith(hoursAgo(20), [budgetGate('green', hoursAgo(20))])
    const always = await loadTrackingGateFacts(stale, 'c1', { now: NOW, readLiveBudget: async () => null, liveMode: 'always' })
    expect(always).toMatchObject({ live_budget: null, live_required: true })
    const display = await loadTrackingGateFacts(stale, 'c1', { now: NOW, readLiveBudget: async () => null, liveMode: 'if_needed' })
    expect(display?.live_budget).toBeNull()
    expect(display && 'live_required' in display).toBe(false)
  })

  it('liveMode 写 if_needed 与不写等价；always 但没传现读函数 → 照样只读存档，不会凭空现读', async () => {
    const fresh = dbWith(hoursAgo(1), [budgetGate('green', hoursAgo(1))])
    const skipped = vi.fn(async () => LIVE)
    await loadTrackingGateFacts(fresh, 'c1', { now: NOW, readLiveBudget: skipped, liveMode: 'if_needed' })
    expect(skipped).not.toHaveBeenCalled()
    const out = await loadTrackingGateFacts(fresh, 'c1', { now: NOW, liveMode: 'always' })
    expect(out && 'live_budget' in out).toBe(false)
  })

  it('没有存档 / 存档里缺预算这一项 → 现读', async () => {
    const none = vi.fn(async () => LIVE)
    const noReceipt = await loadTrackingGateFacts(fakeDb({ data: [], error: null }).supabase, 'c1', { now: NOW, readLiveBudget: none })
    expect(none).toHaveBeenCalledTimes(1)
    expect(noReceipt).toMatchObject({ receipt: null, live_budget: LIVE })

    const missing = vi.fn(async () => LIVE)
    const otherGate: TrackingGateReceipt = { key: 'tracking.pixel_alive', status: 'green', reason: 'ok', how: '', evidence: {}, as_of: hoursAgo(1), hard: HARD_GATE['tracking.pixel_alive'] }
    await loadTrackingGateFacts(dbWith(hoursAgo(1), [otherGate]), 'c1', { now: NOW, readLiveBudget: missing })
    expect(missing).toHaveBeenCalledTimes(1)
  })

  it('🔴 现读没读成（返回 null）或直接抛错 → live_budget 为 null，不是 undefined：让清单知道“试过了没读成”', async () => {
    const stale = dbWith(hoursAgo(20), [budgetGate('green', hoursAgo(20))])
    const returnsNull = await loadTrackingGateFacts(stale, 'c1', { now: NOW, readLiveBudget: async () => null })
    expect(returnsNull?.live_budget).toBeNull()
    const throws = await loadTrackingGateFacts(stale, 'c1', { now: NOW, readLiveBudget: async () => { throw new Error('连接断了') } })
    expect(throws?.live_budget).toBeNull()
  })

  it('没配置追踪检查的客户 → undefined，现读函数一次都不叫', async () => {
    const readLiveBudget = vi.fn(async () => LIVE)
    const supabase = { from: () => { throw new Error('不该读库') } } as unknown as SupabaseClient
    await expect(loadTrackingGateFacts(supabase, 'stranger', { now: NOW, readLiveBudget })).resolves.toBeUndefined()
    expect(readLiveBudget).not.toHaveBeenCalled()
  })
})

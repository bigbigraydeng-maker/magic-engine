/**
 * 熔断器运行时调用方的 Inngest 装配 + 关键路径测试。
 *
 * 测的是**装配 + 关键路径**：假 supabase 按表建模（`ad_strategy_configs` /
 * `ad_daily_insights` 两张内存表 + `rpc` 假函数），不重跑 `evaluateCircuitBreaker`
 * 本身的判据逻辑（那在 circuit-breaker.test.ts）、也不重跑
 * `ads_trip_circuit_breaker_policy` SQL 函数本身（那在 migration 里）。
 *
 * 桥接 unknown：Inngest SDK 的 `createFunction()` 返回类型不对外暴露
 * `.opts` / `.fn` 这两个内部字段的公开类型，但运行时真实存在——同一读法已在
 * ads-autonomy-sync.test.ts 验证过。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createAdsCircuitBreakerCheckFunction,
  parseCheckPayload,
  ADS_CIRCUIT_BREAKER_CHECK_FN_ID,
} from '../ads-circuit-breaker-check'
import { ADS_CIRCUIT_BREAKER_CHECK_DUE } from '../../ads-events'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'

type Fn = ReturnType<typeof createAdsCircuitBreakerCheckFunction>
function optsOf(fn: Fn) {
  return (
    fn as unknown as {
      opts: {
        triggers?: { event?: string }[]
        retries?: number
        concurrency?: { limit: number; key?: string }
      }
    }
  ).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

const CLIENT = '11111111-2222-4333-8444-555555555555'
const DATE = '2026-09-27'

interface ConfigRow {
  autonomy_mode: 'observe' | 'bounded_auto'
}

interface InsightRow {
  insight_date: string
  ad_account_id: string
  spend: number | null
}

interface FakeOpts {
  config?: ConfigRow | null
  insights?: InsightRow[]
  insightsError?: string
  rpcOutcome?: (actionKey: string) => string
  rpcError?: string
}

const ACCOUNT = 'act_1'

/** 按天生成 7 条非零花费历史（美元），从 date 往前数 lookbackDays 天，不含 date 本身。单账户，默认 ACCOUNT。 */
function historyRows(date: string, dollarsPerDay: number[], adAccountId: string = ACCOUNT): InsightRow[] {
  return dollarsPerDay.map((spend, i) => {
    const ms = Date.parse(`${date}T00:00:00Z`) - (dollarsPerDay.length - i) * 86_400_000
    return { insight_date: new Date(ms).toISOString().slice(0, 10), ad_account_id: adAccountId, spend }
  })
}

/**
 * 假 supabase：按表建模，只支持本函数真实用到的调用链。
 * 任何别的表 / 别的方法一律抛 —— 形状一旦跟生产侧对不上，测试当场红。
 */
function fakeSupabase(opts: FakeOpts) {
  const rpc = vi.fn(async (_name: string, params: Record<string, unknown>) => {
    if (opts.rpcError !== undefined) return { data: null, error: { message: opts.rpcError } }
    const key = String(params.p_action_key)
    return { data: opts.rpcOutcome ? opts.rpcOutcome(key) : 'tripped', error: null }
  })

  function configBuilder() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: opts.config ?? null, error: null }),
    }
    return chain
  }

  function insightsBuilder() {
    // fetchClientDailySpendCents 走 fetchAll 分页；用例行数都远低于 1000，
    // 单页 range() 就能把整批数据一次性喂完。
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      range: async () =>
        opts.insightsError !== undefined
          ? { data: null, error: { message: opts.insightsError } }
          : { data: opts.insights ?? [], error: null },
    }
    return chain
  }

  const sb = {
    from: (table: string) => {
      if (table === 'ad_strategy_configs') return configBuilder()
      if (table === 'ad_daily_insights') return insightsBuilder()
      throw new Error('unexpected table ' + table)
    },
    rpc,
  } as unknown as SupabaseClient

  return { sb, rpc }
}

async function run(sb: SupabaseClient, data: unknown = { client_id: CLIENT, date: DATE }) {
  const fn = createAdsCircuitBreakerCheckFunction({ getSupabase: () => sb })
  return handlerOf(fn)({
    event: { id: 'evt-1', data },
    step: { run: (_id: string, cb: () => unknown) => cb() },
  })
}

describe('ads-circuit-breaker-check Inngest assembly', () => {
  it('注册在 cloudFunctions 里，id 带 cloud- 前缀', () => {
    const registered = cloudFunctions.find((fn) => fn.id() === ADS_CIRCUIT_BREAKER_CHECK_FN_ID)
    expect(registered).toBeDefined()
    expect(ADS_CIRCUIT_BREAKER_CHECK_FN_ID.startsWith(CLOUD_FN_PREFIX)).toBe(true)
  })

  it('不监听 worker-owned 事件（one-event-one-owner 契约）', () => {
    const fn = createAdsCircuitBreakerCheckFunction({ getSupabase: () => fakeSupabase({}).sb })
    const triggerEvent = optsOf(fn).triggers?.[0]?.event
    expect(triggerEvent).toBe(ADS_CIRCUIT_BREAKER_CHECK_DUE)
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(triggerEvent as string)).toBe(false)
  })

  it('按客户并发限 1，且配了重试', () => {
    const fn = createAdsCircuitBreakerCheckFunction({ getSupabase: () => fakeSupabase({}).sb })
    const opts = optsOf(fn)
    expect(opts.concurrency).toMatchObject({ limit: 1, key: 'event.data.client_id' })
    expect(opts.retries).toBeGreaterThan(0)
  })
})

describe('parseCheckPayload', () => {
  it('接受合法 UUID + YYYY-MM-DD', () => {
    expect(parseCheckPayload({ client_id: CLIENT, date: DATE })).toEqual({ client_id: CLIENT, date: DATE })
  })

  it.each([
    ['非法 UUID', { client_id: 'nope', date: DATE }],
    ['非法日期', { client_id: CLIENT, date: '2026/09/27' }],
    ['缺 date', { client_id: CLIENT }],
    ['缺 client_id', { date: DATE }],
    ['null', null],
    ['字符串', 'str'],
  ])('拒绝：%s', (_label, payload) => {
    expect(parseCheckPayload(payload)).toBeNull()
  })
})

describe('ads-circuit-breaker-check handler', () => {
  it('payload 非法 → invalid_payload，不读配置、不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({})
    const result = await run(sb, { client_id: 'nope', date: DATE })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_payload' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('没有配置行 → no_config，不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({ config: null })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: false, reason: 'no_config' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('observe 档位 → not_bounded_auto，不读花费、不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({ config: { autonomy_mode: 'observe' } })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: false, reason: 'not_bounded_auto' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('🔴 花费读取失败 → 整个 handler 抛错（不能正常返回软失败，否则 Inngest 不重试、事件 id 白白被去重锁死），不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({ config: { autonomy_mode: 'bounded_auto' }, insightsError: 'boom' })
    await expect(run(sb)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('非零花费天数不足 5 天 → undeterminable，不调 rpc（按 data-partial 不熔不放）', async () => {
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: historyRows(DATE, [50, 50, 50, 50]), // 只 4 天历史
    })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: true, verdict: 'undeterminable' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('今天花费在 3 倍中位数以内 → not_tripped，不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 100 }],
    })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: true, verdict: 'not_tripped' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('🔴 今天花费超 3 倍中位数 → tripped，每个 ads.* 键调一次 ads_trip_circuit_breaker_policy', async () => {
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 200 }],
      rpcOutcome: () => 'tripped',
    })
    const result = (await run(sb)) as { ok: true; verdict: string; applied: { key: string; outcome: string }[] }

    expect(result.ok).toBe(true)
    expect(result.verdict).toBe('tripped')

    const keys = listAdsActionKeys()
    expect(rpc).toHaveBeenCalledTimes(keys.length)
    expect(result.applied).toHaveLength(keys.length)
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('ads_trip_circuit_breaker_policy')
      const params = call[1] as Record<string, unknown>
      expect(params.p_client_id).toBe(CLIENT)
      expect(typeof params.p_reason).toBe('string')
    }
  })

  it('🔴 Codex P1：多账户——A 账户异常被 B 账户稀释的场景必须照样触发（按账户分别判定，不按客户合计）', async () => {
    // 账户 A：稳定 7 天 $100/天，今天冲到 $400（4x，单独看该触发）。
    // 账户 B：稳定 7 天 $1000/天，今天也是 $1000（完全正常）。
    // 客户合计：历史 7*1100=7700，今天 1400，倍率仅约 1.27x——按客户合计不会触发，
    // 必须按账户分别判定才能抓到账户 A。
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [
        ...historyRows(DATE, [100, 100, 100, 100, 100, 100, 100], 'act_a'),
        { insight_date: DATE, ad_account_id: 'act_a', spend: 400 },
        ...historyRows(DATE, [1000, 1000, 1000, 1000, 1000, 1000, 1000], 'act_b'),
        { insight_date: DATE, ad_account_id: 'act_b', spend: 1000 },
      ],
      rpcOutcome: () => 'tripped',
    })
    const result = (await run(sb)) as { ok: true; verdict: string; reason?: string }
    expect(result.verdict).toBe('tripped')
    expect(result.reason).toContain('act_a') // 报告里点名是哪个账户触发的
    expect(rpc).toHaveBeenCalled() // 客户级动作仍然触发——账户 B 正常不代表客户整体放行
  })

  it('多账户都正常 → not_tripped，不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [
        ...historyRows(DATE, [100, 100, 100, 100, 100, 100, 100], 'act_a'),
        { insight_date: DATE, ad_account_id: 'act_a', spend: 110 },
        ...historyRows(DATE, [1000, 1000, 1000, 1000, 1000, 1000, 1000], 'act_b'),
        { insight_date: DATE, ad_account_id: 'act_b', spend: 1000 },
      ],
    })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: true, verdict: 'not_tripped' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('窗口内完全没有花费数据（新客户/没有登记账户）→ undeterminable，不调 rpc', async () => {
    const { sb, rpc } = fakeSupabase({ config: { autonomy_mode: 'bounded_auto' }, insights: [] })
    const result = await run(sb)
    expect(result).toMatchObject({ ok: true, verdict: 'undeterminable' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('已经是熔断器自己设的 deny（already_tripped）→ 照常返回，不额外报错', async () => {
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 200 }],
      rpcOutcome: () => 'already_tripped',
    })
    const result = (await run(sb)) as { ok: true; applied: { outcome: string }[] }
    expect(result.applied.every((r) => r.outcome === 'already_tripped')).toBe(true)
  })

  it('管理员已手动锁死（locked_by_other_deny）→ 照常返回——mode 已经是 deny，安全目标已达成', async () => {
    const { sb, rpc } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 200 }],
      rpcOutcome: () => 'locked_by_other_deny',
    })
    const result = (await run(sb)) as { ok: true; applied: { outcome: string }[] }
    expect(result.applied.every((r) => r.outcome === 'locked_by_other_deny')).toBe(true)
  })

  it('🔴 Codex P1：race_lost（并发把行改了，deny 没真的写进去）→ 整个 handler 抛错，不能当成功放进 applied', async () => {
    const { sb } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 200 }],
      rpcOutcome: () => 'race_lost',
    })
    await expect(run(sb)).rejects.toThrow(/race_lost/)
  })

  it('rpc 返回非预期字符串 → 同样当失败抛错，不能悄悄放行', async () => {
    const { sb } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 200 }],
      rpcOutcome: () => 'some_future_outcome_this_code_does_not_know_about',
    })
    await expect(run(sb)).rejects.toThrow()
  })

  it('rpc 报错 → 整个 handler 抛错（交给 Inngest 按 retries 重试）', async () => {
    const { sb } = fakeSupabase({
      config: { autonomy_mode: 'bounded_auto' },
      insights: [...historyRows(DATE, [50, 50, 50, 40, 40, 50, 60]), { insight_date: DATE, ad_account_id: ACCOUNT, spend: 200 }],
      rpcError: 'boom',
    })
    await expect(run(sb)).rejects.toThrow('boom')
  })
})

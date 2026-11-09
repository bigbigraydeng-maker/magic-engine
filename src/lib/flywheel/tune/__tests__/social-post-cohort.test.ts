/**
 * Tests for src/lib/flywheel/tune/social-post-cohort.ts —— Gate B 步骤 2。
 *
 * fake supabase 严格按真 schema 建：
 *   - 只暴露 flywheel_actions / social_post_measurement_receipts 两张表；
 *   - 越界访问（别的表、别的方法）立即抛错，把「悄悄跨表读」暴露出来；
 *   - 记录过滤链 —— 让「client_id 忘记加」这类漏网原地翻车。
 */

import { describe, it, expect, vi } from 'vitest'
import { loadPostCohort } from '../social-post-cohort'
import type { PostMeasurement } from '../types'

// ── 生产语义常量（复现真实数据形状） ────────────────────────────────────
const CLIENT   = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN = '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea'
const TARGET   = 'act-target-0000'

interface ActionSeed {
  id:          string
  client_id:   string
  action_type: string
  payload:     {
    source?:      string
    campaign_id?: string
    [k: string]: unknown
  }
  executed_at: string | null
}

interface ReceiptSeed {
  action_id:    string
  window_hours: number
  status:       string
  values:       Record<string, unknown>
  missing:      Record<string, unknown>
}

interface FakeOptions {
  actions:        ActionSeed[]
  receipts:       ReceiptSeed[]
  actionsError?:  string
  receiptsError?: string
}

interface FakeSpy {
  actionFilters:  Record<string, unknown>
  actionLimit:    number | null
  receiptFilters: Record<string, unknown>
  inCall:         { column: string; values: unknown[] } | null
  tablesTouched:  string[]
}

function makeFakeSupabase(opts: FakeOptions): { supabase: ReturnType<typeof buildFake>['supabase']; spy: FakeSpy } {
  return buildFake(opts)
}

function buildFake(opts: FakeOptions) {
  const spy: FakeSpy = {
    actionFilters:  {},
    actionLimit:    null,
    receiptFilters: {},
    inCall:         null,
    tablesTouched:  [],
  }

  const supabase = {
    from(table: string) {
      spy.tablesTouched.push(table)
      if (table === 'flywheel_actions') return buildActionsChain(opts, spy)
      if (table === 'social_post_measurement_receipts') return buildReceiptsChain(opts, spy)
      throw new Error(`fake supabase: table '${table}' is not allowed`)
    },
  }
  return { supabase, spy }
}

function buildActionsChain(opts: FakeOptions, spy: FakeSpy) {
  const filters: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {}

  chain.select = (_cols: string) => chain
  chain.eq = (col: string, val: unknown) => {
    filters[col] = val
    return chain
  }
  chain.order = (_col: string, _opts: unknown) => chain
  chain.limit = (n: number) => {
    spy.actionFilters = { ...filters }
    spy.actionLimit = n
    if (opts.actionsError) {
      return Promise.resolve({ data: null, error: { message: opts.actionsError } })
    }
    const rows = opts.actions
      .filter((a) => {
        if ((filters['client_id']            as unknown) !== undefined && a.client_id            !== filters['client_id'])                       return false
        if ((filters['action_type']          as unknown) !== undefined && a.action_type          !== filters['action_type'])                     return false
        if ((filters['payload->>source']     as unknown) !== undefined && (a.payload.source     ?? null) !== (filters['payload->>source']     as unknown)) return false
        if ((filters['payload->>campaign_id']as unknown) !== undefined && (a.payload.campaign_id ?? null) !== (filters['payload->>campaign_id']as unknown)) return false
        return true
      })
      // executed_at 降序，nulls last —— 对齐生产 .order('executed_at', {ascending:false, nullsFirst:false})
      .sort((a, b) => {
        if (a.executed_at === null && b.executed_at === null) return 0
        if (a.executed_at === null) return 1
        if (b.executed_at === null) return -1
        return b.executed_at.localeCompare(a.executed_at)
      })
      .slice(0, n)
      .map((a) => ({ id: a.id, executed_at: a.executed_at }))
    return Promise.resolve({ data: rows, error: null })
  }
  return chain
}

function buildReceiptsChain(opts: FakeOptions, spy: FakeSpy) {
  const filters: Record<string, unknown> = {}
  let inFilter: { column: string; values: unknown[] } | null = null
  const chain: Record<string, unknown> = {}

  chain.select = (_cols: string) => chain
  chain.in = (col: string, vals: unknown[]) => {
    inFilter = { column: col, values: [...vals] }
    return chain
  }
  chain.eq = (col: string, val: unknown) => {
    filters[col] = val
    // eq 是最后一节 → 结果在这里 resolve。
    spy.receiptFilters = { ...filters }
    spy.inCall = inFilter ? { column: inFilter.column, values: [...inFilter.values] } : null
    if (opts.receiptsError) {
      return Promise.resolve({ data: null, error: { message: opts.receiptsError } })
    }
    const rows = opts.receipts.filter((r) => {
      if (inFilter && inFilter.column === 'action_id' && !inFilter.values.includes(r.action_id)) return false
      for (const [k, v] of Object.entries(filters)) {
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false
      }
      return true
    })
    return Promise.resolve({ data: rows, error: null })
  }
  return chain
}

// ── 数据构造 ──────────────────────────────────────────────────────────
function action(id: string, over: Partial<ActionSeed> = {}): ActionSeed {
  return {
    id,
    client_id:   CLIENT,
    action_type: 'social.publish_post',
    payload:     { source: 'daily_plan', campaign_id: CAMPAIGN },
    executed_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function receipt(actionId: string, over: Partial<ReceiptSeed> = {}): ReceiptSeed {
  return {
    action_id:    actionId,
    window_hours: 72,
    status:       'ok',
    values:       { likes: 10, comments: 2, shares: 1 },
    missing:      {},
    ...over,
  }
}

// ── 测试 ────────────────────────────────────────────────────────────
describe('loadPostCohort — 正常路径', () => {
  it('返回 target + cohort，target 从 cohort 剔除，按 executed_at 降序', async () => {
    const { supabase, spy } = makeFakeSupabase({
      actions: [
        action('a1', { executed_at: '2026-09-01T00:00:00.000Z' }),
        action('a2', { executed_at: '2026-09-05T00:00:00.000Z' }),
        action(TARGET, { executed_at: '2026-09-10T00:00:00.000Z' }),
      ],
      receipts: [
        receipt(TARGET, { values: { likes: 20 } }),
        receipt('a1',   { values: { likes: 8 } }),
        receipt('a2',   { values: { likes: 12 } }),
      ],
    })

    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })

    expect(result.target?.actionId).toBe(TARGET)
    expect(result.target?.values.likes).toBe(20)
    expect(result.cohort.map((c) => c.actionId)).toEqual(['a2', 'a1'])  // 降序
    expect(result.diagnostics).toEqual({ candidateActionCount: 3, withT72ReceiptCount: 3 })
    expect(spy.tablesTouched).toEqual(['flywheel_actions', 'social_post_measurement_receipts'])
  })

  it('过滤链正确：client_id / action_type / payload.source / payload.campaign_id / window_hours', async () => {
    const { supabase, spy } = makeFakeSupabase({
      actions:  [action(TARGET)],
      receipts: [receipt(TARGET)],
    })

    await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })

    expect(spy.actionFilters).toEqual({
      client_id:                CLIENT,
      action_type:              'social.publish_post',
      'payload->>source':       'daily_plan',
      'payload->>campaign_id':  CAMPAIGN,
    })
    expect(spy.actionLimit).toBe(20)  // default
    expect(spy.receiptFilters).toEqual({ window_hours: 72 })
    expect(spy.inCall).toEqual({ column: 'action_id', values: [TARGET] })
  })

  it('limit 传参生效', async () => {
    const { supabase, spy } = makeFakeSupabase({
      actions:  Array.from({ length: 30 }, (_, i) => action(`a${i}`, { executed_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })),
      receipts: [],
    })
    await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: 'not-in-set', limit: 5,
    })
    expect(spy.actionLimit).toBe(5)
  })
})

describe('loadPostCohort — 空态区分', () => {
  it('没有 candidate action：candidateActionCount = 0', async () => {
    const { supabase } = makeFakeSupabase({ actions: [], receipts: [] })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.target).toBeNull()
    expect(result.cohort).toEqual([])
    expect(result.diagnostics).toEqual({ candidateActionCount: 0, withT72ReceiptCount: 0 })
  })

  it('有 candidate action 但没 T+72 receipt：candidateActionCount > 0，withT72ReceiptCount = 0', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET), action('a1')],
      receipts: [],  // 都还没到 T+72
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.target).toBeNull()
    expect(result.cohort).toEqual([])
    expect(result.diagnostics).toEqual({ candidateActionCount: 2, withT72ReceiptCount: 0 })
  })

  it('target 有历史 T+72 但自己还没到 T+72：target = null，cohort 有值', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET), action('a1'), action('a2'), action('a3')],
      receipts: [receipt('a1'), receipt('a2'), receipt('a3')],  // target 没 receipt
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.target).toBeNull()
    expect(result.cohort).toHaveLength(3)
    expect(result.diagnostics).toEqual({ candidateActionCount: 4, withT72ReceiptCount: 3 })
  })
})

describe('loadPostCohort — 越界不该被拉进来', () => {
  it('其他 client / 其他 action_type / 非 daily_plan / 其他 campaign 都被过滤', async () => {
    const { supabase } = makeFakeSupabase({
      actions: [
        action(TARGET),
        action('other-client',   { client_id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }),
        action('other-type',     { action_type: 'social.comment' }),
        action('factory-reel',   { payload: { source: 'factory_reel', campaign_id: CAMPAIGN } }),
        action('other-campaign', { payload: { source: 'daily_plan',   campaign_id: 'zz-other' } }),
      ],
      receipts: [
        receipt(TARGET),
        receipt('other-client'),
        receipt('other-type'),
        receipt('factory-reel'),
        receipt('other-campaign'),
      ],
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.target?.actionId).toBe(TARGET)
    expect(result.cohort).toEqual([])
    expect(result.diagnostics.candidateActionCount).toBe(1)
  })

  it('cohort receipt 里的 T+4 不会被拉出来（window_hours = 72 过滤）', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET), action('a1')],
      receipts: [
        receipt(TARGET),
        receipt('a1',                        { window_hours: 4, values: { likes: 999 } }),  // 应被排除
        receipt('a1',                        { window_hours: 72, values: { likes: 10 } }),
      ],
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.cohort).toHaveLength(1)
    expect(result.cohort[0].values.likes).toBe(10)  // 不是 999
    expect(result.diagnostics.withT72ReceiptCount).toBe(2)  // 只算 T+72 的
  })
})

describe('loadPostCohort — 归一化', () => {
  it('未知 status → unmeasurable（fail-safe）+ console.warn 留声', async () => {
    // 留声非常关键：DB 若加新 status（'timeout' / 'rate_limited'），静默降级
    // 会让 partial 数据无声消失，PM 只见「数据还不够说话」。
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET)],
      receipts: [receipt(TARGET, { status: 'weird-new-status' })],
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.target?.status).toBe('unmeasurable')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown receipt status 'weird-new-status'"),
    )
    warnSpy.mockRestore()
  })

  it('values 里非数字 / 非有限值被丢弃', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET)],
      receipts: [receipt(TARGET, {
        values: { likes: 5, comments: 'nope', shares: Number.NaN, extra: 999 },
      })],
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    const m = result.target as PostMeasurement
    expect(m.values.likes).toBe(5)
    expect(m.values.comments).toBeUndefined()  // 'nope' 被丢
    expect(m.values.shares).toBeUndefined()    // NaN 被丢
    expect((m.values as Record<string, unknown>).extra).toBeUndefined()  // 白名单外
  })

  it('missing 里非字符串 / 空串被丢弃，字符串保留', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET)],
      receipts: [receipt(TARGET, {
        values:  { likes: 5, comments: 0 },
        missing: { shares: 'omitted_unverified', likes: '', comments: 42 },
      })],
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    const m = result.target as PostMeasurement
    expect(m.missing.shares).toBe('omitted_unverified')
    expect(m.missing.likes).toBeUndefined()
    expect(m.missing.comments).toBeUndefined()
  })

  it('values / missing 是 null 时不炸', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET)],
      receipts: [{
        action_id: TARGET, window_hours: 72, status: 'unmeasurable',
        values: null as unknown as Record<string, unknown>,
        missing: null as unknown as Record<string, unknown>,
      }],
    })
    const result = await loadPostCohort(supabase as never, {
      clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET,
    })
    expect(result.target?.values).toEqual({})
    expect(result.target?.missing).toEqual({})
  })
})

describe('loadPostCohort — 错误', () => {
  it('actions 读失败 → 抛错，不静默返回空', async () => {
    const { supabase } = makeFakeSupabase({
      actions: [], receipts: [], actionsError: 'connection reset',
    })
    await expect(
      loadPostCohort(supabase as never, { clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET }),
    ).rejects.toThrow(/read flywheel_actions failed.*connection reset/)
  })

  it('receipts 读失败 → 抛错，不静默返回空', async () => {
    const { supabase } = makeFakeSupabase({
      actions:  [action(TARGET)],
      receipts: [],
      receiptsError: 'timeout',
    })
    await expect(
      loadPostCohort(supabase as never, { clientId: CLIENT, campaignId: CAMPAIGN, targetActionId: TARGET }),
    ).rejects.toThrow(/read social_post_measurement_receipts failed.*timeout/)
  })
})

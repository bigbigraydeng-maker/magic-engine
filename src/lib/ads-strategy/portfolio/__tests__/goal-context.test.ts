/**
 * 目标进度取数的薄样本闸。少于 MIN_MEDIAN_DAYS 天可用数据就不给中位数——这道闸没有测试钉住的话，以后有人把阈值改坏不会有人发现（子牙 WP0 复审 2026-09-24）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/strategy/goals', () => ({ listActiveGoals: vi.fn() }))
vi.mock('@/lib/strategy/auto-fetch', () => ({ autoFetchMetricValue: vi.fn() }))
vi.mock('../../config', () => ({ loadAdStrategyConfigWithSource: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { listActiveGoals } from '@/lib/strategy/goals'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import { loadAdStrategyConfigWithSource } from '../../config'
import { medianCostPerResultCents, buildDigestGoalContext, pickDigestGoal, withoutCapLens, MIN_MEDIAN_DAYS } from '../goal-context'
import type { GoalRow } from '@/types/strategy'
import type { AdStrategyConfig } from '../../config'
import type { GoalPace } from '../../goal-pace'

interface InsightRow {
  insight_date: string
  spend: number | null
  results: number | null
}

/**
 * Chainable stub for supabaseAdmin.from('ad_daily_insights'): every builder
 * method returns the same object, and the object is awaitable (then) resolving
 * to { data, error }. Any other table is a test bug — throw.
 */
function insightsTable(rows: InsightRow[]) {
  const result = { data: rows, error: null }
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  }
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table !== 'ad_daily_insights') {
      throw new Error(`unexpected table in test: ${table}`)
    }
    return builder as never
  })
}

function insightsError() {
  const result = { data: null, error: { message: 'boom' } }
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  }
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table !== 'ad_daily_insights') {
      throw new Error(`unexpected table in test: ${table}`)
    }
    return builder as never
  })
}

/** A full GoalRow — every required field present, no cast. */
function goalRow(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: 'goal-1',
    client_id: 'client-1',
    intent: 'acquisition',
    awareness_subtype: null,
    sub_type: 'ongoing',
    title: 'Oztop Brisbane 月询盘',
    primary_metric_key: 'leads_count',
    primary_metric_label: '新增线索/询盘',
    primary_metric_unit: 'count/mo',
    baseline_value: 20,
    target_value: 50,
    target_direction: 'increase',
    supporting_metrics: [],
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    budget_amount: null,
    budget_currency: 'AUD',
    status: 'active',
    verdict: null,
    verdict_at: null,
    verdict_summary: null,
    recurrence: null,
    fde_reasoning: null,
    is_beta: true,
    current_value: null,
    current_value_fetched_at: null,
    current_value_source: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    created_by: null,
    ...overrides,
  }
}

/** A full AdStrategyConfig — every field present, no cast. */
function adStrategyConfig(overrides: Partial<AdStrategyConfig> = {}): AdStrategyConfig {
  return {
    client_id: 'client-1',
    enabled: true,
    digest_recipients: [],
    daily_budget_cap_cents: null,
    autonomy_mode: 'observe',
    creative_pool: [],
    autopilot_enabled: false,
    autopilot_dry_run: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('medianCostPerResultCents — 薄样本闸', () => {
  it('只有 1 天有结果 → null', async () => {
    insightsTable([{ insight_date: '2026-09-15', spend: 100, results: 4 }])
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBeNull()
  })

  it('只有 2 天有结果 → null', async () => {
    insightsTable([
      { insight_date: '2026-09-14', spend: 100, results: 4 },
      { insight_date: '2026-09-15', spend: 50, results: 1 },
    ])
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBeNull()
  })

  it('恰好 MIN_MEDIAN_DAYS 天 → 中位数', async () => {
    expect(MIN_MEDIAN_DAYS).toBe(3)
    insightsTable([
      { insight_date: '2026-09-13', spend: 100, results: 4 }, // 2500
      { insight_date: '2026-09-14', spend: 50, results: 1 },  // 5000
      { insight_date: '2026-09-15', spend: 90, results: 3 },  // 3000
    ])
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBe(3000)
  })

  it('4 天偶数个 → 两中值平均取整', async () => {
    insightsTable([
      { insight_date: '2026-09-12', spend: 10, results: 1 },  // 1000
      { insight_date: '2026-09-13', spend: 20, results: 1 },  // 2000
      { insight_date: '2026-09-14', spend: 30, results: 1 },  // 3000
      { insight_date: '2026-09-15', spend: 50, results: 1 },  // 5000
    ])
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBe(2500)
  })

  it('当天有花费但 0 结果的天被跳过', async () => {
    insightsTable([
      { insight_date: '2026-09-12', spend: 10, results: 1 },  // 1000
      { insight_date: '2026-09-13', spend: 20, results: 1 },  // 2000
      { insight_date: '2026-09-14', spend: 30, results: 1 },  // 3000
      { insight_date: '2026-09-15', spend: 80, results: 0 },  // skipped
    ])
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBe(2000)
  })

  it('同一天多个 campaign 行先按天汇总', async () => {
    insightsTable([
      { insight_date: '2026-09-13', spend: 60, results: 2 },
      { insight_date: '2026-09-13', spend: 40, results: 2 }, // day total: 100/4 = 2500
      { insight_date: '2026-09-14', spend: 10, results: 1 }, // 1000
      { insight_date: '2026-09-15', spend: 20, results: 1 }, // 2000
    ])
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBe(2000)
  })

  it('supabase 报错 → null', async () => {
    insightsError()
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBeNull()
  })

  it('spend 为 null 当 0、results 为 null 当 0', async () => {
    // 可用天必须够 MIN_MEDIAN_DAYS，否则先被薄样本闸拦掉、测不到 null 的折算。
    insightsTable([
      { insight_date: '2026-09-12', spend: 20, results: 1 },     // 2000
      { insight_date: '2026-09-13', spend: null, results: 5 },   // spend null → 0 分，仍计入
      { insight_date: '2026-09-14', spend: 100, results: null }, // results null → 跳过
      { insight_date: '2026-09-15', spend: 30, results: 1 },     // 3000
    ])
    // 可用 3 天 [0, 2000, 3000] → 中位数 2000；被跳过的 09-14 若混进来中位数会变
    expect(await medianCostPerResultCents('client-1', '2026-09-15')).toBe(2000)
  })
})

describe('buildDigestGoalContext', () => {
  it('没有 active goal → null，且 autoFetchMetricValue 没被调用', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([])
    expect(await buildDigestGoalContext('client-1', '2026-09-15')).toBeNull()
    expect(vi.mocked(autoFetchMetricValue)).not.toHaveBeenCalled()
  })

  it('autoFetch 返回 unknown → verdict unknown 且 reason 含归属数据不足', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow()])
    vi.mocked(autoFetchMetricValue).mockResolvedValue({
      ok: false,
      reason: '主结果归不到广告（§14 M2）',
      unknown: true,
    })
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({ config: adStrategyConfig(), source: 'row' })
    insightsTable([])

    const ctx = await buildDigestGoalContext('client-1', '2026-09-15')
    expect(ctx).not.toBeNull()
    expect(ctx?.pace.verdict).toBe('unknown')
    expect(ctx?.pace.reason).toContain('归属数据不足')
  })

  it('listActiveGoals 抛错 → resolves 为 null（不抛）', async () => {
    vi.mocked(listActiveGoals).mockRejectedValue(new Error('db down'))
    await expect(buildDigestGoalContext('client-1', '2026-09-15')).resolves.toBeNull()
  })

  it('正常路径：dayIndex / totalDays 与字段透传', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow()])
    vi.mocked(autoFetchMetricValue).mockResolvedValue({
      ok: true,
      value: 35,
      source: 'auto.ga4_conversions',
      snapshot_date: '2026-09-15',
      label: '35 conversions',
    })
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({ config: adStrategyConfig(), source: 'row' })
    insightsTable([])

    const ctx = await buildDigestGoalContext('client-1', '2026-09-15')
    expect(ctx).not.toBeNull()
    expect(ctx?.dayIndex).toBe(15)
    expect(ctx?.totalDays).toBe(30)
    expect(ctx?.title).toBe('Oztop Brisbane 月询盘')
    expect(ctx?.label).toBe('新增线索/询盘')
    expect(ctx?.target).toBe(50)
  })

  it('多个目标时用广告能量的那个取数，并把它的期间传给 autoFetch', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([
      goalRow({ id: 'g-signups', title: '报名', primary_metric_key: 'signups_count', period_start: '2026-09-24', period_end: '2026-12-31' }),
      goalRow({ id: 'g-leads', title: '留资', primary_metric_key: 'leads_count', period_start: '2026-09-01', period_end: '2026-09-30' }),
    ])
    vi.mocked(autoFetchMetricValue).mockResolvedValue({
      ok: true,
      value: 12,
      source: 'ad_daily_insights',
      snapshot_date: '2026-09-30',
      label: 'lead',
    })
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({ config: adStrategyConfig(), source: 'row' })
    insightsTable([])

    const ctx = await buildDigestGoalContext('client-1', '2026-09-15')
    expect(ctx?.title).toBe('留资')
    expect(vi.mocked(autoFetchMetricValue)).toHaveBeenCalledWith(supabaseAdmin, 'client-1', 'leads_count', {
      goalPeriod: { period_start: '2026-09-01', period_end: '2026-09-30' },
    })
  })

  function fetchedLead(value: number) {
    vi.mocked(autoFetchMetricValue).mockResolvedValue({
      ok: true, value, source: 'ad_daily_insights', snapshot_date: '2026-09-15', label: 'lead',
    })
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({ config: adStrategyConfig(), source: 'row' })
  }

  it('今天有日报行、日报只到昨天 → 实际值终点是昨天', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow()])
    fetchedLead(12)
    // 巡察日是今天 09-16。日报最新一行停在昨天：今天的行还没进这张日报。
    insightsTable([{ insight_date: '2026-09-15', spend: 20, results: 1 }])

    await buildDigestGoalContext('client-1', '2026-09-16')
    expect(vi.mocked(autoFetchMetricValue)).toHaveBeenCalledWith(supabaseAdmin, 'client-1', 'leads_count', {
      goalPeriod: { period_start: '2026-09-01', period_end: '2026-09-15' },
    })
  })

  it('日报最新日期早于目标期开始 → 实际值终点仍是目标期末', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow({
      period_start: '2026-09-20', period_end: '2026-10-31',
    })])
    fetchedLead(4)
    insightsTable([{ insight_date: '2026-09-15', spend: 20, results: 1 }])

    await buildDigestGoalContext('client-1', '2026-09-16')
    expect(vi.mocked(autoFetchMetricValue)).toHaveBeenCalledWith(supabaseAdmin, 'client-1', 'leads_count', {
      goalPeriod: { period_start: '2026-09-20', period_end: '2026-10-31' },
    })
  })

  it('日报最新不早于目标期末 → 实际值终点仍是目标期末', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow({
      period_start: '2026-09-01', period_end: '2026-09-10',
    })])
    fetchedLead(4)
    insightsTable([{ insight_date: '2026-09-15', spend: 20, results: 1 }])

    await buildDigestGoalContext('client-1', '2026-09-16')
    expect(vi.mocked(autoFetchMetricValue)).toHaveBeenCalledWith(supabaseAdmin, 'client-1', 'leads_count', {
      goalPeriod: { period_start: '2026-09-01', period_end: '2026-09-10' },
    })
  })
})

describe('buildDigestGoalContext — 广告设置读失败', () => {
  function fetched(value: number) {
    vi.mocked(autoFetchMetricValue).mockResolvedValue({
      ok: true, value, source: 'ad_daily_insights', snapshot_date: '2026-09-15', label: 'lead',
    })
  }
  function configReadFails() {
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({
      config: adStrategyConfig(), source: 'fallback', error: 'relation timeout',
    })
  }

  it('按节奏走 + 读失败 → 降成未判，并把原始报错带出去', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow()])
    fetched(35) // 第 15/30 天，线性预期 35 → 本来是 on_track
    configReadFails()
    insightsTable([])

    const ctx = await buildDigestGoalContext('client-1', '2026-09-15')
    expect(ctx?.pace.verdict).toBe('unknown')
    expect(ctx?.pace.reason).toContain('读不出广告设置')
    expect(ctx?.configReadError).toBe('relation timeout')
  })

  it('落后 + 读失败 → 仍报落后（只靠线性节奏就成立），同样带报错', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow()])
    fetched(20)
    configReadFails()
    insightsTable([])

    const ctx = await buildDigestGoalContext('client-1', '2026-09-15')
    expect(ctx?.pace.verdict).toBe('behind')
    expect(ctx?.configReadError).toBe('relation timeout')
  })

  it('读成功 → 不带 configReadError', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow()])
    fetched(35)
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({ config: adStrategyConfig(), source: 'default' })
    insightsTable([])

    const ctx = await buildDigestGoalContext('client-1', '2026-09-15')
    expect(ctx?.pace.verdict).toBe('on_track')
    expect(ctx && 'configReadError' in ctx).toBe(false)
  })
})

type MixedRow = InsightRow & { entity_id: string; leads: number; messaging_conversations: number }

/** 混合客户：WhatsApp 系列每天 1 个对话花 $90，表单系列每天 2 条线索花 $20。 */
function mixedRows(): MixedRow[] {
  const out: MixedRow[] = []
  for (const day of ['2026-09-13', '2026-09-14', '2026-09-15']) {
    out.push({ insight_date: day, entity_id: 'wa', spend: 90, results: 1, leads: 0, messaging_conversations: 1 })
    out.push({ insight_date: day, entity_id: 'form', spend: 20, results: 2, leads: 2, messaging_conversations: 0 })
  }
  return out
}

describe('同类结果成本口径（线索目标不拿对话成本）', () => {
  it('metric=leads → 只用出线索的系列行：中位 $10，不是 $90 或合计', async () => {
    insightsTable(mixedRows())
    expect(await medianCostPerResultCents('client-1', '2026-09-15', { metric: 'leads' })).toBe(1000)
  })

  it('metric=leads + 指定系列 → 只算该系列', async () => {
    insightsTable(mixedRows())
    expect(await medianCostPerResultCents('client-1', '2026-09-15', { metric: 'leads', campaignIds: ['form'] })).toBe(1000)
    expect(await medianCostPerResultCents('client-1', '2026-09-15', { metric: 'leads', campaignIds: ['wa'] })).toBeNull()
  })

  it('线索只有 2 天 → 成本不出数（null），不拿 WhatsApp 的天数凑', async () => {
    insightsTable(mixedRows().filter(r => !(r.entity_id === 'form' && r.insight_date === '2026-09-13')))
    expect(await medianCostPerResultCents('client-1', '2026-09-15', { metric: 'leads' })).toBeNull()
  })

  it('样本不足 + 目标期才 2 天数据 → 未判（不是落后/到不了）', async () => {
    vi.mocked(listActiveGoals).mockResolvedValue([goalRow({
      period_start: '2026-09-14', period_end: '2026-10-30', target_value: 300, baseline_value: 0,
    })])
    vi.mocked(autoFetchMetricValue).mockResolvedValue({
      ok: true, value: 0, source: 'ad_daily_insights', snapshot_date: '2026-09-15', label: 'lead',
    })
    vi.mocked(loadAdStrategyConfigWithSource).mockResolvedValue({
      config: adStrategyConfig({ daily_budget_cap_cents: 15000 }), source: 'row',
    })
    // 只有对话 + 一天表单线索；日报最新到 09-15
    insightsTable(mixedRows().filter(r => r.entity_id === 'wa' || r.insight_date === '2026-09-15'))
    const ctx = await buildDigestGoalContext('client-1', '2026-09-16')
    expect(ctx?.pace.verdict).toBe('unknown')
    expect(ctx?.pace.reason).toContain('样本不足')
  })
})

describe('withoutCapLens', () => {
  const base: GoalPace = { expectedToDate: 35, actualToDate: 35, gapPct: 0, projectedEnd: 50, verdict: 'on_track', reason: 'x' }
  it('只把 on_track 降成 unknown，其余原样', () => {
    expect(withoutCapLens(base).verdict).toBe('unknown')
    for (const verdict of ['behind', 'unreachable_within_caps', 'unknown'] as const) {
      expect(withoutCapLens({ ...base, verdict })).toEqual({ ...base, verdict })
    }
  })
})

describe('pickDigestGoal — 多个进行中目标', () => {
  it('空列表 → null', () => {
    expect(pickDigestGoal([])).toBeNull()
  })

  it('最新是 signups_count、较旧是 leads_count → 选 leads_count', () => {
    const picked = pickDigestGoal([
      goalRow({ id: 'g-signups', primary_metric_key: 'signups_count', created_at: '2026-09-24T00:00:00Z' }),
      goalRow({ id: 'g-leads', primary_metric_key: 'leads_count' }),
    ])
    expect(picked?.id).toBe('g-leads')
  })

  it('messaging_started 也算广告能量的', () => {
    const picked = pickDigestGoal([
      goalRow({ id: 'g-signups', primary_metric_key: 'signups_count' }),
      goalRow({ id: 'g-msg', primary_metric_key: 'messaging_started' }),
    ])
    expect(picked?.id).toBe('g-msg')
  })

  it('两个都广告能量 → 取最新（列表第一个）', () => {
    const picked = pickDigestGoal([
      goalRow({ id: 'g-new', primary_metric_key: 'messaging_started' }),
      goalRow({ id: 'g-old', primary_metric_key: 'leads_count' }),
    ])
    expect(picked?.id).toBe('g-new')
  })

  it('都不是广告指标 → 回落最新', () => {
    const picked = pickDigestGoal([
      goalRow({ id: 'g-signups', primary_metric_key: 'signups_count' }),
      goalRow({ id: 'g-organic', primary_metric_key: 'organic_traffic' }),
    ])
    expect(picked?.id).toBe('g-signups')
  })
})

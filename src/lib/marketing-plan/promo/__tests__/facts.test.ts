/**
 * 事实读取：读失败 → null（不当 0 / 空 / 通过）；所有读取带 client_id；广告花费只取 campaign 层。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Result { data?: unknown; error?: { message: string } | null; count?: number }
const st = vi.hoisted(() => ({
  results: {} as Record<string, Result>,
  calls: [] as { table: string; filters: [string, unknown][] }[],
}))

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][] }
    st.calls.push(call)
    const res = (): Result => st.results[table] ?? { data: [], error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'limit']) b[m] = () => b
    for (const m of ['eq', 'in', 'gte', 'lte', 'lt', 'contains']) {
      b[m] = (col: string, val: unknown) => { call.filters.push([`${m}:${col}`, val]); return b }
    }
    b.maybeSingle = async () => {
      const r = res()
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null), error: r.error ?? null }
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: res().data ?? [], error: res().error ?? null, count: res().count })
    return b
  }
  return { supabaseAdmin: { from } }
})

import { loadGoal, loadPromoFacts, resolveToday } from '../facts'
import { baseSpec } from './fixtures'

const NOW = new Date('2026-11-12T03:00:00Z') // UTC 11-12 03:00 = 新西兰 11-12 16:00，悉尼 11-12 14:00

beforeEach(() => {
  st.calls = []
  st.results = {
    clients: { data: { industry: null } },
    client_meta_ad_accounts: { data: [{ ad_account_id: 'act_1', daily_budget_cap_cents: 10000 }] },
    ad_entity_snapshots: { data: [{ ad_account_id: 'act_1', account_status: 1, currency: 'AUD', timezone_name: 'Australia/Sydney', captured_at: '2026-11-11T00:00:00Z' }] },
    ad_strategy_configs: { data: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ kind: 'meta_video', ref: 'vid-1', status: 'approved' }] } },
    social_plans: { data: [] },
    goals: { data: { status: 'active', target_value: '100', baseline_value: '0', period_start: '2026-11-01', period_end: '2026-11-30', current_value: '38', current_value_fetched_at: null } },
    ad_daily_insights: { data: [
      { ad_account_id: 'act_1', insight_date: '2026-11-04', spend: '50.00', results: 3, fetched_at: '2026-11-11T00:00:00Z' },
      { ad_account_id: 'act_1', insight_date: '2026-11-05', spend: 12.345, results: 2, fetched_at: '2026-11-12T00:00:00Z' },
    ] },
    content_posts: { count: 4 },
  }
})

const filtersOf = (table: string) => st.calls.filter(c => c.table === table).flatMap(c => c.filters)

describe('resolveToday', () => {
  it('没有广告账户 → UTC 日期，timezone_known 为真（没有花费行要核对）', () => {
    expect(resolveToday([], NOW)).toEqual({ today: '2026-11-12', known: true })
  })
  it('全部已知 → 取最早的本地日期', () => {
    const r = resolveToday(['Pacific/Auckland', 'America/Los_Angeles'], NOW)
    expect(r).toEqual({ today: '2026-11-11', known: true }) // 洛杉矶还在 11-11
  })
  it('任一未知 → UTC 日期且 known=false（不静默当成已知）', () => {
    expect(resolveToday(['Australia/Sydney', null], NOW)).toEqual({ today: '2026-11-12', known: false })
  })
})

describe('loadPromoFacts — 正常读取', () => {
  it('组装出网关事实与对账事实，花费换算成分、只算 campaign 层', async () => {
    const f = await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(f.today).toBe('2026-11-12')
    expect(f.timezone_known).toBe(true)
    expect(f.gate.accounts).toEqual([{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: true }])
    expect(f.gate.config).toMatchObject({ daily_budget_cap_cents: 20000, primary_result: 'leads' })
    expect(f.gate.config?.creative_pool).toEqual([{ ref: 'vid-1', status: 'approved' }])
    expect(f.recon.spend_cents_by_account_day).toEqual({ act_1: { '2026-11-04': 5000, '2026-11-05': 1235 } })
    expect(f.recon.meta_results).toBe(5)
    expect(f.recon.goal?.current_value).toBe(38)
    expect(f.recon.content_published).toBe(4)
    expect(filtersOf('ad_daily_insights')).toContainEqual(['eq:level', 'campaign'])
  })

  it('所有读取都带 client_id（目标 / 账户 / 设置 / 花费 / 内容）', async () => {
    await loadPromoFacts('client-1', baseSpec(), [], NOW)
    for (const t of ['client_meta_ad_accounts', 'ad_strategy_configs', 'goals', 'ad_daily_insights', 'content_posts', 'social_plans', 'meta_ads_snapshots']) {
      const f = filtersOf(t)
      const ok = f.some(([k, v]) => (k === 'eq:client_id' || k === 'eq:id') && v === 'client-1')
      expect(ok, `${t} 应带 client_id`).toBe(true)
    }
  })
})

describe('loadPromoFacts — 读失败一律 null / 不放行', () => {
  const err = { message: 'boom' }
  it('花费读失败 → spend=null、meta_results=null（不是 0）', async () => {
    st.results.ad_daily_insights = { data: null, error: err }
    const f = await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(f.recon.spend_cents_by_account_day).toBeNull()
    expect(f.recon.meta_results).toBeNull()
  })
  it('花费查询成功但窗口内没有任何行 → 按读不出来处理（不是 0）', async () => {
    st.results.ad_daily_insights = { data: [], error: null }
    const f = await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(f.recon.spend_cents_by_account_day).toBeNull()
    expect(f.recon.meta_results).toBeNull()
  })
  it('逐日花费缺失时带上广告数据页的账户合计，不把它写进逐日花费', async () => {
    st.results.ad_daily_insights = { data: [], error: null }
    st.results.meta_ads_snapshots = { data: { spend: '2012.00', period_start: '2026-09-25', period_end: '2026-10-25' } }
    const f = await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(f.recon.spend_cents_by_account_day).toBeNull()
    expect(f.recon.account_total).toEqual({
      spend: 2012, currency: 'AUD', period_start: '2026-09-25', period_end: '2026-10-25',
    })
  })
  it('每日计划覆盖按连续天数算：中间有空档就在空档处停', async () => {
    const day = (date: string) => ({ date, slots: { fb: 'PLANNED' } })
    st.results.social_plans = { data: [{ plan_data: { days: [day('2026-11-12'), day('2026-11-13'), day('2026-11-20')] } }] }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).gate.daily_plan_coverage_days).toBe(2)
  })
  it('同步中途断了（最后一次入库早于窗口末尾）→ 按读不出来，不是缺的天算 0', async () => {
    st.results.ad_daily_insights = { data: [
      { ad_account_id: 'act_1', insight_date: '2026-11-04', spend: '50.00', results: 3, fetched_at: '2026-11-08T00:00:00Z' },
      { ad_account_id: 'act_1', insight_date: '2026-11-05', spend: '50.00', results: 2, fetched_at: '2026-11-08T00:00:00Z' },
    ], error: null }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).recon.spend_cents_by_account_day).toBeNull()
  })
  it('同步活着（窗口结束后还入过库）、末尾几天没行 = 真的零花费，不是读不出来', async () => {
    st.results.ad_daily_insights = { data: [
      { ad_account_id: 'act_1', insight_date: '2026-11-04', spend: '50.00', results: 3, fetched_at: '2026-11-12T00:00:00Z' },
    ], error: null }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).recon.spend_cents_by_account_day).toEqual({ act_1: { '2026-11-04': 5000 } })
  })
  it('后面阶段才用的账户没数据，不拖累前面阶段', async () => {
    const spec = baseSpec()
    spec.phases[1].steps = [{ id: 's2', kind: 'ads_campaign', settings: {
      ad_account_id: 'act_2', daily_budget_cents: 5000, audience_ref: 'a', creative_refs: [], placements: [], paused_ranges: [] } }]
    expect((await loadPromoFacts('client-1', spec, [], NOW)).recon.spend_cents_by_account_day).not.toBeNull()
  })
  it('两个账户都在生效、其中一个断档 → 整体按读不出来', async () => {
    const spec = baseSpec()
    spec.phases[0].steps.push({ id: 's2', kind: 'ads_campaign', settings: {
      ad_account_id: 'act_2', daily_budget_cents: 5000, audience_ref: 'a', creative_refs: [], placements: [], paused_ranges: [] } })
    st.results.ad_daily_insights = { data: [
      { ad_account_id: 'act_1', insight_date: '2026-11-04', spend: '50.00', results: 3, fetched_at: '2026-11-12T00:00:00Z' },
      { ad_account_id: 'act_2', insight_date: '2026-11-04', spend: '50.00', results: 3, fetched_at: '2026-11-05T00:00:00Z' },
    ], error: null }
    expect((await loadPromoFacts('client-1', spec, [], NOW)).recon.spend_cents_by_account_day).toBeNull()
  })
  it('入库时间太旧 → 按读不出来', async () => {
    st.results.ad_daily_insights = { data: [
      { ad_account_id: 'act_1', insight_date: '2026-11-10', spend: '50.00', results: 3, fetched_at: '2026-10-01T00:00:00Z' },
    ], error: null }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).recon.spend_cents_by_account_day).toBeNull()
  })
  it('广告设置读失败 → config=null', async () => {
    st.results.ad_strategy_configs = { data: null, error: err }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).gate.config).toBeNull()
  })
  it('每日计划读失败 → coverage=null；没排任何一天 → 0', async () => {
    st.results.social_plans = { data: null, error: err }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).gate.daily_plan_coverage_days).toBeNull()
    st.results.social_plans = { data: [] }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).gate.daily_plan_coverage_days).toBe(0)
  })
  it('内容条数读失败 → null', async () => {
    st.results.content_posts = { error: err }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).recon.content_published).toBeNull()
  })
  it('账户列表读失败 → 账户一律"不属于该客户"（宁可挡住也不放行）', async () => {
    st.results.client_meta_ad_accounts = { data: null, error: err }
    const f = await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(f.gate.accounts[0].owned_by_client).toBe(false)
  })
  it('账户不在该客户名下 → owned_by_client=false', async () => {
    st.results.client_meta_ad_accounts = { data: [{ ad_account_id: 'act_other', daily_budget_cap_cents: null }] }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).gate.accounts[0].owned_by_client).toBe(false)
  })
  it('没有账户快照 → 时区未知、币种 null', async () => {
    st.results.ad_entity_snapshots = { data: [] }
    const f = await loadPromoFacts('client-1', baseSpec(), [], NOW)
    expect(f.timezone_known).toBe(false)
    expect(f.gate.accounts[0].currency).toBeNull()
    expect(f.gate.snapshots).toEqual({})
  })
  it('没有设置行 → 上限与结果口径为 null（红），不是读失败（灰）', async () => {
    st.results.ad_strategy_configs = { data: null, error: null }
    expect((await loadPromoFacts('client-1', baseSpec(), [], NOW)).gate.config).toEqual({
      daily_budget_cap_cents: null, primary_result: null, creative_pool: [],
    })
  })
})

describe('loadGoal — 目标必须属于同一客户', () => {
  it('带 client_id 过滤；读不到 → null', async () => {
    expect((await loadGoal('client-1', 'goal-1'))?.target_value).toBe(100)
    expect(filtersOf('goals')).toContainEqual(['eq:client_id', 'client-1'])
    st.results.goals = { data: null }
    expect(await loadGoal('client-1', 'goal-x')).toBeNull()
  })
})

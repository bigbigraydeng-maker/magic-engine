/**
 * 自动执行这条线在今日待办上的出口。
 *
 * 🔴 锁的是「发现不许死在日志里」：机器今天没做的事、以及已经放弃的事，
 *    必须以人看得懂的形式出现在待办上，而不是只写进 cron 的运行记录。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAutoRunTodos } from '../auto-run-items'
import { MAX_ATTEMPTS } from '@/lib/execution/auto-run'

const NOW = new Date('2026-08-06T19:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

type Row = Record<string, unknown>

/** 假 supabase 按表建模；没建模的表直接抛，不返回半成品。 */
function makeFake(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const filters: Array<(r: Row) => boolean> = []
    const api: Record<string, unknown> = {}
    const chain = () => api
    api.select = () => chain()
    api.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain())
    api.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain())
    api.gte = (c: string, v: number) => (filters.push((r) => ((r[c] as number) ?? 0) >= v), chain())
    api.lt = () => chain()
    api.not = () => chain()
    api.contains = (c: string, o: Record<string, unknown>) => (
      filters.push((r) =>
        Object.entries(o).every(([k, v]) => ((r[c] as Record<string, unknown>) ?? {})[k] === v),
      ),
      chain()
    )
    api.order = () => chain()
    api.limit = () => chain()
    api.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: tables[table].filter((r) => filters.every((f) => f(r))),
        error: null,
      }).then(resolve)
    return api
  }
  return { from } as unknown as SupabaseClient
}

const client = (over: Row = {}) => ({
  id: 'oztop',
  name: 'Oztop',
  domain: 'oztop.com.au',
  client_status: 'active',
  seo_config: { weekly_blog: true },
  ...over,
})

const item = (over: Row = {}) => ({
  id: 'i1',
  client_id: 'oztop',
  title: '发一篇 SEO 博客',
  action_type: 'generate_blog_post',
  fix_type: 'me_auto',
  status: 'pending',
  source: 'diagnostic',
  prescription_id: 'presc-old',
  marketing_plan_id: null,
  steps_json: null,
  created_at: daysAgo(20),
  started_at: null,
  auto_run_attempts: 0,
  auto_run_next_at: null,
  ...over,
})

const tables = (items: Row[]) => ({
  execution_items: items,
  clients: [client()],
  goals: [{ id: 'g-oztop', client_id: 'oztop', status: 'active', period_end: '2026-12-31' }],
  prescriptions: [
    { id: 'presc-old', client_id: 'oztop', status: 'approved', approved_at: daysAgo(69), generated_at: daysAgo(70) },
    { id: 'presc-dead', client_id: 'oztop', status: 'superseded', approved_at: daysAgo(3), generated_at: daysAgo(4) },
    { id: 'presc-fresh', client_id: 'oztop', status: 'approved', approved_at: daysAgo(2), generated_at: daysAgo(3) },
  ],
  marketing_plans: [],
  execution_logs: [],
})

describe('fetchAutoRunTodos', () => {
  it('🔴 被拦下的动作必须出现在待办上 —— 只写进运行记录 = 发现死在日志里', async () => {
    const todos = await fetchAutoRunTodos(makeFake(tables([item()])), NOW)
    expect(todos).toHaveLength(1)
    expect(todos[0].stuck).toBe(false)
    expect(todos[0].what).toContain('1 件')
    expect(todos[0].what).toContain('没做')
    // 三件套齐全，缺一条就是没下发好
    expect(todos[0].how.length).toBeGreaterThan(10)
    expect(todos[0].href).toMatch(/^https:\/\/app\.magicengine\.com\.au\/dashboard\/clients\//)
  })

  it('🔴 一个客户只出一条汇总 —— 一条动作一条待办 = 刷屏 = PM 直接不看', async () => {
    const many = Array.from({ length: 12 }, (_, i) => item({ id: `i${i}` }))
    const todos = await fetchAutoRunTodos(makeFake(tables(many)), NOW)
    const blocked = todos.filter((t) => !t.stuck)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].what).toContain('12 件')
  })

  it('原因要归类说人话，不是把每条的原文贴出来', async () => {
    const mixed = [
      item({ id: 'a', prescription_id: 'presc-old' }),
      item({ id: 'b', prescription_id: 'presc-old' }),
      item({ id: 'c', prescription_id: 'presc-dead' }),
    ]
    const todos = await fetchAutoRunTodos(makeFake(tables(mixed)), NOW)
    const what = todos.find((t) => !t.stuck)!.what
    expect(what).toContain('2 件方案批下来太久没复核')
    expect(what).toContain('1 件挂的方案已经被换掉')
  })

  it('🔴 方案是新鲜的，拦下的是别的原因（点名了关键词）→ 不能说成「方案批下来太久没复核」', async () => {
    const pinned = [
      item({ id: 'pinned', prescription_id: 'presc-fresh', steps_json: { keyword: 'spc flooring' } }),
    ]
    const todos = await fetchAutoRunTodos(makeFake(tables(pinned)), NOW)
    const what = todos.find((t) => !t.stuck)!.what
    expect(what).not.toContain('太久没复核')
    expect(what).toContain('别的原因')
  })

  it('全都能跑时不出这条待办（没事就别占注意力）', async () => {
    const todos = await fetchAutoRunTodos(
      makeFake(tables([item({ prescription_id: 'presc-fresh' })])),
      NOW,
    )
    expect(todos.filter((t) => !t.stuck)).toHaveLength(0)
  })

  it(`🔴 试了 ${MAX_ATTEMPTS} 次放弃的一条一条报 —— 每条原因不一样，汇总说不清`, async () => {
    const stuck = [
      item({
        id: 'dead1',
        auto_run_attempts: MAX_ATTEMPTS,
        auto_run_error: 'AI 网关超时',
        prescription_id: 'presc-fresh',
      }),
    ]
    const todos = await fetchAutoRunTodos(makeFake(tables(stuck)), NOW)
    const gaveUp = todos.filter((t) => t.stuck)
    expect(gaveUp).toHaveLength(1)
    expect(gaveUp[0].what).toContain('3 次')
    expect(gaveUp[0].what).toContain('已经停手')
    expect(gaveUp[0].what).toContain('AI 网关超时')
    // 放弃的那条不该再混进「今天没做」的汇总里（它已经不是候选了）
    expect(todos.filter((t) => !t.stuck)).toHaveLength(0)
  })

  it('方案过期且没有进行中的目标 → 待办叫人去定目标，不再说会自动重判', async () => {
    const t = tables([item()])
    t.goals = []
    const todos = await fetchAutoRunTodos(makeFake(t), NOW)
    const needsGoal = todos.filter((todo) => todo.needsGoal)
    expect(needsGoal).toHaveLength(1)
    expect(needsGoal[0].what).toContain('没有进行中的目标')
    expect(needsGoal[0].how).not.toContain('周二')
    expect(needsGoal[0].href).toContain('/goal/new')
    expect(todos.filter((todo) => !todo.stuck && !todo.needsGoal)).toHaveLength(0)
  })

  it('已经标成 blocked_needs_goal、目标还是没有 → 待办还在', async () => {
    const t = tables([
      item({ status: 'skipped', auto_run_error: 'blocked_needs_goal' }),
    ])
    t.goals = []
    const todos = await fetchAutoRunTodos(makeFake(t), NOW)
    expect(todos.filter((todo) => todo.needsGoal)).toHaveLength(1)
  })

  it('目标补上之后，停住的卡不再占「去定目标」这一条', async () => {
    const todos = await fetchAutoRunTodos(
      makeFake(tables([item({ status: 'skipped', auto_run_error: 'blocked_needs_goal' })])),
      NOW,
    )
    expect(todos.filter((todo) => todo.needsGoal)).toHaveLength(0)
  })

  it('潜客的动作不进待办 —— 客户闸在选候选那一步就挡住了', async () => {
    const t = tables([item({ client_id: 'lead-co', prescription_id: 'presc-old' })])
    t.clients = [client({ id: 'lead-co', name: '某潜客', client_status: 'prospect' })]
    const todos = await fetchAutoRunTodos(makeFake(t), NOW)
    expect(todos).toHaveLength(0)
  })
})

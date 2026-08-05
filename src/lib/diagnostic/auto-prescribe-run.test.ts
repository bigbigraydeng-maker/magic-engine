/**
 * `runAutoPrescribe` 的编排测试。
 *
 * 为什么单开一个文件：`auto-prescribe.test.ts` 只测纯函数，而复审指出
 * **六条修复里有四条落在编排里、一条都没锁**（客户闸门 / 失败标记 /
 * 冷却跳过失败的 / 开方口径只认人开的那份）—— 恰恰是「花钱、写客户数据、
 * 决定 PM 看不看得见」的那几条。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerate = vi.fn()
const mockLand = vi.fn()
const mockListGoals = vi.fn()

vi.mock('./prescription-generator', () => ({
  generatePrescription: (...a: unknown[]) => mockGenerate(...a),
}))
vi.mock('./prescription-landing', () => ({
  landPrescription: (...a: unknown[]) => mockLand(...a),
}))
vi.mock('@/lib/strategy/goals', () => ({
  listActiveGoals: (...a: unknown[]) => mockListGoals(...a),
}))

import { runAutoPrescribe, AUTO_LANDED_AGENT } from './auto-prescribe'

const NOW = new Date('2026-08-04T00:00:00Z')
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()

interface Tables {
  diagnostic_runs?: unknown[]
  prescriptions?: unknown[]
  clients?: unknown[]
}

/** 记录所有写操作，用来断言「到底往库里写了什么」。 */
function fakeSupabase(tables: Tables) {
  const writes: Array<{ table: string; patch: Record<string, unknown> }> = []

  const from = (table: string) => {
    const rows = (tables as Record<string, unknown[]>)[table] ?? []
    const builder: Record<string, unknown> = {}
    const self = () => builder
    for (const m of ['eq', 'in', 'not', 'gte', 'order', 'limit']) builder[m] = self
    builder.select = self
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
    builder.then = (res: (v: { data: unknown; error: null }) => unknown) =>
      res({ data: rows, error: null })

    return {
      ...builder,
      select: (..._a: unknown[]) => builder,
      update: (patch: Record<string, unknown>) => {
        writes.push({ table, patch })
        const w: Record<string, unknown> = {}
        const wself = () => w
        w.eq = wself
        w.select = () => Promise.resolve({ data: [{ id: 'p1' }], error: null })
        w.then = (res: (v: { error: null }) => unknown) => res({ error: null })
        return w
      },
    }
  }
  return { supabase: { from } as never, writes }
}

const CLIENT = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: '真客户',
  client_status: 'active',
  industry: 'travel',
  ...over,
})
const RUN = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  client_id: 'c1',
  created_at: iso(1),
  dimension_scores: { seo: 40 },
  ...over,
})
const GOAL = {
  id: 'g1',
  title: '目标一号',
  budget_amount: null,
  period_end: '2026-09-30',
  created_at: iso(60),
}

beforeEach(() => {
  mockGenerate.mockReset()
  mockLand.mockReset()
  mockListGoals.mockReset()
  mockGenerate.mockResolvedValue({ prescriptionId: 'p1', content: { phases: [] } })
  mockLand.mockResolvedValue({ initiativesInserted: 3, executionItems: 12, supersededItems: 0, notes: [] })
  mockListGoals.mockResolvedValue([GOAL])
})

describe('runAutoPrescribe —— 客户闸门', () => {
  it('🔴 演示账号 / 潜客不许开方 —— 开方比体检更贵，闸门只装一半等于没装', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN({ client_id: 'demo' })],
      clients: [CLIENT({ id: 'demo', name: 'Harbourline Physio (DEMO)', client_status: 'prospect' })],
    })
    const s = await runAutoPrescribe(supabase, NOW)

    expect(mockGenerate).not.toHaveBeenCalled()
    expect(s.prescribed).toBe(0)
    expect(s.outcomes[0].result).toBe('skipped')
    expect(s.outcomes[0].detail).toContain('不是进行中的付费客户')
  })

  it('🔴 我们自己的内部账号（没填行业）不许开方', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN({ client_id: 'me' })],
      clients: [CLIENT({ id: 'me', name: 'Magic Engine', industry: null })],
    })
    const s = await runAutoPrescribe(supabase, NOW)

    expect(mockGenerate).not.toHaveBeenCalled()
    expect(s.outcomes[0].detail).toContain('内部账号')
  })

  it('真客户照开', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
    })
    const s = await runAutoPrescribe(supabase, NOW)

    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(s.prescribed).toBe(1)
    expect(s.outcomes[0].goalTitle).toBe('目标一号')
  })
})

describe('runAutoPrescribe —— 开方口径只认人开的那份', () => {
  it('🔴 机器自己上周落地的那份不算「上一份口径」—— 否则机器把自己的输出当人的输入滚雪球', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
      prescriptions: [
        {
          client_id: 'c1',
          created_at: iso(7),
          status: 'approved',
          agent_name: AUTO_LANDED_AGENT, // ← 机器自己的
          goal_id: 'g1',
          intake: { business_goal: '机器上周自己写的', monthly_budget_aud: 0, priority_dimensions: [], timeline_urgency: 'short_term', notes: '' },
        },
      ],
    })
    await runAutoPrescribe(supabase, NOW)

    const intake = mockGenerate.mock.calls[0][3] as { notes: string }
    expect(intake.notes).not.toContain('机器上周自己写的')
    expect(intake.notes).toContain('没有人工填过')
  })

  it('人开的那份才会被当上一份口径带进备注', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
      prescriptions: [
        {
          client_id: 'c1',
          created_at: iso(7),
          status: 'approved',
          agent_name: null, // ← 人开的
          goal_id: 'g1',
          intake: { business_goal: 'PM 五月亲手填的', monthly_budget_aud: 3000, priority_dimensions: [], timeline_urgency: 'immediate', notes: '' },
        },
      ],
    })
    await runAutoPrescribe(supabase, NOW)

    const intake = mockGenerate.mock.calls[0][3] as { notes: string; monthly_budget_aud: number }
    expect(intake.notes).toContain('PM 五月亲手填的')
    // 🔴 但那个 3000 只能留在备注里当背景，绝不能进预算字段去切钱
    expect(intake.monthly_budget_aud).toBe(0)
  })
})

describe('runAutoPrescribe —— 失败不许留烂摊子', () => {
  it('🔴 落地失败 → 把那份半成品标掉，否则它白占冷却又会被当上一份口径抄走', async () => {
    mockLand.mockRejectedValue(new Error('执行项生成炸了'))
    const { supabase, writes } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
    })
    const s = await runAutoPrescribe(supabase, NOW)

    expect(s.outcomes[0].result).toBe('error')
    const failMark = writes.find((w) => w.patch.status === 'failed')
    expect(failMark).toBeTruthy()
    expect(String(failMark!.patch.error_message)).toContain('执行项生成炸了')
  })

  it('🔴 失败过的那份不占冷却 —— 否则一次失败静默停掉这个客户一周', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
      prescriptions: [
        { client_id: 'c1', created_at: iso(1), status: 'failed', agent_name: null, goal_id: 'g1', intake: null },
      ],
    })
    const s = await runAutoPrescribe(supabase, NOW)
    expect(s.prescribed).toBe(1) // 昨天失败过，今天照样开
  })

  it('成功过的那份照常占冷却', async () => {
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
      prescriptions: [
        { client_id: 'c1', created_at: iso(1), status: 'approved', agent_name: null, goal_id: 'g1', intake: null },
      ],
    })
    const s = await runAutoPrescribe(supabase, NOW)
    expect(s.prescribed).toBe(0)
    expect(s.outcomes[0].detail).toContain('冷却')
  })

  it('一个客户炸了不拖累其他客户', async () => {
    mockGenerate
      .mockRejectedValueOnce(new Error('第一个炸了'))
      .mockResolvedValueOnce({ prescriptionId: 'p2', content: { phases: [] } })
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN({ id: 'r1', client_id: 'c1' }), RUN({ id: 'r2', client_id: 'c2' })],
      clients: [CLIENT(), CLIENT({ id: 'c2', name: '客户二' })],
    })
    const s = await runAutoPrescribe(supabase, NOW)

    expect(s.outcomes.filter((o) => o.result === 'error')).toHaveLength(1)
    expect(s.prescribed).toBe(1)
  })
})

describe('runAutoPrescribe —— 目标', () => {
  it('🔴 目标全过期 → 跳过并说清楚，不硬挂到一个已经关掉的窗口上', async () => {
    mockListGoals.mockResolvedValue([{ ...GOAL, period_end: '2026-07-01' }])
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
    })
    const s = await runAutoPrescribe(supabase, NOW)

    expect(mockGenerate).not.toHaveBeenCalled()
    expect(s.outcomes[0].detail).toContain('过期')
  })

  it('一个目标都没有 → 跳过并让人先定目标', async () => {
    mockListGoals.mockResolvedValue([])
    const { supabase } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
    })
    const s = await runAutoPrescribe(supabase, NOW)
    expect(s.outcomes[0].detail).toContain('先给他定个目标')
  })

  it('🔴 落地前必须打上「机器自动落地」标记 —— 它是 PM 通知的唯一开关', async () => {
    const { supabase, writes } = fakeSupabase({
      diagnostic_runs: [RUN()],
      clients: [CLIENT()],
    })
    await runAutoPrescribe(supabase, NOW)

    const link = writes.find((w) => w.patch.goal_id === 'g1')
    expect(link).toBeTruthy()
    expect(link!.patch.agent_name).toBe(AUTO_LANDED_AGENT)
  })
})

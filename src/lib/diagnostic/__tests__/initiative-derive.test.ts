/**
 * DAPE Week 2 W4 — deriveInitiativesFromPrescription tests
 *
 * 测试覆盖 BUG-FMT-F21 修法核心:
 *  - legacy 处方 (无 goal_id / 无 initiative_seed) 不破坏
 *  - terminal initiative 优先插入 (供 supporting 当 parent)
 *  - supporting 自动挂 terminal sibling
 *  - 同 Goal 已有同 title Initiative 跳过 (幂等保护 — 防止误删 CTS 现有)
 *  - 全 supporting 时降级 unassigned
 *  - 缺 phase.initiative_seed 整段跳过, 不阻塞其他 phase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prescription, PrescriptionContent, PhaseInitiativeSeed } from '@/types/diagnostic'
import type { InitiativeRow } from '@/types/strategy'

vi.mock('@/lib/strategy/initiatives', () => ({
  listInitiativesForGoal: vi.fn(),
  createInitiative: vi.fn(),
}))

import { deriveInitiativesFromPrescription } from '../initiative-derive'
import { listInitiativesForGoal, createInitiative } from '@/lib/strategy/initiatives'

/**
 * 派生逻辑现在会读一次目标的预算字段（决定要不要给 Initiative 传预算占比），
 * 所以 supabase 不能再是空对象。默认返回「目标没填预算」——
 * 这是生产库的真实形状：CTS / Oztop 7 个进行中目标的预算字段全是空的。
 */
let goalBudgetAmount: number | null = null
const supabase = {
  from: (table: string) => {
    // 认不出的表要炸，不能静默返回 { budget_amount: null } ——
    // 哪天派生逻辑多查一张表，静默兜底会让测试假绿
    if (table !== 'goals') throw new Error(`测试假件没准备 ${table} 表的数据`)
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { budget_amount: goalBudgetAmount }, error: null }),
        }),
      }),
    }
  },
} as never

function makePhase(
  phaseNumber: number,
  seed?: PhaseInitiativeSeed | null,
): PrescriptionContent['phases'][number] {
  return {
    phase_number: phaseNumber,
    name: `Phase ${phaseNumber}`,
    duration_weeks: 4,
    actions: [],
    initiative_seed: seed ?? undefined,
  }
}

function makePrescription(
  phases: PrescriptionContent['phases'],
  overrides: Partial<Pick<Prescription, 'id' | 'client_id' | 'goal_id' | 'version'>> = {},
): Pick<Prescription, 'id' | 'client_id' | 'goal_id' | 'version' | 'content'> {
  return {
    id: 'presc-1',
    client_id: 'client-1',
    goal_id: 'goal-1',
    version: 1,
    content: {
      summary: '',
      phases,
      kpi_targets: [],
      budget_allocation: [],
    },
    ...overrides,
  }
}

function mockListEmpty() {
  vi.mocked(listInitiativesForGoal).mockResolvedValue([])
}

function mockCreateOk(idPrefix: string) {
  let i = 0
  vi.mocked(createInitiative).mockImplementation(async (_s: unknown, input: { goal_id: string; title: string }) => ({
    ok: true,
    initiative: {
      id: `${idPrefix}-${i++}`,
      goal_id: input.goal_id,
      title: input.title,
    } as unknown as InitiativeRow,
  }))
}

describe('deriveInitiativesFromPrescription()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 必须在这儿重置：靠某条用例末尾那句 `goalBudgetAmount = null` 收尾的话，
    // 那条用例一旦在断言处失败，收尾就跑不到，后面所有用例都带着旧值跑，
    // 报出一堆跟真因无关的红。
    goalBudgetAmount = null
  })

  it('skips entirely when prescription has no goal_id (legacy 模式不破坏)', async () => {
    const presc = makePrescription([makePhase(1, {
      initiative_type: 'demand_generation',
      title: 'X',
    })], { goal_id: null })

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.notes.some(n => n.includes('legacy'))).toBe(true)
    expect(listInitiativesForGoal).not.toHaveBeenCalled()
    expect(createInitiative).not.toHaveBeenCalled()
  })

  it('skips phases without initiative_seed (DAPE 过渡期兼容)', async () => {
    mockListEmpty()
    mockCreateOk('init')
    const presc = makePrescription([
      makePhase(1),  // no seed
      makePhase(2, { initiative_type: 'demand_generation', title: 'Brisbane 询盘' }),
    ])

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
    expect(r.initiativeIdsByPhase[2]).toBe('init-0')
    expect(r.initiativeIdsByPhase[1]).toBeUndefined()
  })

  it('builds terminal initiatives first then supporting (Phase 31 tier 顺序)', async () => {
    mockListEmpty()
    mockCreateOk('init')
    const presc = makePrescription([
      // 顺序故意倒过来: supporting phase 1 → terminal phase 2
      makePhase(1, { initiative_type: 'content_asset_production', title: '弹药库' }),
      makePhase(2, { initiative_type: 'demand_generation', title: 'Brisbane 询盘' }),
    ])

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(2)

    // 验证: createInitiative 先建 terminal (phase 2), 再建 supporting (phase 1)
    const calls = vi.mocked(createInitiative).mock.calls
    expect(calls[0]?.[1].initiative_type).toBe('demand_generation')
    expect(calls[1]?.[1].initiative_type).toBe('content_asset_production')

    // supporting 必须挂到 terminal (init-0)
    expect(calls[1]?.[1].supports_initiative_id).toBe('init-0')
  })

  it('supporting falls back to unassigned when no terminal sibling exists', async () => {
    mockListEmpty()
    mockCreateOk('init')
    const presc = makePrescription([
      makePhase(1, { initiative_type: 'content_asset_production', title: '只有弹药' }),
    ])

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(1)
    const calls = vi.mocked(createInitiative).mock.calls
    // 降级: content_asset_production → unassigned (因无 terminal sibling)
    expect(calls[0]?.[1].initiative_type).toBe('unassigned')
    expect(r.notes.some(n => n.includes('降级为 unassigned'))).toBe(true)
  })

  it('🔴 目标没填预算时不给 Initiative 传预算占比 —— 免得一个不影响任何事的数字去撞 100% 上限', async () => {
    // 真实形状：CTS《Best of China》已被 FDE 的 3 条战线占了 70%，
    // 任何正常三阶段切分都会被「同目标占比之和 ≤ 100%」挡掉大半；
    // 而旧战线从不归档，基数只涨不落 —— 两三周后新方案一条都插不进去，
    // 整条派生链自己勒死，回到「动作全部未归类」的原状。
    goalBudgetAmount = null
    mockListEmpty()
    mockCreateOk('init')

    const presc = makePrescription([
      makePhase(1, { initiative_type: 'demand_generation', title: 'A', budget_percent: 40 }),
    ])
    await deriveInitiativesFromPrescription(supabase, presc)

    expect(vi.mocked(createInitiative).mock.calls[0][1].budget_percent).toBeUndefined()
  })

  it('目标填了预算时照常传占比', async () => {
    goalBudgetAmount = 5000
    mockListEmpty()
    mockCreateOk('init')

    const presc = makePrescription([
      makePhase(1, { initiative_type: 'demand_generation', title: 'A', budget_percent: 40 }),
    ])
    await deriveInitiativesFromPrescription(supabase, presc)

    expect(vi.mocked(createInitiative).mock.calls[0][1].budget_percent).toBe(40)
  })

  it('🔴 认不出来的战线类型不许静默蒸发 —— 要记进跳过数并留下日志', async () => {
    mockListEmpty()
    mockCreateOk('init')

    const presc = makePrescription([
      makePhase(1, { initiative_type: 'brand_awareness' as never, title: '飘出来的类型' }),
    ])
    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(0)
    expect(r.skipped).toBe(1)
    expect(r.notes.join()).toContain('不认识的战线类型')
  })

  it('skips when title duplicates an existing Initiative (CTS 保护)', async () => {
    // 模拟 CTS Goal 下已有"Brisbane 询盘"Initiative
    vi.mocked(listInitiativesForGoal).mockResolvedValue([
      { id: 'cts-old', title: 'Brisbane 询盘', tier: 'terminal', is_archived: false } as unknown as InitiativeRow,
    ])
    mockCreateOk('init')

    const presc = makePrescription([
      makePhase(1, { initiative_type: 'demand_generation', title: 'Brisbane 询盘' }),
      makePhase(2, { initiative_type: 'trust_building', title: '口碑加固' }),
    ])

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(1)  // 只 phase 2 入
    expect(r.skipped).toBe(1)   // phase 1 同名跳过

    // 🔴 跳过 ≠ 丢掉：这个阶段的动作必须挂回那条**已存在**的 Initiative。
    //    原来只回一个 skipped、不回 id，于是 phase 1 的执行项 initiative_id 全是 null，
    //    在按目标筛的看板上一条都看不见。而处方提示词恰恰在往「标题稳定」上推
    //    （跟阶段名一致、用客户看得懂的话），标题越听话越容易撞、动作越挂不上 ——
    //    幂等保护反倒成了挂载杀手。
    expect(r.initiativeIdsByPhase[1]).toBe('cts-old')
    expect(r.notes.some(n => n.includes('幂等保护'))).toBe(true)
    expect(createInitiative).toHaveBeenCalledTimes(1)
  })

  it('respects supports_phase_number to link supporting → specific terminal', async () => {
    mockListEmpty()
    mockCreateOk('init')

    const presc = makePrescription([
      makePhase(1, { initiative_type: 'demand_generation', title: 'Terminal A' }),
      makePhase(2, { initiative_type: 'competitive_defense', title: 'Terminal B' }),
      makePhase(3, {
        initiative_type: 'content_asset_production',
        title: '挂 A 的弹药',
        supports_phase_number: 1,  // 指向 Terminal A
      }),
    ])

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(3)
    const calls = vi.mocked(createInitiative).mock.calls
    // 第 3 个调用是 supporting, supports_initiative_id 应是 init-0 (phase 1 的 terminal)
    const supportingCall = calls.find(c => c[1].initiative_type === 'content_asset_production')
    expect(supportingCall?.[1].supports_initiative_id).toBe('init-0')
  })

  it('handles empty phases gracefully', async () => {
    mockListEmpty()
    const presc = makePrescription([])
    const r = await deriveInitiativesFromPrescription(supabase, presc)
    expect(r.inserted).toBe(0)
    expect(r.skipped).toBe(0)
  })

  it('continues if createInitiative fails on one phase (resilient)', async () => {
    mockListEmpty()
    let i = 0
    vi.mocked(createInitiative).mockImplementation(async (_s: unknown, input: { goal_id: string; title: string; initiative_type: string }) => {
      if (input.initiative_type === 'trust_building') {
        return { ok: false, error: 'budget exceeds 100%' }
      }
      return {
        ok: true,
        initiative: {
          id: `init-${i++}`,
          goal_id: input.goal_id,
          title: input.title,
        } as unknown as InitiativeRow,
      }
    })

    const presc = makePrescription([
      makePhase(1, { initiative_type: 'demand_generation', title: '获客' }),
      makePhase(2, { initiative_type: 'trust_building', title: '信任' }),  // 失败
    ])

    const r = await deriveInitiativesFromPrescription(supabase, presc)

    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
    expect(r.notes.some(n => n.includes('budget exceeds 100%'))).toBe(true)
  })
})

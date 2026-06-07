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

const supabase = {} as never  // 我们 mock 了 lib/strategy/initiatives, supabase 实参不被读

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

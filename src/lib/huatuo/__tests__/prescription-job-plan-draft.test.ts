import { beforeEach, describe, expect, it, vi } from 'vitest'

const updates: Array<Record<string, unknown>> = []
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch)
        const chain = { eq: () => chain, then: (r: (v: unknown) => void) => r({ error: null }) }
        return chain
      },
    }),
  },
}))

const mockRun = vi.fn()
const mockRefine = vi.fn()
vi.mock('@/lib/huatuo/agent', () => ({
  runHuatuo: (...a: unknown[]) => mockRun(...a),
  refineHuatuoPrescription: (...a: unknown[]) => mockRefine(...a),
}))
vi.mock('@/lib/memory', () => ({ loadMemoryForClient: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ads-strategy/plan-seed/attach', () => ({
  attachPlanSeed: async (c: unknown) => c,
}))
vi.mock('@/lib/case-library/saver', () => ({
  savePrescriptionCase: vi.fn().mockResolvedValue(undefined),
  deriveCrisisType: vi.fn().mockReturnValue('x'),
}))
vi.mock('@/lib/huatuo/industry-mapper', () => ({ mapIndustryToCategory: () => 'other' }))
vi.mock('@/lib/ads/budget-currency', () => ({ audOnlyAmount: () => 0 }))

const mockHook = vi.fn()
vi.mock('@/lib/marketing-plan/promo/plan-draft-hook', () => ({
  afterPrescriptionDraftSaved: (...a: unknown[]) => mockHook(...a),
}))

import { executePrescriptionGeneration, executePrescriptionRefine } from '../prescription-job'

function result() {
  return {
    content: { summary: 's', phases: [] },
    self_grade: { overall: 80 },
    meta: { agent_version: 'v1' },
    benchmarks_used: [],
    trend_summary: null,
  }
}

const generation = {
  clientId: 'c1', prescriptionId: 'p1', discoveryId: 'd1',
  discovery: { business: { industry: 'x' } },
  intake: { priority_dimensions: [], monthly_budget_aud: 1000 },
  goal: null,
} as unknown as Parameters<typeof executePrescriptionGeneration>[0]

const refine = {
  clientId: 'c1', prescriptionId: 'p1',
  discovery: {}, intake: {}, previousContent: { summary: 'old' },
  previousWeaknesses: [], previousPasses: 1, previousSelfGrade: null, goal: null,
} as unknown as Parameters<typeof executePrescriptionRefine>[0]

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  mockRun.mockResolvedValue(result())
  mockRefine.mockResolvedValue(result())
  mockHook.mockResolvedValue(undefined)
})

describe('plan draft hook in the Huatuo background job', () => {
  it('generation: calls the hook after the draft is saved, with the same prescription id', async () => {
    await executePrescriptionGeneration(generation)
    expect(updates.some((u) => u.status === 'draft')).toBe(true)
    const saved = updates.find((u) => u.status === 'draft')
    const measure = (saved?.generation_meta as { measure?: { v?: number; blocked?: boolean } } | undefined)?.measure
    expect(measure).toMatchObject({ v: 1, blocked: true })
    expect(mockHook).toHaveBeenCalledTimes(1)
    expect(mockHook).toHaveBeenCalledWith({ clientId: 'c1', prescriptionId: 'p1' })
  })

  it('refine: calls the hook after the refined draft is saved', async () => {
    await executePrescriptionRefine(refine)
    expect(updates.some((u) => u.status === 'draft')).toBe(true)
    expect(mockHook).toHaveBeenCalledTimes(1)
    expect(mockHook).toHaveBeenCalledWith({ clientId: 'c1', prescriptionId: 'p1' })
  })

  it('generation failure: hook is not called and status becomes failed', async () => {
    mockRun.mockRejectedValue(new Error('model down'))
    await executePrescriptionGeneration(generation)
    expect(mockHook).not.toHaveBeenCalled()
    expect(updates.at(-1)).toMatchObject({ status: 'failed' })
  })

  it('hook throwing never changes the prescription status (generation)', async () => {
    mockHook.mockRejectedValue(new Error('hook boom'))
    await executePrescriptionGeneration(generation)
    expect(updates.some((u) => u.status === 'failed')).toBe(false)
    expect(updates.at(-1)).toMatchObject({ status: 'draft' })
  })

  it('hook throwing never changes the prescription status (refine)', async () => {
    mockHook.mockRejectedValue(new Error('hook boom'))
    await executePrescriptionRefine(refine)
    expect(updates.every((u) => u.error_message === null || u.error_message === undefined)).toBe(true)
    expect(updates.at(-1)).toMatchObject({ status: 'draft', error_message: null })
  })
})

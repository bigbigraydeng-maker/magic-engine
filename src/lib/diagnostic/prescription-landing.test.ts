import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDerive = vi.fn()
const mockGenerate = vi.fn()

vi.mock('./initiative-derive', () => ({
  deriveInitiativesFromPrescription: (...a: unknown[]) => mockDerive(...a),
}))
vi.mock('./execution-generator', () => ({
  generateExecutionItems: (...a: unknown[]) => mockGenerate(...a),
}))

import { landPrescription, type LandablePrescription } from './prescription-landing'

/** 记录每一次 update 调用，用来断言「到底往表里写了什么」。 */
function fakeSupabase(opts: { updateError?: Record<string, string> } = {}) {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
  const from = (table: string) => ({
    update: (patch: Record<string, unknown>) => {
      updates.push({ table, patch })
      const err = opts.updateError?.[String(patch.status)]
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.eq = self
      chain.then = (res: (v: { error: { message: string } | null }) => unknown) =>
        res({ error: err ? { message: err } : null })
      return chain
    },
  })
  return { supabase: { from } as never, updates }
}

const PRES: LandablePrescription = {
  id: 'p1',
  client_id: 'c1',
  goal_id: 'g1',
  version: 2,
  content: { summary: 's', phases: [], kpi_targets: [], budget_allocation: [] },
  supersedes_id: null,
}

beforeEach(() => {
  mockDerive.mockReset()
  mockGenerate.mockReset()
  mockDerive.mockResolvedValue({ inserted: 2, skipped: 0, notes: [], initiativeIdsByPhase: { 1: 'i1' } })
  mockGenerate.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }])
})

describe('landPrescription —— 方案变成看板上的活儿', () => {
  it('正常路径：派生 Initiative → 生成执行项 → 标记已批准', async () => {
    const { supabase, updates } = fakeSupabase()
    const r = await landPrescription(supabase, PRES)

    expect(r.initiativesInserted).toBe(2)
    expect(r.executionItems).toBe(3)
    const approved = updates.find((u) => u.patch.status === 'approved')
    expect(approved).toBeTruthy()
    expect(approved!.patch.approved_at).toBeTruthy()
  })

  it('🔴 派生 Initiative 失败**不**阻塞落地 —— 挂不上目标不代表动作做不了', async () => {
    mockDerive.mockRejectedValue(new Error('goal 没了'))
    const { supabase, updates } = fakeSupabase()
    const r = await landPrescription(supabase, PRES)

    expect(r.executionItems).toBe(3)
    expect(r.notes.join()).toContain('Initiative 派生失败')
    expect(updates.some((u) => u.patch.status === 'approved')).toBe(true)
  })

  it('🔴 执行项生成失败**必须**阻塞 —— 绝不能留下「已批准但看板上没动作」的幽灵', async () => {
    mockGenerate.mockRejectedValue(new Error('AI 挂了'))
    const { supabase, updates } = fakeSupabase()

    await expect(landPrescription(supabase, PRES)).rejects.toThrow('AI 挂了')
    // 关键：一次 approved 都不许写出去，处方要留在 draft
    expect(updates.some((u) => u.patch.status === 'approved')).toBe(false)
  })

  it('修订版落地 → 把被它替代的上一版归档，否则看板上同时挂着两版方案', async () => {
    const { supabase, updates } = fakeSupabase()
    await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(updates.some((u) => u.patch.status === 'superseded')).toBe(true)
  })

  it('旧版归档失败不致命 —— 新方案已经落地了，只是界面上多一份', async () => {
    const { supabase } = fakeSupabase({ updateError: { superseded: '写不进去' } })
    const r = await landPrescription(supabase, { ...PRES, supersedes_id: 'old1' })
    expect(r.executionItems).toBe(3)
    expect(r.notes.join()).toContain('归档失败')
  })

  it('🔴 标记已批准失败要 throw —— 落地了却没记上，下周会重复开一份一样的方案', async () => {
    const { supabase } = fakeSupabase({ updateError: { approved: '列不存在' } })
    await expect(landPrescription(supabase, PRES)).rejects.toThrow('标记处方已批准失败')
  })

  it('🔴 只写表里真有的列 —— approved_by 不是表字段，写进去整条 UPDATE 会失败', async () => {
    const { supabase, updates } = fakeSupabase()
    await landPrescription(supabase, PRES, '张三')
    const approved = updates.find((u) => u.patch.status === 'approved')!
    expect(Object.keys(approved.patch).sort()).toEqual(['approved_at', 'status'])
  })
})

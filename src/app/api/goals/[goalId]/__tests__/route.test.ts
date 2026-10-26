import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/strategy/auth-helpers', () => ({
  requireGoalAccess: vi.fn(),
}))

vi.mock('@/lib/strategy/goals', () => ({
  deleteDraftGoal: vi.fn(),
  updateDraftGoalReason: vi.fn(),
}))

import { PATCH } from '../route'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'
import { updateDraftGoalReason } from '@/lib/strategy/goals'

const access = vi.mocked(requireGoalAccess)
const updateReason = vi.mocked(updateDraftGoalReason)
const params = { goalId: 'goal-1' }

function patch(body: string) {
  return new Request('http://test/api/goals/goal-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  access.mockResolvedValue({
    ok: true,
    row: { id: 'goal-1', status: 'draft' } as never,
  })
})

describe('PATCH /api/goals/[goalId]', () => {
  it('returns the access error without updating', async () => {
    access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await PATCH(patch(JSON.stringify({ fde_reasoning: '本周期以成交笔数验收。' })), { params })
    expect(res.status).toBe(403)
    expect(updateReason).not.toHaveBeenCalled()
  })

  it('rejects a body that is not only the reason', async () => {
    const extra = await PATCH(patch(JSON.stringify({ fde_reasoning: 'x', status: 'active' })), { params })
    const empty = await PATCH(patch(JSON.stringify({})), { params })
    const broken = await PATCH(patch('{'), { params })
    expect(extra.status).toBe(400)
    expect(empty.status).toBe(400)
    expect(broken.status).toBe(400)
    expect(updateReason).not.toHaveBeenCalled()
  })

  it('updates the draft reason and returns the row', async () => {
    updateReason.mockResolvedValue({ ok: true, goal: { id: 'goal-1', fde_reasoning: '本周期以成交笔数验收。' } as never })
    const res = await PATCH(patch(JSON.stringify({ fde_reasoning: '本周期以成交笔数验收。' })), { params })
    expect(res.status).toBe(200)
    expect(updateReason).toHaveBeenCalledWith(expect.anything(), 'goal-1', '本周期以成交笔数验收。')
    await expect(res.json()).resolves.toMatchObject({
      goal: { fde_reasoning: '本周期以成交笔数验收。' },
    })
  })

  it('returns the refusal from the draft update', async () => {
    updateReason.mockResolvedValue({ ok: false, error: '不能保存草稿，缺：理由' })
    const res = await PATCH(patch(JSON.stringify({ fde_reasoning: '短' })), { params })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: '不能保存草稿，缺：理由' })
  })
})

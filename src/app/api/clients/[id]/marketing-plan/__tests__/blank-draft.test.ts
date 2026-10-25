import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  goal: null as Record<string, unknown> | null,
  goalError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  ops: [] as { table: string; op: string; payload?: unknown }[],
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.access,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      mocks.ops.push({ table, op: 'from' })
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.eq = self
      chain.insert = (payload: unknown) => {
        mocks.ops.push({ table, op: 'insert', payload })
        return chain
      }
      chain.update = (payload: unknown) => {
        mocks.ops.push({ table, op: 'update', payload })
        return chain
      }
      chain.maybeSingle = async () => ({ data: mocks.goal, error: mocks.goalError })
      chain.single = async () => {
        if (mocks.insertError) return { data: null, error: mocks.insertError }
        const inserted = mocks.ops.find(op => op.op === 'insert')?.payload
        return { data: { id: 'plan-new', ...(inserted as object) }, error: null }
      }
      return chain
    },
  },
}))

import { POST } from '../route'

const CLIENT = 'client-1'
const draftGoal = {
  id: 'goal-draft',
  title: 'CTS11月China Tour推广',
  status: 'draft',
  period_start: '2026-10-25',
  period_end: '2026-11-30',
}

function post(body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT}/marketing-plan`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id: CLIENT } },
  )
}

beforeEach(() => {
  mocks.access.mockReset()
  mocks.access.mockResolvedValue({ ok: true, tier: 'paid_client' })
  mocks.goal = draftGoal
  mocks.goalError = null
  mocks.insertError = null
  mocks.ops = []
})

describe('POST /marketing-plan 空白草稿', () => {
  it('草稿目标：只插入一行草稿，不改别的计划', async () => {
    const res = await post({ goal_id: 'goal-draft', title: '春节后促销 60 天集中获客' })
    expect(res.status).toBe(200)
    const inserted = mocks.ops.find(op => op.op === 'insert')?.payload as Record<string, unknown>
    expect(inserted.status).toBe('draft')
    expect(inserted.approved_at).toBeNull()
    expect(inserted.title).toBe('CTS11月China Tour推广')
    expect(inserted.plan_data).not.toHaveProperty('promo')
    expect((inserted.plan_data as { tasks: unknown[] }).tasks).toEqual([])
    expect(inserted.generation_meta).toEqual({ blank_draft: { goal_id: 'goal-draft' } })
    expect(JSON.stringify(inserted)).not.toContain('春节后促销')
    expect(mocks.ops.filter(op => op.op === 'update')).toEqual([])
    const tables = mocks.ops.filter(op => op.op === 'from').map(op => op.table)
    expect(tables).toEqual(['goals', 'marketing_plans'])
  })

  it('进行中的目标同样可以建', async () => {
    mocks.goal = { ...draftGoal, status: 'active' }
    expect((await post({ goal_id: 'goal-draft' })).status).toBe(200)
  })

  it.each(['expired', 'archived'])('%s 目标被拒绝，不写库', async (status) => {
    mocks.goal = { ...draftGoal, status }
    const res = await post({ goal_id: 'goal-draft' })
    expect(res.status).toBe(400)
    expect(mocks.ops.some(op => op.op === 'insert')).toBe(false)
  })

  it('目标不属于这个客户 → 400，不插入', async () => {
    mocks.goal = null
    const res = await post({ goal_id: 'goal-other-client' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('不属于这个客户')
    expect(mocks.ops.some(op => op.op === 'insert')).toBe(false)
  })

  it('读目标失败 → 500，不把失败当成“没有这个目标”', async () => {
    mocks.goalError = { message: 'db down' }
    const res = await post({ goal_id: 'goal-draft' })
    expect(res.status).toBe(500)
    expect(mocks.ops.some(op => op.op === 'insert')).toBe(false)
  })

  it('没选目标 → 400，不查库', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect(mocks.ops).toEqual([])
  })

  it('没权限 → 原样返回，不写库', async () => {
    mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'no', reason: 'paid_only' })
    const res = await post({ goal_id: 'goal-draft' })
    expect(res.status).toBe(403)
    expect(mocks.ops).toEqual([])
  })

  it('保存失败 → 500', async () => {
    mocks.insertError = { message: 'insert failed' }
    expect((await post({ goal_id: 'goal-draft' })).status).toBe(500)
  })
})

/**
 * 回归锁：PATCH /api/clients/[id]/prescription/[pId]
 *
 * 2026-08-04 事故 —— 路由把 `rejection_note` 写进 UPDATE payload，但当时生产库没有
 * 这一列（`approved_by` 同样不存在）→ PostgREST PGRST204 → 路由 500
 * `Failed to update prescription` → 处方页「重新生成」按钮全程不可用。
 * 两列已由 20260804020000 migration 补上。
 *
 * 这里锁三件事：
 *   1. 打回带理由拿 200，理由落在 rejection_note 上，payload 里没有幻觉列
 *   2. 批准人来自登录会话，不是前端传的值
 *   3. 打回写库失败照常 500，不假装成功
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'fde@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))

const mockLand = vi.fn()
vi.mock('@/lib/diagnostic/prescription-landing', () => ({
  landPrescription: (...a: unknown[]) => mockLand(...a),
}))

import { PATCH } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { PRESCRIPTION_COLUMNS } from '@/lib/diagnostic/prescription-patch'

const params = { id: 'client-1', pId: 'presc-1' }
const REAL_COLUMNS = new Set<string>(PRESCRIPTION_COLUMNS)

const DRAFT = {
  id: 'presc-1',
  client_id: 'client-1',
  status: 'draft',
  supersedes_id: null,
  goal_id: 'goal-1',
  version: 1,
  content: null,
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://test/api/clients/client-1/prescription/presc-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 第一次 from() = 取当前处方；之后每次 from() = 一次写/读回。
 * `result` 是写（或批准后读回）那一次的返回值。
 */
function mockSupabase(result: { data: unknown; error: unknown }) {
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  })

  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>)
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: DRAFT, error: null }),
    })
    .mockReturnValue({
      update,
      // 批准路径落地后会把整行读回来返回给前端
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(result),
    })

  return update
}

const ok = (status: string) => ({ data: { ...DRAFT, status }, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  mockLand.mockResolvedValue({
    initiativesInserted: 0,
    executionItems: 0,
    supersededItems: 0,
    notes: [],
  })
})

describe('PATCH prescription — 打回', () => {
  it('带理由返回 200，不再 500', async () => {
    mockSupabase(ok('rejected'))

    const res = await PATCH(
      makeRequest({ status: 'rejected', rejection_note: '用户要求重新生成' }),
      { params },
    )

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('payload 只含真实列，理由落在 rejection_note', async () => {
    const update = mockSupabase(ok('rejected'))

    await PATCH(
      makeRequest({ status: 'rejected', rejection_note: '用户要求重新生成' }),
      { params },
    )

    const patch = update.mock.calls[0][0] as Record<string, unknown>
    for (const key of Object.keys(patch)) {
      expect(REAL_COLUMNS.has(key), `幻觉列: ${key}`).toBe(true)
    }
    expect(patch).toEqual({ status: 'rejected', rejection_note: '用户要求重新生成' })
  })

  it('写库失败照常 500，不假装成功', async () => {
    mockSupabase({ data: null, error: { code: '23503', message: 'boom' } })

    const res = await PATCH(makeRequest({ status: 'rejected' }), { params })

    expect(res.status).toBe(500)
    expect((await res.json()).success).toBe(false)
  })
})

describe('PATCH prescription — 批准', () => {
  it('批准人取自登录会话，不认前端传值', async () => {
    mockSupabase(ok('approved'))

    const res = await PATCH(
      makeRequest({ status: 'approved', approved_by: 'attacker@evil.com' }),
      { params },
    )

    expect(res.status).toBe(200)
    expect(mockLand).toHaveBeenCalledTimes(1)
    expect(mockLand.mock.calls[0][2]).toBe('fde@magiclab.com')
  })

  it('落地失败 → 500，处方不留在"已批准但没动作"', async () => {
    mockSupabase(ok('approved'))
    mockLand.mockRejectedValue(new Error('生成执行项失败'))

    const res = await PATCH(makeRequest({ status: 'approved' }), { params })

    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('生成执行计划失败')
  })
})

describe('PATCH prescription — 入参校验', () => {
  it('status 不合法 → 400', async () => {
    const res = await PATCH(makeRequest({ status: 'maybe' }), { params })
    expect(res.status).toBe(400)
  })
})

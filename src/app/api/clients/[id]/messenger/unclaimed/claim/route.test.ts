import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a', user: { email: 'sales@x.co.nz' } })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const post = (body: unknown) =>
  POST(new NextRequest('http://x/api', { method: 'POST', body: JSON.stringify(body) }), { params: { id: 'client-a' } })

beforeEach(() => vi.clearAllMocks())

describe('claim 新建客户的名字', () => {
  it('名字是邮箱 / 电话 / 占位词 → 400 并说明原因，不碰数据库', async () => {
    for (const newContactName of ['bob@example.com', '+64 21 123 4567', 'Facebook 用户']) {
      const res = await post({ conversationId: 'cv1', newContactName })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('不能是邮箱')
    }
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('既没选客户也没给名字 → 仍是原来的 400 提示', async () => {
    const res = await post({ conversationId: 'cv1' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('要么选一个已有客户')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOperatorAccess: mocks.access }))
vi.mock('@/lib/memory', () => ({ runExtractorForClient: mocks.run }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { tag: 'admin-client' } }))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from '../route'

const url = 'http://localhost/api/clients/client-1/memory/extract'
const call = () => POST(new NextRequest(url, { method: 'POST' }), { params: { id: 'client-1' } })

/**
 * 手工 FDE 入口从不下架记忆：每一次下架都必须落进每日 cron 的运行记录，
 * 那份记录就是回滚清单。
 */
describe('手工触发记忆抽取', () => {
  beforeEach(() => vi.clearAllMocks())

  it('手工入口从不下架：带 reconcile: false 调抽取器', async () => {
    mocks.access.mockResolvedValue({ ok: true })
    mocks.run.mockResolvedValue({ outcomes_processed: 0 })

    const res = await call()

    expect(res.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.run).toHaveBeenCalledWith(supabaseAdmin, 'client-1', expect.any(Date), {
      reconcile: false,
    })
  })

  it('没有权限：不跑抽取器', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })

    const res = await call()

    expect(res.status).toBe(403)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('抽取器抛错：返回 500 和错误信息', async () => {
    mocks.access.mockResolvedValue({ ok: true })
    mocks.run.mockRejectedValue(new Error('boom'))

    const res = await call()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})

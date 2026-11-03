/**
 * 这份测试盯的是三件会让「清理」变成假象的事：
 *   1. 没带钥匙也能敲（清理是删数据，敞开就是删数据敞开）
 *   2. 数据库那边报错了，接口还回 200 —— 那这套监控自己坏掉时没人知道
 *   3. 删了多少行没写进运行记录 —— 那就跟没跑过一样看不见
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}))

const finish = vi.fn(async () => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish })),
}))

vi.mock('@/lib/cron/abandon-stale-runs', () => ({
  abandonStaleRunningRuns: vi.fn(async () => ({ abandoned: 0 })),
}))

import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { abandonStaleRunningRuns } from '@/lib/cron/abandon-stale-runs'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret-123'
})

function makeReq(authHeader?: string) {
  const headers = new Headers()
  if (authHeader) headers.set('authorization', authHeader)
  return new NextRequest('http://localhost/api/cron/cron-run-logs-cleanup', { headers })
}

describe('GET /api/cron/cron-run-logs-cleanup', () => {
  it('没带钥匙 → 401，而且一行都没删', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('钥匙不对 → 401', async () => {
    expect((await GET(makeReq('Bearer wrong'))).status).toBe(401)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('服务器没配钥匙 → 500，不许当成「没配就放行」', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('正常跑完：调的是保留规则那个函数，删了多少行写进运行记录', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: {
        purged_noise: 12,
        purged_expired: 3,
        remaining: 31000,
        oldest_started_at: '2026-07-07T00:00:32.615874+00:00',
      },
      error: null,
    })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ purged_noise: 12, purged_expired: 3, abandoned: 0 })

    // 🔴 函数名写错 = 生产上直接 404，而单测照样绿。所以断言的是具体名字。
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('cron_run_logs_purge')
    expect(startCronRun).toHaveBeenCalledWith('cron-run-logs-cleanup')
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        processed: 15,
        completed: 15,
        failed: 0,
        summary: expect.objectContaining({
          purged_noise: 12,
          purged_expired: 3,
          remaining: 31000,
          abandoned: 0,
        }),
      }),
    )
  })

  it('数据库报错 → 500 且运行记录记成失败，不许静默当成功', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'function public.cron_run_logs_purge() does not exist' },
    })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        failed: 1,
        error: 'function public.cron_run_logs_purge() does not exist',
      }),
    )
    expect(abandonStaleRunningRuns).not.toHaveBeenCalled()
  })

  it('收掉过期的 running 行，并把条数写进运行记录', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: { purged_noise: 1, purged_expired: 0, remaining: 10, oldest_started_at: null },
      error: null,
    })
    vi.mocked(abandonStaleRunningRuns).mockResolvedValue({ abandoned: 2 })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ abandoned: 2 })
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        processed: 3,
        completed: 3,
        failed: 0,
        summary: expect.objectContaining({ abandoned: 2 }),
      }),
    )
  })

  it('收口写不进去 → 清理自己记成失败，不许假装清完了', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: { purged_noise: 1, purged_expired: 0, remaining: 10, oldest_started_at: null },
      error: null,
    })
    vi.mocked(abandonStaleRunningRuns).mockResolvedValue({ abandoned: 0, error: 'update failed' })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, error: 'update failed' }),
    )
  })
})

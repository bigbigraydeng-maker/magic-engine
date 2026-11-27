/**
 * 这份测试盯的是三件会让「清理」变成假象的事：
 *   1. 没带钥匙也能敲（清理是删数据，敞开就是删数据敞开）
 *   2. 数据库那边报错了，接口还回 200 —— 那这套监控自己坏掉时没人知道
 *   3. 删了多少行没写进运行记录 —— 那就跟没跑过一样看不见
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { purgeCronRunLogsBatched } = vi.hoisted(() => ({
  purgeCronRunLogsBatched: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {},
}))

vi.mock('@/lib/cron/cron-run-logs-purge', () => ({
  purgeCronRunLogsBatched,
  PURGE_TIME_BUDGET_MS: 95_000,
}))

const finish = vi.fn(async () => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish })),
}))

vi.mock('@/lib/cron/abandon-stale-runs', () => ({
  abandonStaleRunningRuns: vi.fn(async () => ({ abandoned: 0 })),
}))

import { GET } from '../route'
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
    expect(purgeCronRunLogsBatched).not.toHaveBeenCalled()
  })

  it('钥匙不对 → 401', async () => {
    expect((await GET(makeReq('Bearer wrong'))).status).toBe(401)
    expect(purgeCronRunLogsBatched).not.toHaveBeenCalled()
  })

  it('服务器没配钥匙 → 500，不许当成「没配就放行」', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    expect(purgeCronRunLogsBatched).not.toHaveBeenCalled()
  })

  it('正常跑完：分批清理，删了多少行写进运行记录', async () => {
    purgeCronRunLogsBatched.mockResolvedValue({
      purged_noise: 12,
      purged_expired: 3,
      remaining: 31000,
      oldest_started_at: '2026-07-07T00:00:32.615874+00:00',
    })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ purged_noise: 12, purged_expired: 3, abandoned: 0 })

    expect(purgeCronRunLogsBatched).toHaveBeenCalled()
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

  it('清理抛错 → 500 且运行记录记成失败，不许静默当成功', async () => {
    purgeCronRunLogsBatched.mockRejectedValue(new Error('canceling statement due to statement timeout'))

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        failed: 1,
        error: 'canceling statement due to statement timeout',
      }),
    )
    expect(abandonStaleRunningRuns).not.toHaveBeenCalled()
  })

  it('时间预算内没删完 → 仍算成功，summary 带 remaining', async () => {
    purgeCronRunLogsBatched.mockResolvedValue({
      purged_noise: 5000,
      purged_expired: 0,
      remaining: 97853,
      oldest_started_at: '2026-07-07T00:00:32.615874+00:00',
      stopped_early: true,
      stop_reason: 'time_budget',
    })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(200)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        failed: 0,
        summary: expect.objectContaining({ stopped_early: true, remaining: 97853 }),
      }),
    )
  })

  it('收掉过期的 running 行，并把条数写进运行记录', async () => {
    purgeCronRunLogsBatched.mockResolvedValue({
      purged_noise: 1,
      purged_expired: 0,
      remaining: 10,
      oldest_started_at: null,
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
    purgeCronRunLogsBatched.mockResolvedValue({
      purged_noise: 1,
      purged_expired: 0,
      remaining: 10,
      oldest_started_at: null,
    })
    vi.mocked(abandonStaleRunningRuns).mockResolvedValue({ abandoned: 0, error: 'update failed' })

    const res = await GET(makeReq('Bearer test-secret-123'))
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, error: 'update failed' }),
    )
  })
})

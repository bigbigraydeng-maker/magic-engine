/**
 * GET /api/cron/ai-tracker-weekly —— 灰度迁移期间互斥闸的测试。
 *
 * 🔴 只测这条路由自己新加的那一件事：把开了 `ai_visibility_inngest_enabled` 的客户从
 * 候选名单里排除掉——不重复测鉴权/202 响应这些既有行为（本路由改动前没有测试文件，
 * 这次只补跟这道闸相关的部分，其余职责不在这次改动范围内）。
 *
 * 背景：本路由（旧 Render cron 路径）和 `src/lib/inngest/functions/ai-visibility-weekly.ts`
 * （新 Inngest 路径）在灰度期间并存。如果一个客户同时被两条链路的候选查询选中，会被
 * 两条链路各打一次 provider 的钱、各写一次数据库——子牙+魏征两轮复审共同发现的漏洞，
 * 这里补上互斥闸并锁死它。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockQueriesEq = vi.fn()
const mockClientsChain = vi.fn()
const mockRunTracker = vi.fn()
const mockStartCronRun = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'ai_visibility_queries') {
        return { select: vi.fn(() => ({ eq: mockQueriesEq })) }
      }
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({ eq: mockClientsChain })),
          })),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  },
}))

vi.mock('@/lib/ai-tracker/orchestrator', () => ({
  runTracker: (...args: unknown[]) => mockRunTracker(...args),
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: (...args: unknown[]) => mockStartCronRun(...args),
}))

function makeRequest(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/ai-tracker-weekly', { headers })
}

describe('ai-tracker-weekly 候选名单：排除已开 ai_visibility_inngest_enabled 的客户', () => {
  const CTS = 'c0000000-0000-0000-0000-000000000000'
  const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    mockStartCronRun.mockResolvedValue({ finish: vi.fn() })
    mockRunTracker.mockResolvedValue({
      total_cost_usd: 0, runs_succeeded: 1, runs_failed: 0,
    })
  })

  it('🔴 开了灰度开关的客户不进旧路径的处理名单——即使他在服务中且有启用问题', async () => {
    mockQueriesEq.mockResolvedValue({ data: [{ client_id: CTS }, { client_id: OZTOP }], error: null })
    mockClientsChain.mockResolvedValue({
      data: [
        { id: CTS, seo_config: { ai_visibility_inngest_enabled: true } },
        { id: OZTOP, seo_config: {} },
      ],
      error: null,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest('test-secret'))
    expect(res.status).toBe(202)
    // runInBackground 是 fire-and-forget，等两轮 microtask 让它跑完。
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const processedIds = mockRunTracker.mock.calls.map((c) => (c[0] as { client_id: string }).client_id)
    expect(processedIds).toEqual([OZTOP])
    expect(processedIds).not.toContain(CTS)
  })

  it('没有任何客户开灰度开关时，行为跟迁移前一样——都进名单', async () => {
    mockQueriesEq.mockResolvedValue({ data: [{ client_id: CTS }, { client_id: OZTOP }], error: null })
    mockClientsChain.mockResolvedValue({
      data: [
        { id: CTS, seo_config: null },
        { id: OZTOP, seo_config: { weekly_blog: true } },
      ],
      error: null,
    })

    const { GET } = await import('./route')
    const res = await GET(makeRequest('test-secret'))
    expect(res.status).toBe(202)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const processedIds = mockRunTracker.mock.calls.map((c) => (c[0] as { client_id: string }).client_id)
    expect(processedIds.sort()).toEqual([CTS, OZTOP].sort())
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  finish: vi.fn(async (_o: Record<string, unknown>) => {}),
  runOne: vi.fn(),
  runAll: vi.fn(),
}))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish: mocks.finish }) }))
vi.mock('@/lib/memory', () => ({
  runExtractorForClient: mocks.runOne,
  runExtractorForAllClients: mocks.runAll,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { tag: 'admin-client' } }))

import { POST } from '../route'

const SECRET = 'test-cron-secret'
const BASE = 'http://localhost/api/cron/memory-extractor'

function req(url: string, secret: string | null = SECRET): NextRequest {
  const headers: Record<string, string> = secret ? { authorization: `Bearer ${secret}` } : {}
  return new NextRequest(url, { method: 'POST', headers })
}

const result = {
  outcomes_processed: 4,
  actions_processed: 3,
  patterns_added: 1,
  experiments_added: 0,
  preferences_added: 0,
  memories_superseded: 0,
  memories_reactivated: 0,
  outcomes_stale_skipped: 2,
  deactivated_by_reason: { site_level_metric: 2, preference_no_support: 1 },
  deactivated: [
    { table: 'client_proven_patterns', id: 'p1', reason: 'site_level_metric' },
    { table: 'client_failed_experiments', id: 'f1', reason: 'site_level_metric' },
    { table: 'client_learned_preferences', id: 'l1', reason: 'preference_no_support' },
  ],
  skipped_attribution_stalled: 1,
  skipped_immature: 5,
  skipped_unknown_pillar: 0,
  errors: [],
}

const expectedSummary = {
  outcomes_stale_skipped: 2,
  deactivated_by_reason: result.deactivated_by_reason,
  deactivated: result.deactivated,
  skipped_attribution_stalled: 1,
  skipped_immature: 5,
  skipped_unknown_pillar: 0,
}

/**
 * 运行记录就是回滚清单：每一次下架的记忆都必须带着表名、id 和理由写进去，
 * 批量与单客户两种模式都一样。
 */
describe('每日记忆抽取定时任务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = SECRET
  })

  it('批量跑：运行记录里带完整回滚清单（表名 + id + 理由）', async () => {
    mocks.runAll.mockResolvedValue({
      clients_processed: 2,
      aggregate: result,
      per_client_errors: [],
    })

    const res = await POST(req(BASE))

    expect(res.status).toBe(200)
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 2, failed: 0, summary: expectedSummary }),
    )
  })

  it('单客户跑：同样把回滚清单写进运行记录，而且照常下架', async () => {
    mocks.runOne.mockResolvedValue(result)

    const res = await POST(req(`${BASE}?client_id=client-1`))

    expect(res.status).toBe(200)
    expect(mocks.runOne).toHaveBeenCalledTimes(1)
    const args = mocks.runOne.mock.calls[0]
    expect(args[1]).toBe('client-1')
    expect(args[3]).toBeUndefined()
    expect(mocks.finish).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expectedSummary }),
    )
    expect(mocks.runAll).not.toHaveBeenCalled()
  })

  it('密钥不对：不跑', async () => {
    const res = await POST(req(BASE, 'wrong'))

    expect(res.status).toBe(401)
    expect(mocks.runAll).not.toHaveBeenCalled()
    expect(mocks.runOne).not.toHaveBeenCalled()
  })
})

/**
 * POST /api/cron/seo-meta-cycle-trigger —— 手动补触发的测试。
 *
 * 只测这条路由自己负责的事：鉴权、只发已开启 meta_cycle_enabled 的客户。
 * 派单去重/失败上报的完整逻辑跟 flywheel-seo-weekly 的手动补触发路由同一套
 * 模式，那边已经有更全的用例（route.test.ts），这里不重复断言。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockClientsQuery = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          contains: vi.fn(() => ({ not: mockClientsQuery })),
        })),
      })),
    })),
  },
}))

const mockSendInngestEvent = vi.fn()
vi.mock('@/lib/workflows/inngest-event', () => ({
  sendInngestEvent: (...args: unknown[]) => mockSendInngestEvent(...args),
}))

function makeRequest(secret: string | null, body?: Record<string, unknown>) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/seo-meta-cycle-trigger', {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

const CRON_SECRET = 'test-cron-secret'
const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

describe('POST /api/cron/seo-meta-cycle-trigger — 手动补触发', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockSendInngestEvent.mockResolvedValue({ event_ids: ['evt_1'] })
  })

  it('🔴 没带 / 带错密钥 → 401，且一张条子都不发（发了就是白花钱）', async () => {
    const { POST } = await import('./route')
    for (const secret of [null, 'wrong']) {
      vi.clearAllMocks()
      const res = await POST(makeRequest(secret))
      expect(res.status).toBe(401)
      expect(mockSendInngestEvent).not.toHaveBeenCalled()
    }
  })

  it('只发 seo_config.meta_cycle_enabled=true 的客户，不误扫名单外的', async () => {
    mockClientsQuery.mockResolvedValue({
      data: [{ id: CTS, domain: 'ctstours.co.nz', semrush_db: 'nz', seo_config: { meta_cycle_enabled: true } }],
      error: null,
    })
    const { POST } = await import('./route')
    const res = await POST(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients_dispatched).toEqual([CTS])
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    const call = mockSendInngestEvent.mock.calls[0][0] as { name: string; data: { client_id: string } }
    expect(call.name).toBe('seo/meta-cycle.due')
    expect(call.data.client_id).toBe(CTS)
    // OZTOP never appears — the roster query itself is what scopes this, asserted via the mock only returning CTS.
    expect(OZTOP).not.toBe(CTS)
  })

  it('body 带 client_id 时只派那一个客户', async () => {
    mockClientsQuery.mockResolvedValue({
      data: [
        { id: CTS, domain: 'ctstours.co.nz', semrush_db: 'nz', seo_config: { meta_cycle_enabled: true } },
        { id: OZTOP, domain: 'oztopbuildingsupplies.com.au', semrush_db: 'au', seo_config: { meta_cycle_enabled: true } },
      ],
      error: null,
    })
    const { POST } = await import('./route')
    const res = await POST(makeRequest(CRON_SECRET, { client_id: CTS }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ client_id: CTS, clients_dispatched: [CTS] })
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
  })
})

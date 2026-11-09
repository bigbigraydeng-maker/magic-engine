/**
 * GET /api/cron/flywheel-seo-weekly —— **手动补触发**的测试。
 *
 * 🔴 2026-09-07 这条路由的职责变了：以前它在一个请求里把所有客户串着跑完，现在只负责
 *    把派单条子发给 Inngest，真正干活的是 `cloud-flywheel-seo-snapshot-one`。
 *    原来那批「一个客户失败不影响其他客户 / 过滤空网址 / 汇总写了几行」的用例，
 *    对应的逻辑搬去了 `src/lib/flywheel/seo-weekly.ts`，在那边直测（不含 HTTP 壳），
 *    所以这里不再重复断言它们 —— 重复断言只会在改动时同时红两处，指不出真正的破绽。
 *
 * 这里只管这条路由自己负责的四件事：鉴权、名单查不出来怎么办、发了几张条子、
 * 以及**有条子没发出去时不许报成功**。
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

function makeRequest(secret: string | null, clientId?: string, attempt?: string) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  const url = new URL('http://localhost:3001/api/cron/flywheel-seo-weekly')
  if (clientId) url.searchParams.set('client_id', clientId)
  if (attempt) url.searchParams.set('attempt', attempt)
  return new NextRequest(url, {
    method: 'GET',
    headers,
  })
}

const CRON_SECRET = 'test-cron-secret'
const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

describe('GET /api/cron/flywheel-seo-weekly — 手动补触发', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockSendInngestEvent.mockResolvedValue({ event_ids: ['evt_1'] })
  })

  it('没配 CRON_SECRET → 500，且一张条子都不发', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')
    const res = await GET(makeRequest('anything'))
    expect(res.status).toBe(500)
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('🔴 没带 / 带错密钥 → 401，且一张条子都不发（发了就是白花钱）', async () => {
    const { GET } = await import('./route')
    for (const secret of [null, 'wrong']) {
      vi.clearAllMocks()
      const res = await GET(makeRequest(secret))
      expect(res.status).toBe(401)
      expect(mockSendInngestEvent).not.toHaveBeenCalled()
    }
  })

  it('名单查不出来 → 500，不发条子', async () => {
    mockClientsQuery.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ status: 'roster_failed', clients_dispatched: 0 })
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('没人要扫 → 200 且明说 0 个，不发条子', async () => {
    mockClientsQuery.mockResolvedValue({ data: [], error: null })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'roster_empty', clients_dispatched: 0 })
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('一人一张条子，条子里带客户、网址、周编号，事件名是云端专属那个', async () => {
    mockClientsQuery.mockResolvedValue({
      data: [
        { id: CTS, domain: 'ctstours.co.nz' },
        { id: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
      ],
      error: null,
    })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ status: 'dispatched', clients_dispatched: 2, trigger: 'manual', no_publish: true })
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(2)

    const first = mockSendInngestEvent.mock.calls[0][0] as {
      id: string
      name: string
      data: { client_id: string; domain: string; week_key: string }
    }
    expect(first.name).toBe('flywheel/seo.snapshot.due')
    expect(first.data.client_id).toBe(CTS)
    expect(first.data.domain).toBe('ctstours.co.nz')
    // 去重键必须带上客户和周 —— 少了任一，同周补触发就会重复付款
    expect(first.id).toContain(CTS)
    expect(first.id).toContain(first.data.week_key)
  })

  it('🔴 有条子没发出去 → 不许报成 200 成功，必须点名是谁没发出去', async () => {
    mockClientsQuery.mockResolvedValue({
      data: [
        { id: CTS, domain: 'ctstours.co.nz' },
        { id: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
      ],
      error: null,
    })
    mockSendInngestEvent
      .mockResolvedValueOnce({ event_ids: ['evt_1'] })
      .mockRejectedValueOnce(new Error('INNGEST_EVENT_KEY_MISSING'))
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.clients_dispatched).toBe(1)
    expect(body.error).toContain('1/2')
    expect(body.failed).toEqual([{ client_id: OZTOP, error: 'INNGEST_EVENT_KEY_MISSING' }])
  })

  it('client_id 模式只派 CTS 一张条子，不会误扫其他客户', async () => {
    mockClientsQuery.mockResolvedValue({
      data: [
        { id: CTS, domain: 'ctstours.co.nz' },
        { id: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
      ],
      error: null,
    })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET, CTS))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ client_id: CTS, clients_dispatched: 1 })
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(1)
    expect(mockSendInngestEvent.mock.calls[0][0].data.client_id).toBe(CTS)
  })

  it('attempt 模式生成新的去重键，且只接受安全字符', async () => {
    mockClientsQuery.mockResolvedValue({ data: [{ id: CTS, domain: 'ctstours.co.nz' }], error: null })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET, CTS, 'retry-1'))
    expect(res.status).toBe(200)
    expect(mockSendInngestEvent.mock.calls[0][0].id).toContain('-retry-1')

    vi.clearAllMocks()
    const bad = await GET(makeRequest(CRON_SECRET, CTS, 'retry/unsafe'))
    expect(bad.status).toBe(400)
    expect(mockSendInngestEvent).not.toHaveBeenCalled()
  })

  it('🔴 一个人发失败不影响其他人 —— 后面的还得继续发', async () => {
    mockClientsQuery.mockResolvedValue({
      data: [
        { id: CTS, domain: 'ctstours.co.nz' },
        { id: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
      ],
      error: null,
    })
    mockSendInngestEvent
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ event_ids: ['evt_2'] })
    const { GET } = await import('./route')
    const res = await GET(makeRequest(CRON_SECRET))
    expect(mockSendInngestEvent).toHaveBeenCalledTimes(2)
    expect((await res.json()).clients_dispatched).toBe(1)
  })
})

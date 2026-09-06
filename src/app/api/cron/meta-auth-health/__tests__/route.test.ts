/**
 * Meta 授权体检 cron 路由。
 *
 * 判据本身在 `src/lib/meta/__tests__/auth-health.test.ts` 单测过，这里守路由层
 * 那几件真出过事的：
 *
 * - 鉴权契约（密钥没配 → 500；带错 → 401，且一次 Meta 都不许问）
 * - **客户名单读不出来 ≠ 一个客户都没有** —— 混成一路的话，一次读库失败会显示成
 *   「今天所有客户的授权都好」，正是这个功能要消灭的假象
 * - **运行记录必须收尾**：抛出去的话那行会永远停在「在跑」，健康检查分不清
 *   「崩了」和「还在跑」，这条通道会静默死掉
 * - 一个客户炸了不许带崩整趟，但也绝不许当成这个客户没问题（fail-closed）
 * - 主页 ID 必须按 client_id 一一对上，绝不串台
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const finish = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(() => Promise.resolve({ finish })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/pm-todo/client-roster', () => ({ loadActiveClients: vi.fn() }))
vi.mock('@/lib/supabase-paginate', () => ({ fetchAll: vi.fn() }))
vi.mock('@/lib/meta/auth-health', () => ({
  checkMetaAuth: vi.fn(),
  needsHuman: (h: { state: string }) => h.state !== 'ok' && h.state !== 'no_page',
  META_AUTH_HEALTH_JOB: 'meta-auth-health',
}))

import { GET } from '../route'
import { loadActiveClients } from '@/lib/pm-todo/client-roster'
import { fetchAll } from '@/lib/supabase-paginate'
import { checkMetaAuth } from '@/lib/meta/auth-health'

const mockRoster = vi.mocked(loadActiveClients)
const mockFetchAll = vi.mocked(fetchAll)
const mockCheck = vi.mocked(checkMetaAuth)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CTS_PAGE = '1616575215312482'
const OZTOP_PAGE = '748077268383005'

function req(headers: Record<string, string> = { authorization: 'Bearer test-secret' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/meta-auth-health', { method: 'GET', headers })
}

function health(clientId: string, state: string, pageId: string | null = null) {
  return {
    client_id: clientId,
    page_id: pageId,
    state,
    token_source: 'stored_connection',
    granted_scopes: [],
    missing_scopes: [],
    connection_status: 'active',
    provider_error: null,
    checked_at: '2026-09-04T07:00:00Z',
  } as never
}

/** 两个客户、各自一个主页 —— 用来验不串台。 */
function twoClients() {
  mockRoster.mockResolvedValue({
    clients: new Map([
      [CTS, { id: CTS, name: 'CTS Tours NZ', domain: 'ctstours.co.nz' }],
      [OZTOP, { id: OZTOP, name: 'Oztop', domain: 'oztop.com.au' }],
    ]),
    error: null,
  } as never)
  mockFetchAll.mockResolvedValue([
    { id: CTS, facebook_page_id: CTS_PAGE },
    { id: OZTOP, facebook_page_id: OZTOP_PAGE },
  ] as never)
}

function summaryOf(): Record<string, unknown> {
  return finish.mock.calls[0][0].summary as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
})

describe('鉴权', () => {
  it('密钥没配 → 500，一个客户都不查', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/CRON_SECRET/)
    expect(mockRoster).not.toHaveBeenCalled()
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('没带 Authorization → 401', async () => {
    const res = await GET(req({}))
    expect(res.status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('密钥不对 → 401', async () => {
    const res = await GET(req({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
  })
})

describe('🔴 名单读不出来 ≠ 一个客户都没有', () => {
  it('读库失败 → 500，并把原因写进运行记录，绝不记成健康的一趟', async () => {
    mockRoster.mockResolvedValue({ clients: new Map(), error: { message: 'connection refused' } } as never)
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, error: expect.stringContaining('读不出客户名单') }),
    )
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('真的一个活跃客户都没有 → 安静的一趟，记成 0 而不是失败', async () => {
    mockRoster.mockResolvedValue({ clients: new Map(), error: null } as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 0, failed: 0 }))
    expect(finish.mock.calls[0][0].error).toBeUndefined()
  })
})

describe('体检与记账', () => {
  it('每个客户用自己的主页 ID —— 绝不串台', async () => {
    twoClients()
    mockCheck.mockImplementation(async (_sb, input: { clientId: string; pageId: string | null }) =>
      health(input.clientId, 'ok', input.pageId),
    )

    await GET(req())

    const calls = mockCheck.mock.calls.map((c) => c[1] as { clientId: string; pageId: string | null; domain: string | null })
    expect(calls).toEqual([
      { clientId: CTS, pageId: CTS_PAGE, domain: 'ctstours.co.nz' },
      { clientId: OZTOP, pageId: OZTOP_PAGE, domain: 'oztop.com.au' },
    ])
  })

  it('没登记主页的客户不算进「检查过」，也不算问题', async () => {
    mockRoster.mockResolvedValue({
      clients: new Map([[CTS, { id: CTS, name: 'CTS', domain: 'ctstours.co.nz' }]]),
      error: null,
    } as never)
    mockFetchAll.mockResolvedValue([{ id: CTS, facebook_page_id: null }] as never)
    mockCheck.mockResolvedValue(health(CTS, 'no_page'))

    const res = await GET(req())
    const body = await res.json()
    expect(body.checked).toBe(0)
    expect(body.problems).toBe(0)
    expect(summaryOf().checked).toBe(0)
  })

  it('坏掉的客户记成 failed，并把整份结果写进 summary 供待办读取', async () => {
    twoClients()
    mockCheck
      .mockResolvedValueOnce(health(CTS, 'rejected', CTS_PAGE))
      .mockResolvedValueOnce(health(OZTOP, 'ok', OZTOP_PAGE))

    const res = await GET(req())
    const body = await res.json()
    expect(body.problems).toBe(1)
    const summary = summaryOf()
    expect(summary.ok).toBe(1)
    expect(summary.problems).toBe(1)
    expect((summary.results as unknown[]).length).toBe(2)
    expect(finish.mock.calls[0][0].failed).toBe(1)
  })

  it('🔴 问不到状态的要单独记一句 —— 「零个问题」和「问不到所以看不见问题」在监控上必须不一样', async () => {
    twoClients()
    mockCheck
      .mockResolvedValueOnce(health(CTS, 'unknown', CTS_PAGE))
      .mockResolvedValueOnce(health(OZTOP, 'ok', OZTOP_PAGE))

    const res = await GET(req())
    expect((await res.json()).unknown).toBe(1)
    expect(finish.mock.calls[0][0].error).toContain('问不出状态')
  })

  it('全好的时候不写 error', async () => {
    twoClients()
    mockCheck.mockResolvedValue(health(CTS, 'ok', CTS_PAGE))
    await GET(req())
    expect(finish.mock.calls[0][0].error).toBeUndefined()
  })

  it('🔴 一个客户炸了不带崩整趟，但也不许当成这个客户没问题', async () => {
    twoClients()
    mockCheck
      .mockRejectedValueOnce(new Error('decrypt failed'))
      .mockResolvedValueOnce(health(OZTOP, 'ok', OZTOP_PAGE))

    const res = await GET(req())
    expect(res.status).toBe(200)
    const results = summaryOf().results as Array<{ client_id: string; state: string; provider_error: string }>
    const cts = results.find((r) => r.client_id === CTS)!
    expect(cts.state).toBe('unknown')
    expect(cts.provider_error).toContain('decrypt failed')
    expect((await res.json()).problems).toBe(1)
  })

  it('🔴 整趟炸了也必须收尾运行记录 —— 否则那行永远停在「在跑」', async () => {
    mockRoster.mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, error: expect.stringContaining('boom') }),
    )
  })

  it('主页表读挂了也算整趟失败，不许静默跳过体检', async () => {
    mockRoster.mockResolvedValue({
      clients: new Map([[CTS, { id: CTS, name: 'CTS', domain: null }]]),
      error: null,
    } as never)
    mockFetchAll.mockRejectedValue(new Error('range error'))

    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
    expect(mockCheck).not.toHaveBeenCalled()
  })
})

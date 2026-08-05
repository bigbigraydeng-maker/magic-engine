/**
 * 这个接口喂的是导航里的 Billing Monitor 页面，PM 随时点得到。
 *
 * 🔴 它曾经在查不到数据时返回一段写死的假账单（DataForSEO $150.00 / 2500 calls、
 *    编造的 client-001 / client-002、编造的月份），并且把两个查询各包了一个空
 *    catch —— 数据库真出错也会落到同一段假数字上。而实际累计花费约 $153，
 *    那个编出来的 $150.00 恰好看着就像真的，所以没人会去质疑它。
 *
 *    下面的用例锁的是同一件事的两面：**没有数据要显示成没有数据；
 *    查询失败要报失败** —— 两者都不许变成好看的数字。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: vi.fn(async () => null), // null = 放行
}))

const mockGetBillingByMonth = vi.fn()
const mockGetCostsByService = vi.fn()
const mockGetAvailableMonths = vi.fn()

vi.mock('@/lib/billing/usage-tracker', () => ({
  getBillingByMonth: (...a: unknown[]) => mockGetBillingByMonth(...a),
  getCostsByService: (...a: unknown[]) => mockGetCostsByService(...a),
  getAvailableMonths: (...a: unknown[]) => mockGetAvailableMonths(...a),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}))

import { GET } from '../route'
import { NextRequest } from 'next/server'

function req(url: string): NextRequest {
  return new NextRequest(new Request(url))
}

const URL_BASE = 'https://app.magicengine.com.au/api/admin/billing/datasources'

describe('GET /api/admin/billing/datasources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAvailableMonths.mockResolvedValue([])
    mockGetBillingByMonth.mockResolvedValue([])
    mockGetCostsByService.mockResolvedValue({})
  })

  it('🔴 账本是空的 → 全部报 0，绝不端出样例数据', async () => {
    const res = await GET(req(`${URL_BASE}?month=2026-08`))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalCost).toBe(0)
    expect(body.totalApiCalls).toBe(0)
    expect(body.byClient).toEqual([])
    expect(body.costsByService).toEqual({})

    // 那几个假数字一个都不许出现
    const asText = JSON.stringify(body)
    expect(asText).not.toContain('150')
    expect(asText).not.toContain('85.5')
    expect(asText).not.toContain('client-001')
  })

  it('🔴 数据库查询失败 → 报错，不许静默变成数字', async () => {
    mockGetBillingByMonth.mockRejectedValue(new Error('relation does not exist'))

    const res = await GET(req(`${URL_BASE}?month=2026-08`))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain('relation does not exist')
    expect(body.totalCost).toBeUndefined()
  })

  // 两个查询各测一遍：原来是**每个**都单独包了一个空 catch，
  // 只测其中一个，另一个被吞掉照样测不出来。
  it('🔴 按服务汇总那次查询失败 → 同样必须报错', async () => {
    mockGetCostsByService.mockRejectedValue(new Error('costsByService boom'))

    const res = await GET(req(`${URL_BASE}?month=2026-08`))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain('costsByService boom')
  })

  it('🔴 没有任何月份有花费 → 返回空列表，不许编月份出来填下拉框', async () => {
    const res = await GET(req(URL_BASE))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.availableMonths).toEqual([])
  })

  it('有真实数据时如实汇总', async () => {
    mockGetBillingByMonth.mockResolvedValue([
      { client_id: 'c1', service: 'dataforseo', api_calls: 10, cost_usd: 1.5, month: '2026-08' },
      { client_id: 'c2', service: 'dataforseo', api_calls: 4, cost_usd: 0.25, month: '2026-08' },
    ])
    mockGetCostsByService.mockResolvedValue({ dataforseo: 1.75 })

    const res = await GET(req(`${URL_BASE}?month=2026-08`))
    const body = await res.json()

    expect(body.totalCost).toBeCloseTo(1.75)
    expect(body.totalApiCalls).toBe(14)
    expect(body.byClient).toHaveLength(2)
    expect(body.byClient[0]).toEqual({
      clientId: 'c1',
      service: 'dataforseo',
      apiCalls: 10,
      costUsd: 1.5,
    })
  })

  it('月份格式不对时拒绝，不去查库', async () => {
    const res = await GET(req(`${URL_BASE}?month=August`))
    expect(res.status).toBe(400)
    expect(mockGetBillingByMonth).not.toHaveBeenCalled()
  })
})

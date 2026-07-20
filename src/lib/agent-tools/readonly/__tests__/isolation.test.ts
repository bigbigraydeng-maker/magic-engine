/**
 * 🔴 只读工具集 — 跨客户资源隔离测试（狄仁杰硬阻塞条款 E · spec §3.3）
 *
 * 核心断言：即便 Claude 在工具 input 里**伪造**了别客户的资源标识符
 * （client_id / domain / site_url / property_id），handler 也**只用服务端 ctx.***
 * 去调底层函数。每个断言同时是变异测试：若 handler 改用 input.* 泄漏，断言必 fail。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/dataforseo/labs', () => ({ getKeywordsForSite: vi.fn() }))
vi.mock('@/lib/gsc/client', () => ({ fetchGscSnapshot: vi.fn() }))
vi.mock('@/lib/ga4/client', () => ({ fetchGa4Snapshot: vi.fn() }))
vi.mock('@/lib/case-library/outcome-confidence', () => ({ fetchClientOutcomeHistory: vi.fn() }))

import { getKeywordsForSite } from '@/lib/dataforseo/labs'
import { fetchGscSnapshot } from '@/lib/gsc/client'
import { fetchGa4Snapshot } from '@/lib/ga4/client'
import { fetchClientOutcomeHistory } from '@/lib/case-library/outcome-confidence'

import { queryKeywordDetail } from '../keyword-detail'
import { querySearchConsole } from '../search-console'
import { queryAnalytics } from '../analytics'
import { queryFlywheelHistory } from '../flywheel-history'
import type { ReadonlyToolContext } from '../types'

const mockKeywords = vi.mocked(getKeywordsForSite)
const mockGsc = vi.mocked(fetchGscSnapshot)
const mockGa4 = vi.mocked(fetchGa4Snapshot)
const mockOutcome = vi.mocked(fetchClientOutcomeHistory)

// 本客户真实身份（ctx 服务端注入）
const REAL: ReadonlyToolContext = {
  clientId: 'client-REAL',
  domain: 'realclient.com.au',
  siteUrl: 'https://realclient.com.au/',
  propertyId: 'properties/111',
  supabase: { __marker: 'real-supabase' } as unknown as ReadonlyToolContext['supabase'],
  market: 'AU',
}

// 攻击者试图通过工具 input 注入的别客户资源标识符
const FORGED = {
  client_id: 'client-VICTIM',
  clientId: 'client-VICTIM',
  domain: 'victim-competitor.com',
  target: 'victim-competitor.com',
  site_url: 'https://victim-competitor.com/',
  siteUrl: 'https://victim-competitor.com/',
  property_id: 'properties/999',
  propertyId: 'properties/999',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('query_keyword_detail — domain 越权轴锁死', () => {
  it('伪造 domain/target 入参被忽略，只用 ctx.domain', async () => {
    mockKeywords.mockResolvedValue([
      { keyword: 'k', search_volume: 10, keyword_difficulty: 5, cpc: 0, competition: 0, intent: 'informational' },
    ])
    await queryKeywordDetail.handler({ ...FORGED, limit: 5 }, REAL)
    // 🔴 变异守卫：若 handler 用了 input.domain，这里会是 victim-competitor.com → fail
    expect(mockKeywords).toHaveBeenCalledWith('realclient.com.au', 2036, 5)
    expect(mockKeywords).not.toHaveBeenCalledWith('victim-competitor.com', expect.anything(), expect.anything())
  })

  it('NZ 市场用 2554 地域码', async () => {
    mockKeywords.mockResolvedValue([])
    await queryKeywordDetail.handler({ limit: 3 }, { ...REAL, market: 'NZ' })
    expect(mockKeywords).toHaveBeenCalledWith('realclient.com.au', 2554, 3)
  })
})

describe('query_search_console — siteUrl + clientId 越权轴锁死', () => {
  it('伪造 site_url/client_id 入参被忽略，只用 ctx.siteUrl + ctx.clientId', async () => {
    mockGsc.mockResolvedValue({
      site_url: REAL.siteUrl!, period_start: '2026-06-01', period_end: '2026-06-28',
      total_clicks: 100, total_impressions: 1000, avg_ctr: 0.1, avg_position: 5,
      top_queries: [], top_pages: [], synced_at: '2026-06-28T00:00:00Z',
    })
    await querySearchConsole.handler({ ...FORGED, range_days: 14 }, REAL)
    // 🔴 两个资源轴都必须是 ctx 的值
    expect(mockGsc).toHaveBeenCalledWith('https://realclient.com.au/', 'client-REAL', 14)
    expect(mockGsc).not.toHaveBeenCalledWith(
      'https://victim-competitor.com/', expect.anything(), expect.anything(),
    )
  })

  it('本客户无 GSC connector（ctx.siteUrl=null）→ 返回错误，绝不 fallback 查别站', async () => {
    const out = await querySearchConsole.handler({ site_url: FORGED.site_url }, { ...REAL, siteUrl: null })
    expect(mockGsc).not.toHaveBeenCalled()
    expect(out).toContain('not configured')
  })
})

describe('query_analytics — propertyId + clientId 越权轴锁死', () => {
  it('伪造 property_id 入参被忽略，只用 ctx.propertyId + ctx.clientId', async () => {
    mockGa4.mockResolvedValue({
      property_id: REAL.propertyId!, period_start: '2026-06-01', period_end: '2026-06-28',
      total_sessions: 10, total_users: 8, total_new_users: 5, total_pageviews: 40,
      avg_session_duration: 60, bounce_rate: 0.4, top_pages: [], top_sources: [], synced_at: '2026-06-28T00:00:00Z',
    })
    await queryAnalytics.handler({ ...FORGED, range_days: 30 }, REAL)
    expect(mockGa4).toHaveBeenCalledWith('properties/111', 'client-REAL', 30)
    expect(mockGa4).not.toHaveBeenCalledWith('properties/999', expect.anything(), expect.anything())
  })
})

describe('query_flywheel_history — clientId 越权轴锁死', () => {
  it('伪造 client_id 入参被忽略，只用 ctx.clientId + ctx.supabase', async () => {
    mockOutcome.mockResolvedValue({ 'seo.publish_blog': { successRate: 0.5, sampleSize: 4 } })
    await queryFlywheelHistory.handler({ ...FORGED, flywheel: 'seo' }, REAL)
    // 🔴 clientId + supabase 都必须是 ctx 的；filters 里绝不含 client_id
    expect(mockOutcome).toHaveBeenCalledWith(REAL.supabase, 'client-REAL', { flywheel: 'seo' })
    const callArgs = mockOutcome.mock.calls[0]
    expect(callArgs[1]).toBe('client-REAL')
    expect(callArgs[1]).not.toBe('client-VICTIM')
  })
})

describe('input_schema 零资源标识符（闸 1）', () => {
  const FORBIDDEN = ['client_id', 'clientId', 'domain', 'target', 'site_url', 'siteUrl', 'property_id', 'propertyId']
  const modules = [queryKeywordDetail, querySearchConsole, queryAnalytics, queryFlywheelHistory]

  it.each(modules.map(m => [m.tool.name, m] as const))(
    '%s 的 input_schema 不暴露任何资源标识符字段',
    (_name, mod) => {
      const props = (mod.tool.input_schema as { properties?: Record<string, unknown> }).properties ?? {}
      for (const key of Object.keys(props)) {
        expect(FORBIDDEN).not.toContain(key)
      }
    },
  )
})

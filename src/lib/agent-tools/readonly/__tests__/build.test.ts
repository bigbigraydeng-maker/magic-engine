/**
 * buildReadonlyTools — 工厂：由 clientId 反查 client_connectors.config 组
 * siteUrl / propertyId 并锁进 ctx（条款 B），+ summariseToolTrace（条款 D）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/dataforseo/labs', () => ({ getKeywordsForSite: vi.fn(async () => []) }))
vi.mock('@/lib/gsc/client', () => ({ fetchGscSnapshot: vi.fn(async () => null) }))
vi.mock('@/lib/ga4/client', () => ({ fetchGa4Snapshot: vi.fn(async () => null) }))
vi.mock('@/lib/case-library/outcome-confidence', () => ({ fetchClientOutcomeHistory: vi.fn(async () => ({})) }))

import { fetchGscSnapshot } from '@/lib/gsc/client'
import { fetchGa4Snapshot } from '@/lib/ga4/client'
import { buildReadonlyTools, summariseToolTrace } from '../index'

const mockGsc = vi.mocked(fetchGscSnapshot)
const mockGa4 = vi.mocked(fetchGa4Snapshot)

/** Fake supabase whose client_connectors lookup returns per-anchor rows. */
function fakeSupabase(rows: Record<string, { status: string; config: Record<string, unknown> } | null>) {
  return {
    from: () => {
      let anchor = ''
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (col: string, val: string) => { if (col === 'anchor') anchor = val; return q },
        maybeSingle: async () => ({ data: rows[anchor] ?? null, error: null }),
      }
      return q
    },
  } as unknown as Parameters<typeof buildReadonlyTools>[0]['supabase']
}

beforeEach(() => vi.clearAllMocks())

describe('buildReadonlyTools 资源身份解析', () => {
  it('从 connected connector 解析 siteUrl/propertyId 并锁进 handler', async () => {
    const supabase = fakeSupabase({
      gsc: { status: 'connected', config: { site_url: 'https://resolved.com.au/' } },
      ga4: { status: 'connected', config: { property_id: 'properties/777' } },
    })
    const { tools, handlers } = await buildReadonlyTools({
      clientId: 'client-A', domain: 'resolved.com.au', supabase, market: 'AU',
    })

    expect(tools.map(t => t.name).sort()).toEqual(
      ['query_analytics', 'query_flywheel_history', 'query_keyword_detail', 'query_search_console'],
    )

    // handler 用的是**解析出来的** siteUrl/propertyId，Claude 无从指定
    await handlers['query_search_console']({ range_days: 28 })
    expect(mockGsc).toHaveBeenCalledWith('https://resolved.com.au/', 'client-A', 28)

    await handlers['query_analytics']({ range_days: 28 })
    expect(mockGa4).toHaveBeenCalledWith('properties/777', 'client-A', 28)
  })

  it('connector 未 connected → siteUrl 解析为 null → 工具拒查，绝不 fallback', async () => {
    const supabase = fakeSupabase({
      gsc: { status: 'pending', config: { site_url: 'https://should-not-use.com/' } },
      ga4: null,
    })
    const { handlers } = await buildReadonlyTools({
      clientId: 'client-B', domain: 'b.com', supabase, market: 'AU',
    })
    const out = await handlers['query_search_console']({})
    expect(mockGsc).not.toHaveBeenCalled()
    expect(out).toContain('not configured')
  })

  it('DB 出错时静默解析为 null（不抛，不阻塞 conductor）', async () => {
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
      }),
    } as unknown as Parameters<typeof buildReadonlyTools>[0]['supabase']
    const { handlers } = await buildReadonlyTools({
      clientId: 'client-C', domain: 'c.com', supabase, market: 'AU',
    })
    const out = await handlers['query_analytics']({})
    expect(out).toContain('not configured')
  })
})

describe('summariseToolTrace（条款 D — 不落原始 result 全文）', () => {
  it('长 result 截成摘要，保留 name/input/is_error', () => {
    const trace = summariseToolTrace([
      { name: 'query_search_console', input: { range_days: 28 }, result: 'x'.repeat(5000), is_error: false },
    ], 200)
    expect(trace[0].name).toBe('query_search_console')
    expect(trace[0].input).toEqual({ range_days: 28 })
    expect(trace[0].summary.length).toBeLessThanOrEqual(201) // 200 + ellipsis
    expect(trace[0].summary).not.toHaveLength(5000)
    expect(trace[0].is_error).toBe(false)
    // 摘要里没有 "result" 原始全文字段
    expect(JSON.stringify(trace[0])).not.toContain('x'.repeat(5000))
  })
})

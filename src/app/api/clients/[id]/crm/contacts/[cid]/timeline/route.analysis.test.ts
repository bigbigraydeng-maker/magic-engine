/** 电话触点上挂的 AI 分析：读出来给销售看，且必须按 client_id 收口。 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a' })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const analysisQuery: { eqs: Array<[string, unknown]>; ids: unknown[] } = { eqs: [], ids: [] }

function mockDb(touchMeta: Record<string, unknown>) {
  analysisQuery.eqs = []
  analysisQuery.ids = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'c1', display_name: 'X', primary_phone: null, primary_email: null, stage: null }, error: null }) }) }) }) }
    }
    if (table === 'contact_touchpoints') {
      const data = [{ channel: 'phone', direction: 'inbound', occurred_at: '2026-10-12T00:00:00Z', summary: '通话', raw: null, metadata: touchMeta }]
      return { select: () => ({ eq: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: async () => ({ data, error: null }) }) }), order: () => ({ limit: async () => ({ data, error: null }) }) }) }) }) }
    }
    if (table === 'contact_stage_events') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }
    if (table === 'client_pipeline_stages') return { select: () => ({ eq: async () => ({ data: [] }) }) }
    if (table === 'conversations') return { select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }
    if (table === 'telephony_call_analyses') {
      return {
        select: () => ({
          eq: (col: string, v: unknown) => {
            analysisQuery.eqs.push([col, v])
            return {
              in: async (_c: string, ids: unknown[]) => {
                analysisQuery.ids = ids
                return {
                  data: [
                    { id: 'an-1', summary: '客人问中国团', review_status: 'weird', facts: [{ key: 'party_size', value: '4', quote: 'family of four' }, { key: 'bad' }, null] },
                  ],
                }
              },
            }
          },
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const call = () => GET(new NextRequest('http://localhost:3001/x'), { params: { id: 'client-a', cid: 'c1' } })

beforeEach(() => vi.clearAllMocks())

describe('时间线里的通话分析', () => {
  it('把分析挂到对应电话触点上，只带合格的事实，未知状态按待复核', async () => {
    mockDb({ call_analysis_id: 'an-1' })
    const body = await (await call()).json()
    const touch = body.timeline.find((e: { kind: string }) => e.kind === 'touch')
    expect(touch.callAnalysis).toEqual({
      id: 'an-1',
      summary: '客人问中国团',
      reviewStatus: 'pending_review',
      facts: [{ key: 'party_size', value: '4', quote: 'family of four' }],
    })
  })

  it('按 client_id 收口查询分析', async () => {
    mockDb({ call_analysis_id: 'an-1' })
    await call()
    expect(analysisQuery.eqs).toContainEqual(['client_id', 'client-a'])
    expect(analysisQuery.ids).toEqual(['an-1'])
  })

  it('触点没有分析编号时不查分析表，也不带 callAnalysis', async () => {
    mockDb({})
    const body = await (await call()).json()
    const touch = body.timeline.find((e: { kind: string }) => e.kind === 'touch')
    expect(touch.callAnalysis).toBeUndefined()
    expect(analysisQuery.ids).toEqual([])
  })
})

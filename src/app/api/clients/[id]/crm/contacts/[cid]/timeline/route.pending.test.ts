/** 刚拨出、还没整理成正式记录的外呼：页面要能立刻看到「打过了」。 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a' })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

let lastCandidates: string[] = []

interface World {
  initiated: Array<{ provider_call_id: string; received_at: string }>
  completedIds: string[]
  calls: Array<{ provider_call_id: string; crm_status: string }>
}

function mockDb(w: World, phone = '021 000 0001') {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contacts') {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'c1', display_name: 'X', primary_phone: phone, primary_email: null, stage: null }, error: null }) }) }) }) }
    }
    if (table === 'contact_touchpoints') return { select: () => ({ eq: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }), order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }
    if (table === 'contact_stage_events') return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }
    if (table === 'client_pipeline_stages') return { select: () => ({ eq: async () => ({ data: [] }) }) }
    if (table === 'conversations') return { select: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }
    if (table === 'telephony_calls') return { select: () => ({ eq: () => ({ in: async () => ({ data: w.calls }) }) }) }
    if (table === 'telephony_raw_events') {
      let rawType = ''
      const eqs: Array<[string, unknown]> = []
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = (col: string, v: unknown) => {
        eqs.push([col, v])
        if (col === 'raw_type') rawType = String(v)
        return c
      }
      c.gte = () => c
      c.in = (col: string, vals: unknown) => {
        eqs.push([col, vals])
        return c
      }
      c.then = (res: (v: unknown) => unknown) => {
        const data = rawType === 'twilio_status_initiated' ? w.initiated : w.completedIds.map((id) => ({ provider_call_id: id }))
        // 号码必须是认出来的标准格式，且只看外呼方向
        if (rawType === 'twilio_status_initiated') {
          lastCandidates = eqs.find((e) => e[0] === 'normalised->>counterpartyNumber')?.[1] as string[]
          expect(eqs).toContainEqual(['normalised->>direction', 'outbound'])
          expect(eqs).toContainEqual(['client_id', 'client-a'])
        }
        return Promise.resolve({ data, error: null }).then(res)
      }
      return c
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const recent = () => new Date(Date.now() - 60_000).toISOString()
const call = () => GET(new NextRequest('http://localhost:3001/x'), { params: { id: 'client-a', cid: 'c1' } })
const pending = (body: { timeline: Array<{ pendingCall?: string }> }) => body.timeline.filter((e) => e.pendingCall)

beforeEach(() => vi.clearAllMocks())

describe('时间线里「刚拨出、整理中」的电话', () => {
  it('刚拨出、还没挂断：显示通话中', async () => {
    mockDb({ initiated: [{ provider_call_id: 'CA1', received_at: recent() }], completedIds: [], calls: [] })
    const body = await (await call()).json()
    expect(pending(body)).toHaveLength(1)
    expect(lastCandidates).toContain('+64210000001')
    expect(pending(body)[0].pendingCall).toBe('ringing')
  })

  it('已挂断、还没写进 CRM（通话行还是 pending 或还没有）：显示已挂断整理中', async () => {
    mockDb({ initiated: [{ provider_call_id: 'CA1', received_at: recent() }], completedIds: ['CA1'], calls: [{ provider_call_id: 'CA1', crm_status: 'pending' }] })
    const body = await (await call()).json()
    expect(pending(body)[0].pendingCall).toBe('ended')
  })

  it('已经整理完（写进 CRM / 跳过 / 失败）：不再显示整理中', async () => {
    for (const st of ['written', 'skipped', 'needs_review', 'failed']) {
      mockDb({ initiated: [{ provider_call_id: 'CA1', received_at: recent() }], completedIds: ['CA1'], calls: [{ provider_call_id: 'CA1', crm_status: st }] })
      const body = await (await call()).json()
      expect(pending(body)).toHaveLength(0)
    }
  })

  it('没有外呼记录：时间线里没有整理中条目', async () => {
    mockDb({ initiated: [], completedIds: [], calls: [] })
    const body = await (await call()).json()
    expect(pending(body)).toHaveLength(0)
  })

  it('澳洲号码：两种国家都试，拨出去的那个号能对上', async () => {
    mockDb({ initiated: [{ provider_call_id: 'CA1', received_at: recent() }], completedIds: [], calls: [] }, '0412 345 678')
    const body = await (await call()).json()
    expect(pending(body)).toHaveLength(1)
    expect(lastCandidates).toContain('+61412345678')
  })

  it('挂断后超过 10 分钟还没整理成记录：如实说没整理成；一直没挂断回调超过 15 分钟：不再显示', async () => {
    const old = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    mockDb({ initiated: [{ provider_call_id: 'CA1', received_at: old(12) }], completedIds: ['CA1'], calls: [] })
    const stuck = await (await call()).json()
    expect(pending(stuck)).toHaveLength(1)
    expect((pending(stuck)[0] as { summary?: string }).summary).toContain('请联系管理员')
    mockDb({ initiated: [{ provider_call_id: 'CA2', received_at: old(20) }], completedIds: [], calls: [] })
    const stale = await (await call()).json()
    expect(pending(stale)).toHaveLength(0)
  })
})

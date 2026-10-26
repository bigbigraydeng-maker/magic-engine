/**
 * AI 概况接口：取这个客人最新一份简报，给抽屉顶部的「AI 概况」卡用。
 * 钉住：IDOR 闸、没对话 / 没简报 / 空概况一律返回 null（卡不渲染），字段映射正确。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a' })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const mockAccess = vi.mocked(requirePaidClientAccess)

interface DbShape {
  contact?: { id: string } | null
  conversations?: Array<{ id: string; channel: string | null }>
  brief?: Record<string, unknown> | null
}

let queriedTables: string[] = []

function mockDb(db: DbShape) {
  queriedTables = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    queriedTables.push(table)
    if (table === 'contacts') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.contact ?? null, error: null }) }) }) }),
      }
    }
    if (table === 'conversations') {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: db.conversations ?? [], error: null }) }) }) }
    }
    if (table === 'conversation_briefs') {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              not: () => ({
                order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: db.brief ?? null, error: null }) }) }),
              }),
            }),
          }),
        }),
      }
    }
    throw new Error('unexpected table: ' + table)
  })
}

function req() {
  return new NextRequest('http://localhost/x')
}
const params = { params: { id: 'client-a', cid: 'c1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockAccess.mockResolvedValue({ ok: true, allowedClientId: 'client-a' } as never)
})

describe('AI 概况接口', () => {
  it('没权限 → 原样透传状态码', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    mockDb({})
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
  })

  it('contact 不属于这个客户 → 404', async () => {
    mockDb({ contact: null })
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
  })

  it('没有对话 → brief: null，不查 conversation_briefs', async () => {
    mockDb({ contact: { id: 'c1' }, conversations: [] })
    const res = await GET(req(), params)
    expect(await res.json()).toEqual({ brief: null })
    expect(queriedTables).not.toContain('conversation_briefs')
  })

  it('有对话但没简报 → brief: null', async () => {
    mockDb({ contact: { id: 'c1' }, conversations: [{ id: 'conv-1', channel: 'email' }], brief: null })
    const res = await GET(req(), params)
    expect(await res.json()).toEqual({ brief: null })
  })

  it('概况为空字符串 → brief: null（不渲染一张空卡）', async () => {
    mockDb({
      contact: { id: 'c1' },
      conversations: [{ id: 'conv-1', channel: 'email' }],
      brief: { conversation_id: 'conv-1', summary: '   ', customer_needs: [], objections: [], promises_made: [] },
    })
    const res = await GET(req(), params)
    expect(await res.json()).toEqual({ brief: null })
  })

  it('有简报 → 映射字段，channel 从对话带出，脏数组项被滤掉', async () => {
    mockDb({
      contact: { id: 'c1' },
      conversations: [{ id: 'conv-1', channel: 'email' }],
      brief: {
        conversation_id: 'conv-1',
        summary: '客户想订 China Discovery 团',
        customer_needs: ['带朋友一起报', '', 123],
        objections: [],
        promises_made: ['把报名表发给他朋友'],
        next_action: '把报名表发给 Gin Hoe',
        intent_level: 'high',
        generated_at: '2026-10-26T00:00:00Z',
      },
    })
    const res = await GET(req(), params)
    const body = (await res.json()) as { brief: Record<string, unknown> }
    expect(body.brief).toEqual({
      summary: '客户想订 China Discovery 团',
      customerNeeds: ['带朋友一起报'],
      objections: [],
      promisesMade: ['把报名表发给他朋友'],
      nextAction: '把报名表发给 Gin Hoe',
      intentLevel: 'high',
      channel: 'email',
      generatedAt: '2026-10-26T00:00:00Z',
    })
  })
})

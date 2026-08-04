/**
 * 往来时间线的**顺序**测试。
 *
 * 2026-07-31 PM 反馈：CRM 里聊天记录是倒着排的，读不通 —— 倒序会把回答排在提问
 * 前面。这里钉住两件事：
 *   1. 返回的时间线是**从旧到新**（最新在最下面，跟聊天软件一致）
 *   2. 取消息时仍然是「倒序 + limit」—— 那个倒序是为了超量时留下**最近**的 3000
 *      条，跟着一起改成正序会把话痨客户的近期对话全丢掉（只留最老的）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a' })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

/** 记录取消息时用的排序方向和上限。 */
let messageOrder: { column: string; ascending: boolean } | null = null
let messageLimit: number | null = null

const TOUCH = {
  channel: 'meta_lead_form',
  direction: 'inbound',
  occurred_at: '2026-07-20T00:00:00Z',
  summary: '填了 Facebook 表单',
  metadata: {},
}

const MESSAGES = [
  // 库里返回的就是倒序（最新在前）—— 路由必须自己排成正序。
  { direction: 'outbound', sender_name: 'CTS', body: '有的，8 天团', sent_at: '2026-07-22T02:00:00Z' },
  { direction: 'inbound', sender_name: 'Susan', body: '有长城的团吗', sent_at: '2026-07-22T01:00:00Z' },
]

function mockDb() {
  messageOrder = null
  messageLimit = null
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'contacts') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'c1', display_name: 'Susan', primary_phone: null, primary_email: null, stage: null },
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({ order: () => ({ limit: async () => ({ data: [TOUCH], error: null }) }) }),
            }),
          }),
        }),
      }
    }
    if (table === 'contact_stage_events') {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
        }),
      }
    }
    if (table === 'client_pipeline_stages') {
      return { select: () => ({ eq: async () => ({ data: [] }) }) }
    }
    if (table === 'conversations') {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: [{ id: 'conv-1' }] }) }) }) }
    }
    if (table === 'conversation_messages') {
      return {
        select: () => ({
          in: () => ({
            order: (column: string, opts: { ascending: boolean }) => {
              messageOrder = { column, ascending: opts.ascending }
              return {
                limit: async (n: number) => {
                  messageLimit = n
                  return { data: MESSAGES }
                },
              }
            },
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const call = () =>
  GET(new NextRequest('http://localhost:3001/x'), { params: { id: 'client-a', cid: 'c1' } })

beforeEach(() => {
  vi.clearAllMocks()
  mockDb()
})

describe('往来时间线的顺序', () => {
  it('从旧到新返回 —— 一问一答读得通', async () => {
    const body = await (await call()).json()
    const times = body.timeline.map((e: { at: string }) => e.at)

    expect(times).toEqual([
      '2026-07-20T00:00:00Z', // 表单（最早）
      '2026-07-22T01:00:00Z', // 客人提问
      '2026-07-22T02:00:00Z', // 我们回答（最新，在最下面）
    ])
  })

  it('提问排在回答前面（倒序时这一条会反）', async () => {
    const body = await (await call()).json()
    const msgs = body.timeline.filter((e: { kind: string }) => e.kind === 'message')
    expect(msgs.map((m: { body: string }) => m.body)).toEqual(['有长城的团吗', '有的，8 天团'])
  })

  it('🔴 取消息仍然是「倒序 + limit」—— 超量时要留最近的，不是最老的', async () => {
    await call()
    expect(messageOrder).toEqual({ column: 'sent_at', ascending: false })
    expect(messageLimit).toBe(3000)
  })
})

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

function mockDb(over: { touches?: Array<Record<string, unknown>>; conversations?: Array<Record<string, unknown>> } = {}) {
  const touches = over.touches ?? [TOUCH]
  const conversations = over.conversations ?? [{ id: 'conv-1' }]
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
              neq: () => ({ order: () => ({ limit: async () => ({ data: touches, error: null }) }) }),
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
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: conversations }) }) }) }
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

describe('AI 摘要不再从时间线接口出（2026-10-10 并进列表接口的「该做什么」）', () => {
  it('有 WhatsApp 对话的人，WhatsApp 占位触点（对话开始 / 最近一次来信）不进时间线', async () => {
    mockDb({
      touches: [TOUCH, { ...TOUCH, channel: 'whatsapp', summary: '客人最近一次来信', occurred_at: '2026-10-06T00:00:00Z' }],
      conversations: [{ id: 'conv-1', channel: 'whatsapp' }],
    })
    const body = await (await call()).json()
    const touches = (body.timeline as Array<{ kind: string; channel?: string }>).filter((e) => e.kind === 'touch')
    expect(touches.map((e) => e.channel)).not.toContain('whatsapp')
    expect(touches.length).toBe(1)
  })

  it('没有 WhatsApp 对话记录的人，WhatsApp 触点照常显示（不让人消失）', async () => {
    mockDb({ touches: [{ ...TOUCH, channel: 'whatsapp', summary: '客人最近一次来信' }] })
    const body = await (await call()).json()
    const touches = (body.timeline as Array<{ kind: string; channel?: string }>).filter((e) => e.kind === 'touch')
    expect(touches.map((e) => e.channel)).toContain('whatsapp')
  })

  it('响应里没有 brief，也不再查 conversation_briefs', async () => {
    const body = await (await call()).json()
    expect(body).not.toHaveProperty('brief')
    const tables = (supabaseAdmin.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(tables).not.toContain('conversation_briefs')
  })
})

describe('官网表单的「出发时间 / 每人预算」一行人话', () => {
  const FORM = (at: string, meta: Record<string, unknown>) => ({
    channel: 'web_form',
    direction: 'inbound',
    occurred_at: at,
    summary: '官网表单 · /tours/x',
    metadata: meta,
  })

  it('web_form 触点带稳定代码 → 返回一行人话（只是事实）', async () => {
    mockDb({ touches: [FORM('2026-10-20T00:00:00Z', { travel_window: 'mar_may_2027', budget_band: '3000_5000' })] })
    const body = await (await call()).json()
    expect(body.formFactsLine).toBe('预计 2027 年 3–5 月出发 · 预算 3,000–5,000/人')
  })

  it('多条 web_form 取最新一条带代码的', async () => {
    mockDb({
      touches: [
        FORM('2026-10-01T00:00:00Z', { travel_window: 'oct_dec_2027' }),
        FORM('2026-10-20T00:00:00Z', { travel_window: 'jun_sep_2027', budget_band: 'above_8000' }),
      ],
    })
    const body = await (await call()).json()
    expect(body.formFactsLine).toBe('预计 2027 年 6–9 月出发 · 预算 8,000 以上/人')
  })

  it('缺失 / 映射不到的代码 → null（不显示、不当 0）；其它渠道的触点不算', async () => {
    mockDb({ touches: [FORM('2026-10-20T00:00:00Z', {}), FORM('2026-10-21T00:00:00Z', { travel_window: 'early_2028' })] })
    expect((await (await call()).json()).formFactsLine).toBeNull()
    mockDb({ touches: [{ ...FORM('2026-10-20T00:00:00Z', { travel_window: 'mar_may_2027' }), channel: 'email' }] })
    expect((await (await call()).json()).formFactsLine).toBeNull()
  })
})

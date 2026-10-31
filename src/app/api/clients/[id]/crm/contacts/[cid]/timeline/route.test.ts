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

vi.mock('@/lib/crm/email-full-body', async (orig) => ({
  ...(await orig<typeof import('@/lib/crm/email-full-body')>()),
  fetchFullEmailBody: vi.fn(async () => null),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { fetchFullEmailBody } from '@/lib/crm/email-full-body'
import { GET } from './route'
import { asFacts } from '@/lib/crm/call-analysis-facts'

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

function mockDb(over: { touches?: Array<Record<string, unknown>>; conversations?: Array<Record<string, unknown>>; messages?: Array<Record<string, unknown>> } = {}) {
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
              // 「回头客 / 往来一览」多取的那份全渠道触点（不带 neq）
              order: () => ({ limit: async () => ({ data: touches, error: null }) }),
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
                  return { data: over.messages ?? MESSAGES }
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
    mockDb({ touches: [FORM('2026-10-20T00:00:00Z', { form_travel_window: 'mar_may_2027', form_budget_band: '3000_5000' })] })
    const body = await (await call()).json()
    expect(body.formFactsLine).toBe('预计 2027 年 3–5 月出发 · 预算 3,000–5,000/人（10月20日提交）')
  })

  it('多条 web_form 取最新一条带代码的', async () => {
    mockDb({
      touches: [
        FORM('2026-10-01T00:00:00Z', { form_travel_window: 'oct_dec_2027' }),
        FORM('2026-10-20T00:00:00Z', { form_travel_window: 'jun_sep_2027', form_budget_band: 'above_8000' }),
      ],
    })
    const body = await (await call()).json()
    expect(body.formFactsLine).toBe('预计 2027 年 6–9 月出发 · 预算 8,000 以上/人（10月20日提交）')
  })

  it('缺失 / 映射不到的代码 → null（不显示、不当 0）；其它渠道的触点不算', async () => {
    mockDb({ touches: [FORM('2026-10-20T00:00:00Z', {}), FORM('2026-10-21T00:00:00Z', { form_travel_window: 'early_2028' })] })
    expect((await (await call()).json()).formFactsLine).toBeNull()
    mockDb({ touches: [{ ...FORM('2026-10-20T00:00:00Z', { form_travel_window: 'mar_may_2027' }), channel: 'email' }] })
    expect((await (await call()).json()).formFactsLine).toBeNull()
  })

  it('Facebook 客资表单的预算和出发时间也要显示（2026-10-28 PM 发现一直没读）', async () => {
    mockDb({
      touches: [
        {
          ...FORM('2026-10-26T11:23:31Z', {
            custom_answers: {
              'when_are_you_hoping_to_travel?': 'not_sure_exploring',
              'whats_your_budget_per_person_nzd?': '5000_8000',
            },
          }),
          channel: 'meta_lead_form',
        },
      ],
    })
    const body = await (await call()).json()
    expect(body.formFactsLine).toBe('出发时间还没定（在了解） · 预算 NZD 5,000–8,000/人（10月27日提交）')
  })
})

/**
 * 抽屉顶部「回头客 / 往来一览」。
 *
 * 起因（PM 2026-10-27，看一个真实客人的抽屉）：她 6 月填过表、我们电话没接/私信回过、
 * 10 月她点了我们的邮件、我们邮件回复并跟进过两次，今天她又填了一次表。面板上却只显示
 * 今天那条表单，「我们发过邮件」只在最底下的往来记录里，强意向没人说出来。
 * 下面用她那条真实的形状（名字和联系方式不进测试）钉住。
 */
describe('回头客 / 往来一览（engagement）', () => {
  const T = (channel: string, direction: 'inbound' | 'outbound', at: string, metadata: Record<string, unknown> = {}) => ({
    channel, direction, occurred_at: at, summary: null, raw: null, source: null, metadata,
  })
  const RETURNING_SHAPE = [
    T('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z'),
    T('phone', 'outbound', '2026-06-15T07:55:00Z', { answered: false }),
    T('messenger', 'outbound', '2026-06-15T07:55:00Z'),
    T('messenger', 'inbound', '2026-06-15T07:57:00Z'),
    T('email', 'inbound', '2026-10-08T07:51:00Z', { email_clicked: true }),
    T('email', 'outbound', '2026-10-09T08:47:00Z'),
    T('email', 'outbound', '2026-10-24T01:11:00Z'),
    T('meta_lead_form', 'inbound', '2026-10-26T23:47:00Z'),
  ]

  it('🔴 她这种人 → 判成回头客，并带着故事线', async () => {
    mockDb({ touches: RETURNING_SHAPE })
    const body = await (await call()).json()
    expect(body.engagement.returning).not.toBeNull()
    expect(body.engagement.returning.earlierForms).toBe(1)
    expect(body.engagement.returning.firstEnquiryAt).toBe('2026-06-15T07:55:00.000Z')
    expect(body.engagement.returning.ourLastContactAt).toBe('2026-10-24T01:11:00.000Z')
    // 故事线最后一句必须是「又填了表」，并且打头带火
    const last = body.engagement.story[body.engagement.story.length - 1]
    expect(last.startsWith('🔥 ')).toBe(true)
    expect(last).toContain('又填了表')
  })

  it('🔴 往来一览一行字要写出「我们发过邮件」（这正是 PM 看不出来的那一条）', async () => {
    mockDb({ touches: RETURNING_SHAPE })
    const body = await (await call()).json()
    expect(body.engagement.line).toContain('邮件 2 封')
    expect(body.engagement.line).toContain('电话没接 1 次')
    expect(body.engagement.line).toContain('点过邮件链接 1 次')
  })

  it('第一次填表、我们还没联系过 → 不是回头客，但往来一览照样说「我们还没联系过」', async () => {
    mockDb({ touches: [T('meta_lead_form', 'inbound', '2026-10-26T23:47:00Z')] })
    const body = await (await call()).json()
    expect(body.engagement.returning).toBeNull()
    expect(body.engagement.story).toEqual([])
    expect(body.engagement.line).toBe('我们还没联系过 ｜ 他：填过 1 次表')
  })

  it('🔴 判断出错 → 整条往来记录照常返回，engagement 为 null（补充说明不能把正文弄丢）', async () => {
    // 让全渠道那条查询返回一个会让转换函数抛错的行
    mockDb({ touches: [{ ...T('meta_lead_form', 'inbound', '2026-10-26T23:47:00Z'), metadata: { get email_clicked(): boolean { throw new Error('boom') } } }] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.timeline)).toBe(true)
    expect(body.engagement).toBeNull()
    err.mockRestore()
  })

  it('返回的时间线本身不受影响（回头客逻辑没有改动往来记录的内容）', async () => {
    mockDb({ touches: RETURNING_SHAPE })
    const body = await (await call()).json()
    expect(body.timeline.length).toBeGreaterThan(0)
    expect(body.timeline.every((e: { at: string }) => typeof e.at === 'string')).toBe(true)
  })
})


describe('最新一封客人来信：摘要被截断时拉全文', () => {
  const PREVIEW = 'p'.repeat(253)
  const emailMsgs = (id: string | null) => [
    { conversation_id: 'conv-e', direction: 'inbound', sender_name: 'Nicole', body: PREVIEW, sent_at: '2026-10-27T11:16:00Z', message_id: id },
    { conversation_id: 'conv-e', direction: 'outbound', sender_name: 'CTS', body: 'o'.repeat(253), sent_at: '2026-09-23T08:23:00Z', message_id: 'out-1' },
  ]
  const bodies = async () => ((await (await call()).json()).timeline as Array<{ kind: string; body?: string }>)
    .filter((e) => e.kind === 'message')
    .map((e) => e.body)

  beforeEach(() => vi.mocked(fetchFullEmailBody).mockReset())

  it('只替换最新那封客人来信，且只拉这一封', async () => {
    mockDb({ conversations: [{ id: 'conv-e', channel: 'email' }], messages: emailMsgs('in-1') })
    vi.mocked(fetchFullEmailBody).mockResolvedValue('FULL TEXT ' + 'p'.repeat(300))
    const b = await bodies()
    expect(b.some((x) => x?.startsWith('FULL TEXT'))).toBe(true)
    expect(b.filter((x) => x?.startsWith('o')).length).toBe(1)
    expect(fetchFullEmailBody).toHaveBeenCalledTimes(1)
    expect(fetchFullEmailBody).toHaveBeenCalledWith('client-a', 'in-1')
  })

  it('拉不到全文 → 原样保留摘要，不报错', async () => {
    mockDb({ conversations: [{ id: 'conv-e', channel: 'email' }], messages: emailMsgs('in-1') })
    vi.mocked(fetchFullEmailBody).mockResolvedValue(null)
    expect((await bodies()).includes(PREVIEW)).toBe(true)
  })

  it('没有 message_id / 非邮件渠道 → 不去拉', async () => {
    mockDb({ conversations: [{ id: 'conv-e', channel: 'email' }], messages: emailMsgs(null) })
    await bodies()
    mockDb({ conversations: [{ id: 'conv-e', channel: 'messenger' }], messages: emailMsgs('in-1') })
    await bodies()
    expect(fetchFullEmailBody).not.toHaveBeenCalled()
  })
})

describe('机器发的出站邮件', () => {
  it('Mailchimp 发出的触点带 automated:true，客人的入站、同事的出站不带', async () => {
    mockDb({
      touches: [
        { channel: 'email', direction: 'outbound', occurred_at: '2026-10-28T19:02:00Z', summary: '发出《Welcome》', raw: null, metadata: { automated: true, kind: 'sent' }, source: 'mailchimp' },
        { channel: 'email', direction: 'inbound', occurred_at: '2026-10-28T01:00:00Z', summary: '打开了《Welcome》', raw: null, metadata: {}, source: 'mailchimp' },
        { channel: 'email', direction: 'outbound', occurred_at: '2026-10-27T01:00:00Z', summary: 'Hi Sue', raw: null, metadata: {}, source: 'microsoft_mail' },
        { channel: 'phone', direction: 'outbound', occurred_at: '2026-10-26T01:00:00Z', summary: 'AI call summary', raw: null, metadata: { automated: true }, source: 'voice' },
      ],
      conversations: [],
      messages: [],
    })
    const body = await (await call()).json()
    const byText = Object.fromEntries(body.timeline.map((e: { summary: string; automated: boolean }) => [e.summary, e.automated]))
    expect(byText['发出《Welcome》']).toBe(true)
    expect(byText['打开了《Welcome》']).toBe(false)
    expect(byText['Hi Sue']).toBe(false)
    // AI 外呼也标了 automated，但电话不是「系统自动发出的邮件」，不能被同样处理
    expect(byText['AI call summary']).toBe(false)
  })
})

/**
 * 表格「员工跟进记录」同步进来的触点（source = sheet_followup）只有原话（raw）、没有 AI 摘要。
 * 抽屉只认摘要，这类记录整条看不见（2026-10-29 PM 发现：CTS 393 位客人的 407 条）。
 * 所以没有摘要时要把原话以 `sheetNote` 送出去；表格不记时间，`at` 是客人填表的时间，
 * 要带 `timeApproximate` 让界面说清楚。
 */
describe('表格同步的员工跟进记录：原话要送到前端', () => {
  const SHEET = (over: Record<string, unknown> = {}) => ({
    channel: 'phone',
    direction: 'outbound',
    occurred_at: '2026-10-03T18:44:59Z',
    summary: null,
    raw: 'no, I do not want to go to China',
    source: 'sheet_followup',
    metadata: { outcome: 'spoke', time_is_approximate: true, timestamp_basis: 'lead_created_time' },
    ...over,
  })
  const onlyTouch = async (touch: Record<string, unknown>) => {
    mockDb({ touches: [touch], conversations: [], messages: [] })
    const body = await (await call()).json()
    return (body.timeline as Array<Record<string, unknown>>).filter((e) => e.kind === 'touch')
  }

  it('🔴 没有摘要的表格记录 → 带出员工写的原话，并标明时间是近似的', async () => {
    const [t] = await onlyTouch(SHEET())
    expect(t.sheetNote).toBe('no, I do not want to go to China')
    expect(t.timeApproximate).toBe(true)
  })

  it('摘要是空串也算没有摘要', async () => {
    const [t] = await onlyTouch(SHEET({ summary: '  ' }))
    expect(t.sheetNote).toBe('no, I do not want to go to China')
  })

  it('已经有摘要的旧导入记录 → 不再带原话（抽屉显示摘要，同一句话不显示两遍），时间照样标近似', async () => {
    const [t] = await onlyTouch(SHEET({ summary: '客人说不去中国了' }))
    expect(t).not.toHaveProperty('sheetNote')
    expect(t.timeApproximate).toBe(true)
  })

  it('不是表格来的记录（手工 / 外呼）→ 不带 sheetNote，也不带近似标记', async () => {
    const [t] = await onlyTouch(SHEET({ source: 'me_manual', metadata: { outcome: 'spoke' } }))
    expect(t).not.toHaveProperty('sheetNote')
    expect(t).not.toHaveProperty('timeApproximate')
  })

  it('原话只有空白 → 不带（没有东西可显示）', async () => {
    const [t] = await onlyTouch(SHEET({ raw: '   ' }))
    expect(t).not.toHaveProperty('sheetNote')
  })
})

describe('asFacts · 说话人', () => {
  it('把员工 / 客人的说话人带出去，界面据此写「员工原话 / 客人原话」；认不出的不带，不乱猜', () => {
    const out = asFacts([
      { key: 'next_step', value: 'v', quote: 'q1', speaker: 'employee' },
      { key: 'travel_window', value: 'v', quote: 'q2', speaker: 'customer' },
      { key: 'budget', value: 'v', quote: 'q3', speaker: 'robot' },
      { key: 'party_size', value: 'v', quote: 'q4' },
      { key: 'bad', value: 1, quote: 'q5' },
    ])
    expect(out).toEqual([
      { key: 'next_step', value: 'v', quote: 'q1', speaker: 'employee' },
      { key: 'travel_window', value: 'v', quote: 'q2', speaker: 'customer' },
      { key: 'budget', value: 'v', quote: 'q3' },
      { key: 'party_size', value: 'v', quote: 'q4' },
    ])
  })
})

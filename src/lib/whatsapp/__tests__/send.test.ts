/**
 * Tests for sending a WhatsApp reply from ME.
 *
 * Weighted like `lib/messenger/__tests__/send.test.ts`: this module is one of
 * the few that speaks to a real customer as the client, so the tests are about
 * the ways that goes wrong, not the happy path.
 *
 * Two things here are NOT in the Messenger version, because WhatsApp's auth
 * model made them possible:
 *   · sending from a number that belongs to a different client (the sender
 *     identity lives in env, the conversation's owner lives in the DB)
 *   · sending with no audit row, because the audit insert failed
 *
 * Every stub records the filters it was called with. A stub that ignores
 * `.eq()` makes isolation tests pass no matter what the implementation does —
 * the assertions at the bottom of each describe block are what make these real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/whatsapp/credentials', () => ({ resolveWhatsAppCredentials: vi.fn() }))

import { whatsappWindow, sendWhatsApp, CUSTOMER_SERVICE_WINDOW_MS } from '../send'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveWhatsAppCredentials } from '@/lib/whatsapp/credentials'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockResolveCreds = vi.mocked(resolveWhatsAppCredentials)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CONVO = 'convo-uuid'
const WA_ID = '64211234567'
const OUR_NUMBER = '999888777'

const NOW = new Date('2026-09-02T12:00:00.000Z')

interface Captured {
  auditInserts: Record<string, unknown>[]
  auditUpdates: Record<string, unknown>[]
  messageInserts: Record<string, unknown>[]
  touchpointUpserts: { row: Record<string, unknown>; opts: unknown }[]
  /** 每张表上用过的过滤条件 —— 隔离断言全靠它。 */
  filters: Record<string, Record<string, unknown>>
}

function stubSupabase(opts: {
  convoClientId?: string | null
  lastInboundAt?: string | null
  psid?: string | null
  channel?: string
  contactId?: string | null
  /** 这个客户名下绑的号码。undefined = 跟 env 一致；null = 没绑。 */
  ownedNumberId?: string | null
  ownerLookupFails?: boolean
  auditInsertFails?: boolean
}): Captured {
  const captured: Captured = {
    auditInserts: [],
    auditUpdates: [],
    messageInserts: [],
    touchpointUpserts: [],
    filters: {},
  }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }
    let selectingInbound = false
    const f = (captured.filters[table] ??= {})

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        f[col] = val
        if (col === 'direction' && val === 'inbound') selectingInbound = true
        return chain
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        f[`__order_${col}`] = o?.ascending
        return chain
      },
      limit: () => chain,
      // 见 route.test.ts 同处注释：没有 then，被测代码的 error 检查读到的全是 undefined
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      single: async () => result,
      maybeSingle: async () => {
        if (table === 'conversation_messages' && selectingInbound) {
          return { data: opts.lastInboundAt ? { sent_at: opts.lastInboundAt } : null, error: null }
        }
        return result
      },
      insert: (payload: Record<string, unknown>) => {
        if (table === 'conversation_outbound_log') {
          captured.auditInserts.push(payload)
          result = opts.auditInsertFails
            ? { data: null, error: { message: 'audit write failed' } }
            : { data: { id: 'audit-1' }, error: null }
        } else if (table === 'conversation_messages') {
          captured.messageInserts.push(payload)
          result = { data: null, error: null }
        }
        return chain
      },
      update: (payload: Record<string, unknown>) => {
        if (table === 'conversation_outbound_log') captured.auditUpdates.push(payload)
        result = { data: null, error: null }
        return chain
      },
      upsert: (row: Record<string, unknown>, upsertOpts: unknown) => {
        if (table === 'contact_touchpoints') captured.touchpointUpserts.push({ row, opts: upsertOpts })
        result = { data: null, error: null }
        return chain
      },
    }

    if (table === 'conversations') {
      result = {
        data:
          opts.convoClientId === null
            ? null
            : {
                id: CONVO,
                client_id: opts.convoClientId ?? CTS,
                channel: opts.channel ?? 'whatsapp',
                participant_psid: opts.psid === undefined ? WA_ID : opts.psid,
                contact_id: opts.contactId === undefined ? 'contact-1' : opts.contactId,
              },
        error: null,
      }
    }

    if (table === 'clients') {
      result = opts.ownerLookupFails
        ? { data: null, error: { message: 'lookup blew up' } }
        : {
            data: {
              whatsapp_phone_number_id:
                opts.ownedNumberId === undefined ? OUR_NUMBER : opts.ownedNumberId,
            },
            error: null,
          }
    }

    return chain as never
  })

  return captured
}

describe('whatsappWindow', () => {
  it('客人没说过话 → 只能发模板，不是「还没试过」', () => {
    expect(whatsappWindow(null, NOW)).toEqual({ kind: 'template_only', msRemaining: 0 })
  })

  it('24 小时内 → 开着，剩余时间算得对', () => {
    const tenHoursAgo = new Date(NOW.getTime() - 10 * 3_600_000).toISOString()
    const win = whatsappWindow(tenHoursAgo, NOW)
    expect(win.kind).toBe('open')
    expect(win.msRemaining).toBe(CUSTOMER_SERVICE_WINDOW_MS - 10 * 3_600_000)
  })

  it('超过 24 小时 → 只能发模板', () => {
    expect(whatsappWindow(new Date(NOW.getTime() - 25 * 3_600_000).toISOString(), NOW)).toEqual({
      kind: 'template_only',
      msRemaining: 0,
    })
  })

  it('没有 7 天 human_agent 续期档 —— 这是跟 Messenger 唯一的规则差异', () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 3_600_000).toISOString()
    expect(whatsappWindow(sixDaysAgo, NOW).kind).toBe('template_only')
  })
})

describe('sendWhatsApp', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // 凭据解析本身有自己的测试；这里只关心 send.ts 怎么用它。
    // 默认返回 env 风格的凭据，让原本依赖 env 的用例保持原意。
    mockResolveCreds.mockResolvedValue({
      ok: true,
      credentials: { accessToken: 'test-token', phoneNumberId: OUR_NUMBER, source: 'env' },
    })
    // 默认让 fetch 炸 —— 任何**不该**打网络的用例一旦打了，就会以明显的方式失败，
    // 而不是安静地发出一个真实请求。
    global.fetch = vi.fn(() => {
      throw new Error('这个用例不该调用 fetch')
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  const send = (over: Partial<Parameters<typeof sendWhatsApp>[0]> = {}) =>
    sendWhatsApp({
      clientId: CTS,
      conversationId: CONVO,
      body: '你好',
      sentByEmail: 'sales@cts.co.nz',
      usedAiDraft: false,
      ...over,
    })

  it('空消息直接拒 —— 不查库、不打 Graph', async () => {
    const res = await send({ body: '   ' })
    expect(res).toMatchObject({ ok: false, reason: 'empty_body' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('隔离：会话不属于调用方声称的 client_id → 拒，且不写审计', async () => {
    const captured = stubSupabase({ convoClientId: OZTOP, lastInboundAt: NOW.toISOString() })
    const res = await send()
    expect(res).toMatchObject({ ok: false, reason: 'wrong_client' })
    expect(captured.auditInserts).toHaveLength(0)
  })

  it('查会话时按主键取 —— 断言真的带了 id 条件', async () => {
    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }),
    }) as unknown as typeof fetch
    await send()
    expect(captured.filters.conversations).toMatchObject({ id: CONVO })
  })

  it('算窗口只认这条会话的 inbound —— 断言 conversation_id 和 direction 都筛了', async () => {
    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }),
    }) as unknown as typeof fetch
    await send()
    expect(captured.filters.conversation_messages).toMatchObject({
      conversation_id: CONVO,
      direction: 'inbound',
    })
    // 取最新那条，不是最早那条 —— 取错方向会让窗口几乎永远判成关闭
    expect(captured.filters.conversation_messages.__order_sent_at).toBe(false)
  })

  it('2026-10-22 PM：机器发的（自动安抚 / AI 起草经人批准发出）触点标 automated；人亲手发的不标 —— CRM 才不会把机器回复当成「已跟进」', async () => {
    const okFetch = () =>
      (global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }),
      }) as unknown as typeof fetch)
    const machine = stubSupabase({ lastInboundAt: NOW.toISOString() })
    okFetch()
    await send({ sentByEmail: 'governed-reply-agent@magicengine.cloud' })
    expect(machine.touchpointUpserts[0].row).toMatchObject({ metadata: { sender: 'page', automated: true } })

    const human = stubSupabase({ lastInboundAt: NOW.toISOString() })
    okFetch()
    await send({ sentByEmail: 'sales@cts.co.nz' })
    const meta = (human.touchpointUpserts[0].row as { metadata: Record<string, unknown> }).metadata
    expect(meta.sender).toBe('page')
    expect('automated' in meta).toBe(false)
  })

  it('不是 whatsapp 渠道的会话 → 拒', async () => {
    stubSupabase({ channel: 'messenger', lastInboundAt: NOW.toISOString() })
    expect(await send()).toMatchObject({ ok: false, reason: 'wrong_channel' })
  })

  it('超过 24 小时窗口 → 拒，且不写审计（还没发就不该留「发过」的痕迹）', async () => {
    const captured = stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(),
    })
    const res = await send()
    expect(res).toMatchObject({ ok: false, reason: 'window_closed' })
    expect(captured.auditInserts).toHaveLength(0)
  })

  it('凭据解析失败 → 424 no_token，用解析器给的原文，不写审计、不打 Graph', async () => {
    mockResolveCreds.mockResolvedValue({ ok: false, error: 'WhatsApp 授权未配置，无法发送' })
    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    const res = await send()
    expect(res).toMatchObject({ ok: false, status: 424, reason: 'no_token' })
    expect(res.ok === false && res.error).toBe('WhatsApp 授权未配置，无法发送')
    expect(captured.auditInserts).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ── 发件号归属：这是 WhatsApp 独有的隔离缺口 ────────────────────────────
  it('客户压根没绑号码 → 拒发，且不去解析凭据', async () => {
    stubSupabase({ lastInboundAt: NOW.toISOString(), ownedNumberId: null })
    const res = await send()
    expect(res).toMatchObject({ ok: false, reason: 'no_token' })
    expect(res.ok === false && res.error).toContain('还没有绑定')
    expect(mockResolveCreds).not.toHaveBeenCalled()
  })

  it('查号码归属时按会话所属客户查 —— 断言查的是 convo.client_id，不是调用方传的', async () => {
    // 两个 id 必须不同，否则这条断言结构上不可能失败（魏征第 2 轮 W10：
    // 原 fixture 两边都是 CTS，测试名副其实但实际测不到任何东西）。
    // 这里让隔离闸先放行（调用方声称 OZTOP、会话也属于 OZTOP），
    // 于是「查归属时用的是哪个 id」才真正可观测。
    const captured = stubSupabase({ convoClientId: OZTOP, lastInboundAt: NOW.toISOString() })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }),
    }) as unknown as typeof fetch
    await send({ clientId: OZTOP })
    expect(captured.filters.clients).toMatchObject({ id: OZTOP })
    expect(captured.filters.clients.id).not.toBe(CTS)
  })

  it('归属查询本身失败 → 拒发（查不到不等于没绑），且不去解析凭据', async () => {
    stubSupabase({ lastInboundAt: NOW.toISOString(), ownerLookupFails: true })
    expect(await send()).toMatchObject({ ok: false, reason: 'no_token' })
    expect(mockResolveCreds).not.toHaveBeenCalled()
  })

  it('解析凭据时传的是会话所属客户和绑定的号码', async () => {
    stubSupabase({ lastInboundAt: NOW.toISOString() })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }),
    }) as unknown as typeof fetch
    await send()
    expect(mockResolveCreds).toHaveBeenCalledWith(CTS, OUR_NUMBER)
  })

  // ── 审计 ────────────────────────────────────────────────────────────────
  it('审计行写不进去 → 拒发。宁可不发，也不留一条查不到出处的消息', async () => {
    stubSupabase({ lastInboundAt: NOW.toISOString(), auditInsertFails: true })
    const res = await send()
    expect(res).toMatchObject({ ok: false })
    expect(res.ok === false && res.error).toContain('没写成功')
  })

  it('成功路径：写审计、发 Graph、回写消息、记触点', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.abc123' }] }),
    }) as unknown as typeof fetch

    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    const res = await send({ body: '你好，请问几点出发？', usedAiDraft: true })

    expect(res).toEqual({ ok: true, whatsappMessageId: 'wamid.abc123', window: 'open' })
    expect(captured.auditInserts[0]).toMatchObject({
      used_ai_draft: true,
      // 渠道限定词汇：跟 Messenger 的 standard / human_agent 不混在同一列里
      messaging_type: 'whatsapp_cs_window',
      client_id: CTS,
    })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'sent', meta_message_id: 'wamid.abc123' })
    expect(captured.messageInserts[0]).toMatchObject({ direction: 'outbound', message_id: 'wamid.abc123' })
    // W8：回写必须挂在**这条**会话上。只断言 direction/message_id 的话，
    // 把 conversation_id 写成别的会话，测试照样绿。
    expect(captured.messageInserts[0]).toMatchObject({ conversation_id: CONVO })
    expect(captured.touchpointUpserts[0].row).toMatchObject({
      channel: 'whatsapp',
      direction: 'outbound',
      client_id: CTS,
      // W12：出站幂等键必须是 `:out`。写成 `:in` 会跟入站触点撞同一个键，
      // 把「客人说过话」那笔覆盖成「我们回过」。
      source_ref: `${CONVO}:out`,
      source: 'whatsapp',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      `https://graph.facebook.com/v20.0/${OUR_NUMBER}/messages`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('用解析出来的凭据发 Graph —— 号码和 token 都来自解析器，不是 env', async () => {
    // env 故意设成跟解析结果不同的值：如果实现偷偷读 env，这条会红。
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token-should-not-be-used'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'env-number-should-not-be-used'
    mockResolveCreds.mockResolvedValue({
      ok: true,
      credentials: { accessToken: 'conn-token', phoneNumberId: OUR_NUMBER, source: 'connection' },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.conn' }] }),
    }) as unknown as typeof fetch

    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    const res = await send()

    expect(res).toMatchObject({ ok: true, whatsappMessageId: 'wamid.conn' })
    expect(global.fetch).toHaveBeenCalledWith(
      `https://graph.facebook.com/v20.0/${OUR_NUMBER}/messages`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer conn-token' }),
      }),
    )
    // 回写行的 sender_id 必须是解析出来的号码
    expect(captured.messageInserts[0]).toMatchObject({ sender_id: OUR_NUMBER })
  })

  it('Graph 拒收 → 明确失败并记进审计，不假装发出去了', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"Recipient number not in allowed list"}}',
    }) as unknown as typeof fetch

    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })
    expect(await send()).toMatchObject({ ok: false, reason: 'graph_failed' })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'failed' })
  })
})

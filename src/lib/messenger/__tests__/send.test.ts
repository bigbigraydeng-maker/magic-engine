/**
 * Tests for sending a Messenger reply from ME.
 *
 * This module is the only code that speaks to a real customer as the client, so
 * the tests are weighted towards the ways that can go wrong:
 *   - a logged-in CTS user posting into another client's thread (isolation)
 *   - sending outside Meta's window and getting an opaque rejection instead
 *   - an audit trail that only exists when the send happened to succeed
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))

import {
  messagingWindow,
  sendReply,
  STANDARD_WINDOW_MS,
  HUMAN_AGENT_WINDOW_MS,
} from '../send'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockUserToken = vi.mocked(getMetaTokenForClient)
const mockPageToken = vi.mocked(getPageAccessToken)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CONVO = 'convo-uuid'

const NOW = new Date('2026-07-26T12:00:00.000Z')

interface Captured {
  auditInserts: Record<string, unknown>[]
  auditUpdates: Record<string, unknown>[]
  messageInserts: Record<string, unknown>[]
  /** 发完之后往 CRM 记的那一笔（决定卡片当场变不变灰）。 */
  touchpointUpserts: { row: Record<string, unknown>; opts: unknown }[]
}

/**
 * Supabase stub. `convoClientId` is who the thread actually belongs to —
 * the isolation test sets it to a different client than the caller.
 */
function stubSupabase(opts: {
  convoClientId?: string | null
  lastInboundAt?: string | null
  psid?: string | null
  channel?: string
  /** 这段会话有没有认领到人。null = 无主会话。 */
  contactId?: string | null
}): Captured {
  const captured: Captured = {
    auditInserts: [],
    auditUpdates: [],
    messageInserts: [],
    touchpointUpserts: [],
  }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }
    let selectingInbound = false

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        if (col === 'direction' && val === 'inbound') selectingInbound = true
        return chain
      },
      order: () => chain,
      limit: () => chain,
      single: async () => result,
      maybeSingle: async () => {
        if (table === 'conversation_messages' && selectingInbound) {
          return {
            data: opts.lastInboundAt ? { sent_at: opts.lastInboundAt } : null,
            error: null,
          }
        }
        return result
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      insert: (payload: Record<string, unknown>) => {
        if (table === 'conversation_outbound_log') {
          captured.auditInserts.push(payload)
          result = { data: { id: 'audit-1' }, error: null }
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
                page_id: '1616575215312482',
                participant_psid: opts.psid === undefined ? 'psid_9' : opts.psid,
                // conversations 是四渠道共用的表。默认给私信，个别用例覆盖成
                // 别的渠道，验证「不是私信就不许在这里发」。
                channel: opts.channel ?? 'messenger',
                contact_id: opts.contactId === undefined ? 'contact-1' : opts.contactId,
              },
        error: null,
      }
    }

    return chain as never
  })

  return captured
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ message_id: 'mid.sent' }),
  } as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockUserToken.mockResolvedValue('user-tok')
  mockPageToken.mockResolvedValue('page-tok')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function input(over: Record<string, unknown> = {}) {
  return {
    clientId: CTS,
    conversationId: CONVO,
    body: 'Happy to send the itinerary.',
    sentByEmail: 'bdm@ctstours.co.nz',
    usedAiDraft: true,
    ...over,
  }
}

describe('messagingWindow', () => {
  it('is standard inside 24 hours', () => {
    const w = messagingWindow(new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), NOW)
    expect(w.kind).toBe('standard')
    expect(w.msRemaining).toBe(STANDARD_WINDOW_MS - 2 * 3_600_000)
  })

  it('switches to the human-agent tag the moment 24 hours passes', () => {
    const w = messagingWindow(new Date(NOW.getTime() - STANDARD_WINDOW_MS).toISOString(), NOW)
    expect(w.kind).toBe('human_agent')
  })

  it('closes after 7 days', () => {
    const w = messagingWindow(new Date(NOW.getTime() - HUMAN_AGENT_WINDOW_MS).toISOString(), NOW)
    expect(w.kind).toBe('closed')
  })

  it('is closed when the customer never wrote', () => {
    expect(messagingWindow(null, NOW).kind).toBe('closed')
  })
})

describe('sendReply — isolation', () => {
  it('refuses a thread that belongs to another client', async () => {
    const captured = stubSupabase({
      convoClientId: OZTOP,
      lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    })

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: false, status: 403, reason: 'wrong_client' })
    // Nothing may reach Meta, and no audit row may claim CTS tried to send here.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(captured.auditInserts).toHaveLength(0)
  })

  it('refuses a conversation id that does not exist', async () => {
    stubSupabase({ convoClientId: null })

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: false, status: 404, reason: 'not_found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sendReply — window', () => {
  it('refuses once Messenger is closed instead of letting Meta reject it', async () => {
    stubSupabase({ lastInboundAt: new Date(NOW.getTime() - 8 * 24 * 3_600_000).toISOString() })

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: false, status: 409, reason: 'window_closed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tags a reply sent outside 24 hours as human agent', async () => {
    stubSupabase({ lastInboundAt: new Date(NOW.getTime() - 3 * 24 * 3_600_000).toISOString() })

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: true, window: 'human_agent' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.messaging_type).toBe('MESSAGE_TAG')
    expect(body.tag).toBe('HUMAN_AGENT')
  })

  it('sends a normal response inside 24 hours', async () => {
    stubSupabase({ lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString() })

    await sendReply(input())

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.messaging_type).toBe('RESPONSE')
    expect(body.tag).toBeUndefined()
    expect(body.recipient.id).toBe('psid_9')
  })
})

describe('sendReply — audit', () => {
  it('records who sent what before calling Meta', async () => {
    const captured = stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    })

    await sendReply(input())

    expect(captured.auditInserts[0]).toMatchObject({
      client_id: CTS,
      sent_by_email: 'bdm@ctstours.co.nz',
      body: 'Happy to send the itinerary.',
      used_ai_draft: true,
      status: 'pending',
    })
  })

  it('marks the audit row failed when Meta rejects it', async () => {
    const captured = stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    })
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'policy violation',
    } as unknown as Response)

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: false, reason: 'graph_failed' })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'failed' })
    // The failed send must not appear in the thread as if it went out.
    expect(captured.messageInserts).toHaveLength(0)
  })

  it('writes the sent message into the thread so the card is immediately correct', async () => {
    const captured = stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    })

    await sendReply(input())

    expect(captured.auditUpdates[0]).toMatchObject({ status: 'sent', meta_message_id: 'mid.sent' })
    expect(captured.messageInserts[0]).toMatchObject({
      direction: 'outbound',
      body: 'Happy to send the itinerary.',
    })
  })
})

describe('sendReply — input', () => {
  it('rejects an empty body without touching the database', async () => {
    const captured = stubSupabase({ lastInboundAt: NOW.toISOString() })

    const res = await sendReply(input({ body: '   ' }))

    expect(res).toMatchObject({ ok: false, status: 400, reason: 'empty_body' })
    expect(captured.auditInserts).toHaveLength(0)
  })

  it('fails cleanly when Meta auth is not configured', async () => {
    const captured = stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    })
    mockPageToken.mockResolvedValue(null)

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: false, status: 424, reason: 'no_token' })
    expect(captured.auditUpdates[0]).toMatchObject({ status: 'failed' })
  })
})

/**
 * conversations 是四个渠道共用的表（邮件 / 外呼 / WhatsApp 都写这里）。
 * 走到这里的必须是私信 —— 否则我们会拿一封邮件的线程去调 Meta 的发送接口。
 */
describe('sendReply — 渠道', () => {
  it('邮件线程不许在这里回，而且说清楚是渠道用错了不是窗口关了', async () => {
    stubSupabase({
      lastInboundAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      channel: 'email',
    })

    const res = await sendReply(input())

    expect(res).toMatchObject({ ok: false, status: 409, reason: 'wrong_channel' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * 回完私信，那张卡必须**当场**变灰。
 *
 * 「今天该联系谁」判断灰不灰，看的是 `contact_touchpoints` 里今天有没有一笔
 * 我们发出的真人联系。而 Messenger 的出站触点原先**只有每小时那次同步才写**
 * —— 销售在页面里回完一条私信，卡片最长一小时不变灰。
 *
 * 那正是 PM 2026-08-05 抱怨的毛病本身，只是换了个渠道：他会以为没记上，
 * 再回一遍，客人收到两条。
 */
describe('回完私信，CRM 那边当场记上', () => {
  it('发送成功 → 写一笔 messenger 出站触点', async () => {
    const cap = stubSupabase({ lastInboundAt: '2026-07-26T10:00:00.000Z' })
    mockUserToken.mockResolvedValue('user-token')
    mockPageToken.mockResolvedValue('page-token')
    await sendReply({ clientId: CTS, conversationId: CONVO, body: '好的，我这就发给您', sentByEmail: 'a@b.com', usedAiDraft: false })

    expect(cap.touchpointUpserts).toHaveLength(1)
    const { row } = cap.touchpointUpserts[0]
    expect(row.direction).toBe('outbound')
    expect(row.channel).toBe('messenger')
    expect(row.contact_id).toBe('contact-1')
  })

  /**
   * 🔴 **幂等键必须跟每小时同步用的那一个一模一样。**
   *
   * 换个新键的话，同一段对话会同时存在「发送时写的」和「同步写的汇总」两行，
   * 任何按触点条数做的渠道统计当场失真。用同一个键，两边落在同一行上
   * （`ON CONFLICT DO UPDATE` 刷新时间），永远只有一条。
   */
  it('幂等键跟同步写的那一行相同 —— 不会变成两条', async () => {
    const cap = stubSupabase({ lastInboundAt: '2026-07-26T10:00:00.000Z' })
    mockUserToken.mockResolvedValue('user-token')
    mockPageToken.mockResolvedValue('page-token')
    await sendReply({ clientId: CTS, conversationId: CONVO, body: 'hi', sentByEmail: 'a@b.com', usedAiDraft: false })

    const { row, opts } = cap.touchpointUpserts[0]
    expect(row.source).toBe('messenger')
    expect(row.source_ref).toBe(`${CONVO}:out`)
    expect(opts).toEqual({ onConflict: 'client_id,source,source_ref' })
  })

  /** 没认领的会话挂不到人 —— 没有人可标，别写一条 contact_id 为空的脏数据。 */
  it('无主会话（还没认领到人）→ 不写触点', async () => {
    const cap = stubSupabase({ lastInboundAt: '2026-07-26T10:00:00.000Z', contactId: null })
    mockUserToken.mockResolvedValue('user-token')
    mockPageToken.mockResolvedValue('page-token')
    await sendReply({ clientId: CTS, conversationId: CONVO, body: 'hi', sentByEmail: 'a@b.com', usedAiDraft: false })

    expect(cap.touchpointUpserts).toHaveLength(0)
  })

  /**
   * 发送失败时绝不能记 —— 记了就是骗人：卡片变灰说「今天联系过了」，
   * 而客人**什么都没收到**，这个人当天再也不会被人想起来。
   */
  it('Meta 拒了这条消息 → 一个字都不记', async () => {
    const cap = stubSupabase({ lastInboundAt: '2026-07-26T10:00:00.000Z' })
    mockUserToken.mockResolvedValue('user-token')
    mockPageToken.mockResolvedValue(null) // 拿不到 page token，发不出去
    const r = await sendReply({ clientId: CTS, conversationId: CONVO, body: 'hi', sentByEmail: 'a@b.com', usedAiDraft: false })

    expect(r.ok).toBe(false)
    expect(cap.touchpointUpserts).toHaveLength(0)
  })
})

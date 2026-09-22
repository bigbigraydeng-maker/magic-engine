/**
 * Tests for /api/webhooks/meta/messenger (issue #1581, CTS Governed Reply v3 Layer 5).
 *
 * Mirrors `src/app/api/webhooks/whatsapp/__tests__/route.test.ts`'s structure and
 * concerns (signature verification, "not found" vs "could not look up", idempotent
 * upsert, one bad message must not sink the batch) — this file only adds the
 * Messenger-specific wrinkle: reusing an existing cron-synced thread's
 * `conversation_id` instead of always keying on the PSID (see route.ts header).
 *
 * Every stub records its `.eq()` filters, same discipline as the WhatsApp test —
 * without that, deleting the client_id filter from a query still passes every test.
 */

import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

const sendInngestEvent = vi.fn()
vi.mock('@/lib/workflows/inngest-event', () => ({
  sendInngestEvent: (e: unknown) => sendInngestEvent(e),
}))

// isOptOutKeyword 保持真实实现（不重测 #1575 已经测过的关键词判定本身）；
// recordOptOutKeywordTouch 是唯一要断言调用参数的部分——跟
// whatsapp/__tests__/route.test.ts 同一个边界划分。
vi.mock('@/lib/messenger-agent/optout', async (orig) => {
  const actual = await orig<typeof import('@/lib/messenger-agent/optout')>()
  return { ...actual, recordOptOutKeywordTouch: vi.fn() }
})

// 心跳检查（issue #1587）读的是这条落库路径本身——只断言它「被调用」，不重新
// 实现表结构；那张表的真实建模在 health-heartbeat.test.ts。
vi.mock('@/lib/messenger-agent/optout-failures', () => ({ recordOptOutWriteFailure: vi.fn() }))

// AD-SEC-4 绑定核实闸：规则本身在 lib/meta/__tests__/page-sync-authorization.test.ts
// 对着按表建模的假库测；这里只断言 webhook 真的按它的结论决定存不存。默认放行。
vi.mock('@/lib/meta/page-sync-authorization', () => ({ assessPageBinding: vi.fn() }))

import { GET, POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { CONVERSATION_MESSAGE_RECEIVED_EVENT } from '@/lib/conversations/events'
import { recordOptOutKeywordTouch } from '@/lib/messenger-agent/optout'
import { recordOptOutWriteFailure } from '@/lib/messenger-agent/optout-failures'
import { assessPageBinding } from '@/lib/meta/page-sync-authorization'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockRecordOptOutKeywordTouch = vi.mocked(recordOptOutKeywordTouch)
const mockRecordOptOutWriteFailure = vi.mocked(recordOptOutWriteFailure)
const mockAssess = vi.mocked(assessPageBinding)

const SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'
const PAGE_ID = '1616575215312482'
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const PSID = 'psid-amy-123'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makePost(payload: object, opts: { signature?: string | null; rawBody?: string } = {}) {
  const raw = opts.rawBody ?? JSON.stringify(payload)
  const sig = opts.signature !== undefined ? opts.signature : sign(raw)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) headers['x-hub-signature-256'] = sig
  return new NextRequest('https://me.example.com/api/webhooks/meta/messenger', {
    method: 'POST',
    headers,
    body: raw,
  })
}

function messagingEvent(
  over: Partial<{
    psid: string
    text: string
    mid: string
    timestampMs: number
    referral: Record<string, unknown>
    attachmentType: string
    attachmentUrl: string
    isEcho: boolean
  }> = {},
) {
  const message: Record<string, unknown> = { mid: over.mid ?? 'mid.ABC123' }
  if (over.isEcho) message.is_echo = true
  if (over.attachmentType) {
    message.attachments = [{ type: over.attachmentType, payload: { url: over.attachmentUrl ?? null } }]
  } else {
    message.text = over.text ?? '请问明天有团吗？'
  }

  const event: Record<string, unknown> = {
    sender: { id: over.psid ?? PSID },
    recipient: { id: PAGE_ID },
    timestamp: over.timestampMs ?? 1788336000000,
    message,
  }
  if (over.referral) event.referral = over.referral
  return event
}

function webhookPayload(events: Record<string, unknown>[]) {
  return { object: 'page', entry: [{ id: PAGE_ID, messaging: events }] }
}

interface Captured {
  convoSelects: Record<string, unknown>[]
  convoUpserts: { row: Record<string, unknown>; opts: unknown }[]
  updates: { table: string; payload: Record<string, unknown> }[]
  msgUpserts: { row: Record<string, unknown>; opts: unknown }[]
  filters: Record<string, Record<string, unknown>>
}

function stubDb(
  opts: {
    clientMapped?: boolean
    clientLookupFails?: boolean
    existingConversation?: { id: string; conversation_id: string; contact_id: string | null } | null
    convoUpsertFails?: boolean
    msgUpsertFails?: boolean
    optoutUnlinkedUpdateFails?: boolean
  } = {},
): Captured {
  const captured: Captured = { convoSelects: [], convoUpserts: [], msgUpserts: [], updates: [], filters: {} }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }
    const f = (captured.filters[table] ??= {})
    let sawConversationIdFilter = false

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        f[col] = val
        if (col === 'participant_psid') sawConversationIdFilter = true
        return chain
      },
      is: (col: string, val: unknown) => {
        f[`__is_${col}`] = val
        return chain
      },
      update: (payload: Record<string, unknown>) => {
        captured.updates.push({ table, payload })
        if (table === 'conversations' && 'optout_unlinked' in payload && opts.optoutUnlinkedUpdateFails) {
          result = { data: null, error: { message: 'optout_unlinked update failed' } }
        }
        return chain
      },
      single: async () => result,
      maybeSingle: async () => {
        if (table === 'conversations' && sawConversationIdFilter) {
          captured.convoSelects.push({ ...f })
          return { data: opts.existingConversation ?? null, error: null }
        }
        return result
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      upsert: (row: Record<string, unknown>, upsertOpts: unknown) => {
        if (table === 'conversations') {
          captured.convoUpserts.push({ row, opts: upsertOpts })
          result = opts.convoUpsertFails
            ? { data: null, error: { message: 'convo upsert failed' } }
            : { data: { id: 'convo-row-id' }, error: null }
        } else if (table === 'conversation_messages') {
          captured.msgUpserts.push({ row, opts: upsertOpts })
          result = opts.msgUpsertFails
            ? { data: null, error: { message: 'message upsert failed' } }
            : { data: null, error: null }
        }
        return chain
      },
    }

    if (table === 'clients') {
      result = opts.clientLookupFails
        ? { data: null, error: { message: 'column "facebook_page_id" does not exist' } }
        : { data: opts.clientMapped === false ? null : { id: CLIENT_ID }, error: null }
    }

    return chain as never
  })

  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_SECRET = SECRET
  process.env.META_VERIFY_TOKEN = VERIFY_TOKEN
  sendInngestEvent.mockResolvedValue({ event_ids: ['evt_1'] })
  mockRecordOptOutKeywordTouch.mockResolvedValue({ touchpointId: 'tp-1' })
  mockAssess.mockResolvedValue({ verified: true, via: 'staff_verified' })
})

describe('GET — 订阅握手', () => {
  it('mode/token/challenge 都对 → 原样回传 challenge，且钉死 text/plain', async () => {
    const req = new NextRequest(
      `https://me.example.com/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=xyz789`,
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('xyz789')
    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('token 不对 → 拒', async () => {
    const req = new NextRequest(
      'https://me.example.com/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=xyz789',
    )
    expect((await GET(req)).status).toBe(403)
  })

  it('没配 META_VERIFY_TOKEN → 500，不是假装验证通过', async () => {
    delete process.env.META_VERIFY_TOKEN
    const req = new NextRequest('https://me.example.com/api/webhooks/meta/messenger?hub.mode=subscribe')
    expect((await GET(req)).status).toBe(500)
  })
})

describe('POST — 签名验证', () => {
  it('签名不对 → 401，一行库都不碰', async () => {
    stubDb()
    const res = await POST(makePost(webhookPayload([messagingEvent()]), { signature: 'sha256=' + '0'.repeat(64) }))
    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('没带签名头 → 401', async () => {
    expect((await POST(makePost(webhookPayload([messagingEvent()]), { signature: null }))).status).toBe(401)
  })

  it('签名不是 64 位十六进制 → 401（Buffer.from 会静默截断非法字符）', async () => {
    expect(
      (await POST(makePost(webhookPayload([messagingEvent()]), { signature: 'sha256=zzzz' }))).status,
    ).toBe(401)
  })

  it('没配 META_APP_SECRET → 500', async () => {
    delete process.env.META_APP_SECRET
    expect((await POST(makePost(webhookPayload([messagingEvent()])))).status).toBe(500)
  })

  it('JSON 解析不了 → 400', async () => {
    const raw = '{not valid json'
    expect((await POST(makePost({}, { rawBody: raw, signature: sign(raw) }))).status).toBe(400)
  })
})

describe('POST — 「没映射」与「查不到」必须分开', () => {
  it('Page 真的没绑任何客户 → 回 200（重投也没用），但不落库', async () => {
    const captured = stubDb({ clientMapped: false })
    const res = await POST(makePost(webhookPayload([messagingEvent()])))
    expect(res.status).toBe(200)
    expect(captured.convoUpserts).toHaveLength(0)
  })

  it('🔴 查询本身失败 → 回 503 要求 Meta 重投，绝不当成「没映射」', async () => {
    const captured = stubDb({ clientLookupFails: true })
    const res = await POST(makePost(webhookPayload([messagingEvent()])))
    expect(res.status).toBe(503)
    expect(captured.convoUpserts).toHaveLength(0)
  })

  it('按 facebook_page_id 查客户 —— 断言真的用这个列筛', async () => {
    const captured = stubDb()
    await POST(makePost(webhookPayload([messagingEvent()])))
    expect(captured.filters.clients).toMatchObject({ facebook_page_id: PAGE_ID })
  })
})

describe('POST — AD-SEC-4 只存进「主页绑定核实过」的客户名下', () => {
  it('绑定没核实（比如历史上被客户改成了别家的主页）→ 回 200 不重投，但一条都不存、不发事件', async () => {
    const captured = stubDb()
    mockAssess.mockResolvedValue({ verified: false, reason: 'bound_to_other_client' })
    const res = await POST(makePost(webhookPayload([messagingEvent()])))
    expect(res.status).toBe(200)
    expect(mockAssess).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, PAGE_ID, expect.anything())
    expect(captured.convoUpserts).toHaveLength(0)
    expect(captured.msgUpserts).toHaveLength(0)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('没令牌也不算核实（webhook 不需要令牌，但也就没有任何归属证据）', async () => {
    const captured = stubDb()
    mockAssess.mockResolvedValue({ verified: false, reason: 'no_meta_token' })
    await POST(makePost(webhookPayload([messagingEvent()])))
    expect(captured.convoUpserts).toHaveLength(0)
  })

  it('核实时读库失败 → 503 让 Meta 重投，不当成「不属于这个客户」丢掉', async () => {
    const captured = stubDb()
    mockAssess.mockResolvedValue({ verified: false, reason: 'check_failed', detail: 'boom' })
    const res = await POST(makePost(webhookPayload([messagingEvent()])))
    expect(res.status).toBe(503)
    expect(captured.convoUpserts).toHaveLength(0)
  })
})

describe('POST — 消息落库', () => {
  it('新客人（cron 从没见过）→ 用 psid 当 conversation_id 建会话 + 落 inbound 消息', async () => {
    const captured = stubDb({ existingConversation: null })
    const res = await POST(makePost(webhookPayload([messagingEvent({ text: '你好' })])))

    expect(res.status).toBe(200)
    expect(captured.convoUpserts[0].row).toMatchObject({
      client_id: CLIENT_ID,
      channel: 'messenger',
      conversation_id: PSID,
      participant_psid: PSID,
      last_message_from: 'customer',
    })
    expect(captured.msgUpserts[0].row).toMatchObject({
      conversation_id: 'convo-row-id',
      direction: 'inbound',
      body: '你好',
      message_id: 'mid.ABC123',
    })
  })

  it('cron 已经同步过这个 psid → 复用它的 conversation_id（Graph 线程 id），不另开一行', async () => {
    const captured = stubDb({
      existingConversation: { id: 'convo-row-id', conversation_id: 't_100', contact_id: 'contact-uuid' },
    })
    await POST(makePost(webhookPayload([messagingEvent()])))

    expect(captured.convoUpserts[0].row).toMatchObject({
      conversation_id: 't_100', // 不是 PSID
      participant_psid: PSID,
    })
  })

  it('会话用 (client_id, conversation_id) 做原子 upsert —— 并发投递不会双建', async () => {
    const captured = stubDb()
    await POST(makePost(webhookPayload([messagingEvent()])))
    expect(captured.convoUpserts[0].opts).toMatchObject({ onConflict: 'client_id,conversation_id' })
  })

  it('消息用 (conversation_id, message_id) on conflict do nothing —— Meta 至少送达一次，重投不能重复入库', async () => {
    const captured = stubDb()
    await POST(makePost(webhookPayload([messagingEvent()])))
    expect(captured.msgUpserts[0].opts).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
  })

  it('排序用消息自己的时间，不是收到的时刻', async () => {
    const captured = stubDb()
    await POST(makePost(webhookPayload([messagingEvent({ timestampMs: 1788336000000 })])))
    const expected = new Date(1788336000000).toISOString()
    expect(captured.convoUpserts[0].row).toMatchObject({ last_message_at: expected })
    expect(captured.msgUpserts[0].row).toMatchObject({ sent_at: expected })
  })

  it('广告点进来的 referral 必须接住 —— 它只在第一条消息出现一次，过后永远拿不回来', async () => {
    const captured = stubDb()
    const referral = { source: 'ADS', type: 'OPEN_THREAD', ad_id: 'ad-123', ref: 'spring-tour' }
    await POST(makePost(webhookPayload([messagingEvent({ referral })])))
    expect(captured.updates).toContainEqual(
      expect.objectContaining({ table: 'conversations', payload: { entry_referral: referral } }),
    )
    // 归因是首触：单独带 is-null 守卫补写，不进 upsert 本体（否则第二条广告会覆盖第一条）
    expect(captured.convoUpserts[0].row).not.toHaveProperty('entry_referral')
    expect(captured.filters.conversations).toMatchObject({ __is_entry_referral: null })
  })

  it('图片消息要留住附件 url', async () => {
    const captured = stubDb()
    await POST(
      makePost(webhookPayload([messagingEvent({ attachmentType: 'image', attachmentUrl: 'https://cdn.example/x.jpg' })])),
    )
    expect(captured.msgUpserts[0].row).toMatchObject({ media_type: 'image', media_id: 'https://cdn.example/x.jpg' })
  })

  it('Page 自己消息的回声（is_echo）不当成客户消息处理', async () => {
    const captured = stubDb()
    const res = await POST(makePost(webhookPayload([messagingEvent({ isEcho: true })])))
    expect(res.status).toBe(200)
    expect(captured.convoUpserts).toHaveLength(0)
    expect(captured.msgUpserts).toHaveLength(0)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })
})

describe('POST — 落库成功后 emit conversation/message.received', () => {
  it('事件名必须是渠道无关的 conversation/message.received（不是 messenger/message.received）', async () => {
    stubDb()
    await POST(makePost(webhookPayload([messagingEvent()])))
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    expect(sendInngestEvent.mock.calls[0][0]).toMatchObject({ name: CONVERSATION_MESSAGE_RECEIVED_EVENT })
    expect(CONVERSATION_MESSAGE_RECEIVED_EVENT).toBe('conversation/message.received')
  })

  it('payload 带 channel=messenger + 下游查库要用的 conversation_id/message_id/client_id', async () => {
    const captured = stubDb({
      existingConversation: { id: 'convo-row-id', conversation_id: 't_100', contact_id: 'contact-uuid' },
    })
    await POST(makePost(webhookPayload([messagingEvent({ mid: 'mid.XYZ' })])))

    expect(sendInngestEvent.mock.calls[0][0].data).toMatchObject({
      channel: 'messenger',
      client_id: CLIENT_ID,
      conversation_id: 'convo-row-id', // conversations.id（UUID），不是渠道自己的线程键
      message_id: 'mid.XYZ',
      contact_id: 'contact-uuid',
      direction: 'inbound',
    })
    expect(captured.msgUpserts[0].row.message_id).toBe('mid.XYZ')
  })

  it('发条子失败不能让消息已经入库这件事判失败（Meta 不能被要求重投一条已存的消息）', async () => {
    stubDb()
    sendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_SEND_FAILED:401'))
    const res = await POST(makePost(webhookPayload([messagingEvent()])))
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 🔴 Codex 复审（2026-09-15，PR #1736）实测发现：这条渠道原来完全没有做
// opt-out 检测——只有 WhatsApp 那边的 webhook（issue #1582）会查
// isOptOutKeyword/recordOptOutKeywordTouch，Messenger 这边只落库 + emit。
// 后果：客户第一句话就说"别再联系我"，F1（issue #1584）的 opt-out 检查只会
// 查"已经记录过的"状态——这条消息本身还没被记录，检查会放行，照常自动回一
// 句安抚，直接违反客户刚说的话。补齐跟 WhatsApp 完全对称的检测+写入路径。
// 不重测 optout.ts / isOptOutKeyword 内部逻辑（#1575 的范围），只断言这里
// 传的参数对不对、走对了哪条分叉——跟 whatsapp/__tests__/route.test.ts 的
// 边界划分一致。
// ---------------------------------------------------------------------------
describe('POST — opt-out 检测接入（Codex 复审补，跟 WhatsApp 对称）', () => {
  it('命中退订关键词 + 有 contact_id → 调用 recordOptOutKeywordTouch，参数带真实消息时间', async () => {
    stubDb({
      existingConversation: { id: 'convo-row-id', conversation_id: 't_100', contact_id: 'contact-uuid' },
    })
    const sentAt = new Date(1788336000000).toISOString()
    await POST(makePost(webhookPayload([messagingEvent({ text: 'STOP', mid: 'mid.OPTOUT' })])))

    expect(mockRecordOptOutKeywordTouch).toHaveBeenCalledTimes(1)
    expect(mockRecordOptOutKeywordTouch).toHaveBeenCalledWith(
      {
        clientId: CLIENT_ID,
        contactId: 'contact-uuid',
        channel: 'messenger',
        conversationId: 'convo-row-id',
        messageId: 'mid.OPTOUT',
        occurredAt: sentAt,
      },
      supabaseAdmin,
    )
  })

  it('命中退订关键词 + 没有 contact_id → 退回会话级 optout_unlinked 兜底列，不经过 optout.ts', async () => {
    const captured = stubDb() // 默认没有 existingConversation → contactId 为 null
    await POST(makePost(webhookPayload([messagingEvent({ text: '退订', mid: 'mid.OPTOUT2' })])))

    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
    const unlinkedUpdate = captured.updates.find((u) => 'optout_unlinked' in u.payload)
    expect(unlinkedUpdate).toMatchObject({ table: 'conversations', payload: { optout_unlinked: true } })
  })

  it('没命中退订关键词 → 完全不调 recordOptOutKeywordTouch，正常 emit', async () => {
    stubDb({
      existingConversation: { id: 'convo-row-id', conversation_id: 't_100', contact_id: 'contact-uuid' },
    })
    await POST(makePost(webhookPayload([messagingEvent({ text: '请问明天有团吗？' })])))

    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
  })

  it('退订触点写入失败（抛错）不影响消息已经落库的结果（best-effort，跟 CRM 触点一致），且心跳检查（#1587）能看到这次失败', async () => {
    mockRecordOptOutKeywordTouch.mockRejectedValue(new Error('db 抽风'))
    stubDb({
      existingConversation: { id: 'convo-row-id', conversation_id: 't_100', contact_id: 'contact-uuid' },
    })
    const res = await POST(makePost(webhookPayload([messagingEvent({ text: 'stop', mid: 'mid.OPTOUT3' })])))
    expect(res.status).toBe(200)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledTimes(1)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        channel: 'messenger',
        conversationId: 'convo-row-id',
        contactId: 'contact-uuid',
        errorMessage: expect.stringContaining('db 抽风'),
      }),
      supabaseAdmin,
    )
  })

  it('没有 contact_id 时，写 conversations.optout_unlinked 本身失败 → 仍回 200，但心跳检查（#1587）能看到这次失败', async () => {
    stubDb({ optoutUnlinkedUpdateFails: true }) // 默认没有 existingConversation → contactId 为 null
    const res = await POST(makePost(webhookPayload([messagingEvent({ text: '退订', mid: 'mid.OPTOUT4' })])))

    expect(res.status).toBe(200)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledTimes(1)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        channel: 'messenger',
        contactId: null,
        errorMessage: expect.stringContaining('optout_unlinked update failed'),
      }),
      supabaseAdmin,
    )
  })
})

describe('POST — 一条坏消息不能带走一整批', () => {
  it('批量投递里第 1 条失败 → 第 2 条仍然入库，并回 503 让 Meta 重投', async () => {
    let call = 0
    const captured: Captured = { convoSelects: [], convoUpserts: [], msgUpserts: [], updates: [], filters: {} }
    mockFrom.mockImplementation((table: string) => {
      let result: unknown = { data: null, error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        update: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
        upsert: (row: Record<string, unknown>, o: unknown) => {
          if (table === 'conversations') {
            captured.convoUpserts.push({ row, opts: o })
            result = { data: { id: 'convo-row-id' }, error: null }
          } else if (table === 'conversation_messages') {
            call++
            captured.msgUpserts.push({ row, opts: o })
            result = call === 1 ? { data: null, error: { message: 'boom' } } : { data: null, error: null }
          }
          return chain
        },
      }
      if (table === 'clients') result = { data: { id: CLIENT_ID }, error: null }
      return chain as never
    })

    const res = await POST(
      makePost(
        webhookPayload([
          messagingEvent({ mid: 'mid.FIRST' }),
          messagingEvent({ mid: 'mid.SECOND', text: '第二条' }),
        ]),
      ),
    )

    expect(captured.msgUpserts).toHaveLength(2)
    expect(captured.msgUpserts[1].row).toMatchObject({ message_id: 'mid.SECOND' })
    expect(res.status).toBe(503)
  })

  it('全部成功 → 200，并报告存了几条', async () => {
    stubDb()
    const res = await POST(makePost(webhookPayload([messagingEvent()])))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, stored: 1 })
  })

  it('没有 messaging 数组的条目 → 200，不当成错误', async () => {
    stubDb()
    const res = await POST(makePost({ object: 'page', entry: [{ id: PAGE_ID }] }))
    expect(res.status).toBe(200)
  })
})

/**
 * Tests for /api/webhooks/whatsapp.
 *
 * This is the only path inbound WhatsApp messages take into ME — Cloud API has
 * no "list recent messages" endpoint the way Messenger's Graph API does, so
 * there is no cron to fall back on. If this route drops a message, the message
 * is gone.
 *
 * That shapes what is tested: the interesting cases are all about **not losing
 * a message**, and about the difference between "nobody owns this number" and
 * "we couldn't look it up" — conflating those sends whoever is debugging to
 * Meta's config while 100% of traffic is being dropped.
 *
 * Every stub records its `.eq()` filters. Without that, deleting the client_id
 * filter from a query still passes every test, which is how an isolation hole
 * ships green.
 */

import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/crm/identity', async (orig) => {
  const actual = await orig<typeof import('@/lib/crm/identity')>()
  return { ...actual, resolveContact: vi.fn() }
})
// isOptOutKeyword 保持真实实现——这里只测「命中之后接没接上」，不重测 #1575
// 已经测过的关键词判定逻辑本身；recordOptOutKeywordTouch 是唯一要断言调用
// 参数的部分（同样出于「不测 optout.ts 内部逻辑」的边界）。
vi.mock('@/lib/messenger-agent/optout', async (orig) => {
  const actual = await orig<typeof import('@/lib/messenger-agent/optout')>()
  return { ...actual, recordOptOutKeywordTouch: vi.fn() }
})
// 心跳检查（issue #1587）读的是这条落库路径本身——只断言它「被调用」，不重新
// 实现表结构；那张表的真实建模在 health-heartbeat.test.ts。
vi.mock('@/lib/messenger-agent/optout-failures', () => ({ recordOptOutWriteFailure: vi.fn() }))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }))

import { GET, POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '@/lib/crm/identity'
import { recordOptOutKeywordTouch } from '@/lib/messenger-agent/optout'
import { recordOptOutWriteFailure } from '@/lib/messenger-agent/optout-failures'
import { inngest } from '@/lib/inngest/client'
import { ConversationMessageReceivedSchema } from '@/lib/conversations/events'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockResolveContact = vi.mocked(resolveContact)
const mockRecordOptOutKeywordTouch = vi.mocked(recordOptOutKeywordTouch)
const mockRecordOptOutWriteFailure = vi.mocked(recordOptOutWriteFailure)
const mockInngestSend = vi.mocked(inngest.send)

const SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'
const PHONE_NUMBER_ID = '999888777'
const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CONTACT_ID = 'contact-uuid'
const WA_ID = '64211234567'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makePost(payload: object, opts: { signature?: string | null; rawBody?: string } = {}) {
  const raw = opts.rawBody ?? JSON.stringify(payload)
  const sig = opts.signature !== undefined ? opts.signature : sign(raw)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) headers['x-hub-signature-256'] = sig
  return new NextRequest('https://me.example.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers,
    body: raw,
  })
}

function messagePayload(
  over: Partial<{
    waId: string
    name: string
    body: string
    msgId: string
    type: string
    referral: Record<string, unknown>
    image: Record<string, unknown>
    timestamp: string
  }> = {},
  extraMessages: Record<string, unknown>[] = [],
) {
  const msg: Record<string, unknown> = {
    id: over.msgId ?? 'wamid.XYZ',
    from: over.waId ?? WA_ID,
    timestamp: over.timestamp ?? '1788336000',
    type: over.type ?? 'text',
  }
  if ((over.type ?? 'text') === 'text') msg.text = { body: over.body ?? '请问明天有团吗？' }
  if (over.referral) msg.referral = over.referral
  if (over.image) msg.image = over.image

  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ wa_id: over.waId ?? WA_ID, profile: { name: over.name ?? 'Amy' } }],
              messages: [msg, ...extraMessages],
            },
          },
        ],
      },
    ],
  }
}

interface Captured {
  convoUpserts: { row: Record<string, unknown>; opts: unknown }[]
  updates: { table: string; payload: Record<string, unknown> }[]
  msgUpserts: { row: Record<string, unknown>; opts: unknown }[]
  touchUpserts: { row: Record<string, unknown>; opts: unknown }[]
  filters: Record<string, Record<string, unknown>>
}

function stubDb(
  opts: {
    clientMapped?: boolean
    clientLookupFails?: boolean
    convoUpsertFails?: boolean
    msgUpsertFails?: boolean
    resolveContactThrows?: boolean
    optoutUnlinkedUpdateFails?: boolean
  } = {},
): Captured {
  const captured: Captured = { convoUpserts: [], msgUpserts: [], touchUpserts: [], updates: [], filters: {} }

  if (opts.resolveContactThrows) {
    mockResolveContact.mockRejectedValue(new Error('identity blew up'))
  } else {
    mockResolveContact.mockResolvedValue({ contactId: CONTACT_ID, created: true, matchedIdentities: 0 })
  }

  mockFrom.mockImplementation((table: string) => {
    let result: unknown = { data: null, error: null }
    const f = (captured.filters[table] ??= {})

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        f[col] = val
        return chain
      },
      lt: (col: string, val: unknown) => {
        f[`__lt_${col}`] = val
        return chain
      },
      is: (col: string, val: unknown) => {
        f[`__is_${col}`] = val
        return chain
      },
      single: async () => result,
      maybeSingle: async () => result,
      update: (payload: Record<string, unknown>) => {
        captured.updates.push({ table, payload })
        if (table === 'conversations' && 'optout_unlinked' in payload && opts.optoutUnlinkedUpdateFails) {
          result = { data: null, error: { message: 'optout_unlinked update failed' } }
        }
        return chain
      },
      // 真 supabase 的 builder 是 thenable：`await from(x).upsert(y)` 直接拿到
      // { data, error }。stub 少了这个，被测代码里的 error 检查全部读到 undefined，
      // 于是「写库失败」这条路永远测不到。
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      upsert: (row: Record<string, unknown>, upsertOpts: unknown) => {
        if (table === 'conversations') {
          captured.convoUpserts.push({ row, opts: upsertOpts })
          result = opts.convoUpsertFails
            ? { data: null, error: { message: 'convo upsert failed' } }
            : { data: { id: 'convo-id' }, error: null }
        } else if (table === 'conversation_messages') {
          captured.msgUpserts.push({ row, opts: upsertOpts })
          result = opts.msgUpsertFails
            ? { data: null, error: { message: 'message upsert failed' } }
            : { data: null, error: null }
        } else if (table === 'contact_touchpoints') {
          captured.touchUpserts.push({ row, opts: upsertOpts })
          result = { data: null, error: null }
        }
        return chain
      },
    }

    if (table === 'clients') {
      result = opts.clientLookupFails
        ? { data: null, error: { message: 'column "whatsapp_phone_number_id" does not exist' } }
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
  mockRecordOptOutKeywordTouch.mockResolvedValue({ touchpointId: 'tp-1' })
  mockInngestSend.mockResolvedValue({ ids: ['evt-1'] } as never)
})

describe('GET — 订阅握手', () => {
  it('mode/token/challenge 都对 → 原样回传 challenge，且钉死 text/plain', async () => {
    const req = new NextRequest(
      `https://me.example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`,
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc123')
    // 不钉 Content-Type 的话，攻击者选定的 challenge 可能被浏览器嗅探成别的东西
    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('token 不对 → 拒', async () => {
    const req = new NextRequest(
      'https://me.example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123',
    )
    expect((await GET(req)).status).toBe(403)
  })

  it('没配 META_VERIFY_TOKEN → 500，不是假装验证通过', async () => {
    delete process.env.META_VERIFY_TOKEN
    const req = new NextRequest('https://me.example.com/api/webhooks/whatsapp?hub.mode=subscribe')
    expect((await GET(req)).status).toBe(500)
  })
})

describe('POST — 签名验证', () => {
  it('签名不对 → 401，一行库都不碰', async () => {
    stubDb()
    const res = await POST(makePost(messagePayload(), { signature: 'sha256=' + '0'.repeat(64) }))
    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('没带签名头 → 401', async () => {
    expect((await POST(makePost(messagePayload(), { signature: null }))).status).toBe(401)
  })

  it('签名不是 64 位十六进制 → 401（Buffer.from 会静默截断非法字符）', async () => {
    expect((await POST(makePost(messagePayload(), { signature: 'sha256=zzzz' }))).status).toBe(401)
  })

  it('没配 META_APP_SECRET → 500', async () => {
    delete process.env.META_APP_SECRET
    expect((await POST(makePost(messagePayload()))).status).toBe(500)
  })

  it('JSON 解析不了 → 400', async () => {
    const raw = '{not valid json'
    expect((await POST(makePost({}, { rawBody: raw, signature: sign(raw) }))).status).toBe(400)
  })
})

describe('POST — 「没映射」与「查不到」必须分开', () => {
  it('号码真的没绑任何客户 → 回 200（重投也没用），但明确日志', async () => {
    const captured = stubDb({ clientMapped: false })
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(200)
    expect(captured.convoUpserts).toHaveLength(0)
  })

  it('🔴 查询本身失败（例如 migration 没跑）→ 回 503 要求 Meta 重投，绝不当成「没映射」', async () => {
    const captured = stubDb({ clientLookupFails: true })
    const res = await POST(makePost(messagePayload()))
    // 这是「我们这边坏了」，不是「这个号没人要」。回 200 会让消息永久消失。
    expect(res.status).toBe(503)
    expect(captured.convoUpserts).toHaveLength(0)
  })

  it('按 phone_number_id 查客户 —— 断言真的用这个列筛', async () => {
    const captured = stubDb()
    await POST(makePost(messagePayload()))
    expect(captured.filters.clients).toMatchObject({ whatsapp_phone_number_id: PHONE_NUMBER_ID })
  })
})

describe('POST — 消息落库', () => {
  it('新客人 → 建会话（带 contact_id）+ 落 inbound 消息 + 记 CRM 触点', async () => {
    const captured = stubDb()
    const res = await POST(makePost(messagePayload({ waId: WA_ID, name: 'Amy', body: '你好' })))

    expect(res.status).toBe(200)
    expect(captured.convoUpserts[0].row).toMatchObject({
      client_id: CLIENT_ID,
      channel: 'whatsapp',
      participant_psid: WA_ID,
      participant_name: 'Amy',
      contact_id: CONTACT_ID,
    })
    expect(captured.msgUpserts[0].row).toMatchObject({
      conversation_id: 'convo-id',
      direction: 'inbound',
      body: '你好',
      message_id: 'wamid.XYZ',
    })
    // 没有这条，会话存在但永远不出现在「今天该联系谁」里
    expect(captured.touchUpserts[0].row).toMatchObject({
      client_id: CLIENT_ID,
      contact_id: CONTACT_ID,
      channel: 'whatsapp',
      direction: 'inbound',
    })
  })

  it('会话用 (client_id, conversation_id) 做原子 upsert —— 并发投递不会双建', async () => {
    const captured = stubDb()
    await POST(makePost(messagePayload()))
    expect(captured.convoUpserts[0].opts).toMatchObject({ onConflict: 'client_id,conversation_id' })
  })

  it('消息用 (conversation_id, message_id) 做幂等 —— Meta 至少送达一次，重投不能重复入库', async () => {
    const captured = stubDb()
    await POST(makePost(messagePayload()))
    expect(captured.msgUpserts[0].opts).toMatchObject({ onConflict: 'conversation_id,message_id' })
  })

  it('排序用消息自己的时间，不是收到的时刻', async () => {
    const captured = stubDb()
    await POST(makePost(messagePayload({ timestamp: '1788336000' })))
    const expected = new Date(1788336000 * 1000).toISOString()
    expect(captured.convoUpserts[0].row).toMatchObject({ last_message_at: expected })
    expect(captured.msgUpserts[0].row).toMatchObject({ sent_at: expected })
  })

  it('广告点进来的 referral 必须接住 —— 它只在第一条消息出现一次，过后永远拿不回来', async () => {
    const captured = stubDb()
    const referral = { source_id: '120248364536030307', ctwa_clid: 'clid-abc', headline: '春季团' }
    await POST(makePost(messagePayload({ referral })))
    expect(captured.updates).toContainEqual(
      expect.objectContaining({ table: 'conversations', payload: { entry_referral: referral } }),
    )
  })

  it('没有 referral 的普通消息完全不碰这一列（不会把已存的覆盖成空）', async () => {
    const captured = stubDb()
    await POST(makePost(messagePayload()))
    expect(captured.convoUpserts[0].row).not.toHaveProperty('entry_referral')
    expect(captured.updates.filter((u) => 'entry_referral' in u.payload)).toHaveLength(0)
  })

  it('图片消息要留住 Meta 的 media id —— 30 天后原件在 Meta 那边也没了', async () => {
    const captured = stubDb()
    await POST(
      makePost(
        messagePayload({ type: 'image', image: { id: 'media-123', mime_type: 'image/jpeg', caption: '护照' } }),
      ),
    )
    expect(captured.msgUpserts[0].row).toMatchObject({ media_type: 'image', media_id: 'media-123' })
    expect(captured.msgUpserts[0].row.body).toContain('护照')
  })

  // ── 国际号码 ──────────────────────────────────────────────────────────
  // wa_id 是「带国码、不带 +」。直接丢给 normalisePhone 会走「已带国码」那条
  // 分支，而那条只认默认国家（NZ）—— 澳洲/中国/美国客人一律认不出人、不记
  // 触点、消息永远不出现在任何界面。ME 是 AU+NZ 双市场，这些用例就是换客户
  // 测试本身。
  it.each([
    ['澳大利亚', '61412345678', '+61412345678'],
    ['中国', '8613800138000', '+8613800138000'],
    ['美国', '14155551234', '+14155551234'],
    ['新西兰', '64211234567', '+64211234567'],
  ])('%s 号码的客人也要认得出来（%s）', async (_label, waId, expected) => {
    stubDb()
    await POST(makePost(messagePayload({ waId })))
    expect(mockResolveContact).toHaveBeenCalledWith(
      expect.objectContaining({
        identities: [{ kind: 'phone', value: expected }],
      }),
    )
  })

  it('归因是首触：referral 单独带 is-null 守卫补写，不进 upsert', async () => {
    const captured = stubDb()
    const referral = { source_id: 'ad-1', ctwa_clid: 'clid-1' }
    await POST(makePost(messagePayload({ referral })))
    // 不能在 upsert 里 —— 那样客人点第二条广告时会把第一条盖掉
    expect(captured.convoUpserts[0].row).not.toHaveProperty('entry_referral')
    // 必须带「只在原来是空的时候才写」这道闸，且条件在 SQL 里（并发安全）
    expect(captured.filters.conversations).toMatchObject({ __is_entry_referral: null })
  })

  it('入站触点只许往前推，不许把时间拨回去（并发投递下的回拨闸）', async () => {
    const captured = stubDb()
    const sentAt = new Date(1788336000 * 1000).toISOString()
    await POST(makePost(messagePayload()))
    expect(captured.filters.contact_touchpoints).toMatchObject({ [`__lt_occurred_at`]: sentAt })
  })

  it('身份解析挂了 → 消息照样入库（不能因为认不出人就把消息丢了）', async () => {
    const captured = stubDb({ resolveContactThrows: true })
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(200)
    expect(captured.msgUpserts).toHaveLength(1)
    expect(captured.convoUpserts[0].row).not.toHaveProperty('contact_id')
    expect(captured.touchUpserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// issue #1582：opt-out 检测 + 渠道无关事件 emit 接上了没接上。
// 不重测 optout.ts / isOptOutKeyword 内部逻辑（#1575 的范围），只断言这里
// 传的参数对不对、走对了哪条分叉。
// ---------------------------------------------------------------------------
describe('POST — opt-out 检测接入（issue #1582）', () => {
  it('命中退订关键词 + 有 contact_id → 调用 recordOptOutKeywordTouch，参数带真实消息时间', async () => {
    const captured = stubDb()
    const sentAt = new Date(1788336000 * 1000).toISOString()
    await POST(makePost(messagePayload({ body: 'STOP', msgId: 'wamid.OPTOUT' })))

    expect(mockRecordOptOutKeywordTouch).toHaveBeenCalledTimes(1)
    expect(mockRecordOptOutKeywordTouch).toHaveBeenCalledWith(
      {
        clientId: CLIENT_ID,
        contactId: CONTACT_ID,
        channel: 'whatsapp',
        conversationId: 'convo-id',
        messageId: 'wamid.OPTOUT',
        // 必须是消息自己的发送时间，不能省略参数让函数落到 `new Date()`。
        occurredAt: sentAt,
      },
      supabaseAdmin,
    )
    // 不该走会话级兜底列那条路径。
    expect(captured.updates.filter((u) => 'optout_unlinked' in u.payload)).toHaveLength(0)
  })

  it('没命中退订关键词的正常消息 → 不调用 recordOptOutKeywordTouch', async () => {
    stubDb()
    await POST(makePost(messagePayload({ body: '请问明天有团吗？' })))
    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
  })

  it('命中退订关键词 + 没解析出 contact_id → 走 conversations.optout_unlinked 兜底列，不经过 optout.ts', async () => {
    const captured = stubDb({ resolveContactThrows: true })
    await POST(makePost(messagePayload({ body: '退订' })))

    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
    const unlinkedUpdate = captured.updates.find((u) => 'optout_unlinked' in u.payload)
    expect(unlinkedUpdate).toMatchObject({
      table: 'conversations',
      payload: { optout_unlinked: true },
    })
  })

  it('退订触点写入失败（抛错）不影响消息已经落库的结果（best-effort，跟 CRM 触点一致），且心跳检查（#1587）能看到这次失败', async () => {
    mockRecordOptOutKeywordTouch.mockRejectedValue(new Error('db 抽风'))
    stubDb()
    const res = await POST(makePost(messagePayload({ body: 'stop', msgId: 'wamid.OPTOUT3' })))
    expect(res.status).toBe(200)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledTimes(1)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        channel: 'whatsapp',
        conversationId: 'convo-id',
        contactId: CONTACT_ID,
        errorMessage: expect.stringContaining('db 抽风'),
      }),
      supabaseAdmin,
    )
  })

  it('没有 contact_id 时，写 conversations.optout_unlinked 本身失败 → 仍回 200，但心跳检查（#1587）能看到这次失败', async () => {
    stubDb({ resolveContactThrows: true, optoutUnlinkedUpdateFails: true })
    const res = await POST(makePost(messagePayload({ body: '退订', msgId: 'wamid.OPTOUT4' })))

    expect(res.status).toBe(200)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledTimes(1)
    expect(mockRecordOptOutWriteFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        channel: 'whatsapp',
        contactId: null,
        errorMessage: expect.stringContaining('optout_unlinked update failed'),
      }),
      supabaseAdmin,
    )
  })
})

describe('POST — 渠道无关事件 emit（issue #1582）', () => {
  it('消息落库成功 → emit conversation/message.received，事件名字符串必须精确一致', async () => {
    stubDb()
    await POST(makePost(messagePayload({ body: '你好', msgId: 'wamid.EVT' })))

    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation/message.received',
        data: expect.objectContaining({
          channel: 'whatsapp',
          client_id: CLIENT_ID,
          conversation_id: 'convo-id',
          message_id: 'wamid.EVT',
        }),
      }),
    )
  })

  it('🔴 魏征复审（2026-09-15）：emit 出去的 data 必须真的能通过共享契约的 ConversationMessageReceivedSchema —— 之前这里发的是 body/occurred_at，字段名跟契约要求的 sent_at 完全对不上，`objectContaining` 断言从来没查过这件事，导致每一条 WhatsApp 消息在下游（F1 等）都被判定成 payload 不合法、静默丢弹，这条测试用真实 zod 契约重放一遍才抓到', async () => {
    stubDb()
    await POST(makePost(messagePayload({ body: '你好', msgId: 'wamid.SCHEMA' })))

    const call = mockInngestSend.mock.calls.find(
      ([event]) => (event as { data?: { message_id?: string } }).data?.message_id === 'wamid.SCHEMA',
    )
    expect(call).toBeDefined()
    const parsed = ConversationMessageReceivedSchema.safeParse((call![0] as { data: unknown }).data)
    expect(parsed.success).toBe(true)
  })

  it('emit 失败不影响消息已经落库的结果（best-effort）', async () => {
    mockInngestSend.mockRejectedValue(new Error('inngest 抽风'))
    stubDb()
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(200)
  })
})

describe('POST — 一条坏消息不能带走一整批', () => {
  it('批量投递里第 1 条失败 → 第 2 条仍然入库，并回 503 让 Meta 重投', async () => {
    // 第一条消息写库失败，第二条正常
    const captured = stubDb()
    let call = 0
    mockFrom.mockImplementation((table: string) => {
      let result: unknown = { data: null, error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        lt: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
        update: () => chain,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
        upsert: (row: Record<string, unknown>, o: unknown) => {
          if (table === 'conversations') {
            captured.convoUpserts.push({ row, opts: o })
            result = { data: { id: 'convo-id' }, error: null }
          } else if (table === 'conversation_messages') {
            call++
            captured.msgUpserts.push({ row, opts: o })
            result =
              call === 1
                ? { data: null, error: { message: 'boom' } }
                : { data: null, error: null }
          } else if (table === 'contact_touchpoints') {
            captured.touchUpserts.push({ row, opts: o })
            result = { data: null, error: null }
          }
          return chain
        },
      }
      if (table === 'clients') result = { data: { id: CLIENT_ID }, error: null }
      return chain as never
    })

    const second = {
      id: 'wamid.SECOND',
      from: WA_ID,
      timestamp: '1788336100',
      type: 'text',
      text: { body: '第二条' },
    }
    const res = await POST(makePost(messagePayload({ msgId: 'wamid.FIRST' }, [second])))

    // 第二条没有被第一条的失败带走
    expect(captured.msgUpserts).toHaveLength(2)
    expect(captured.msgUpserts[1].row).toMatchObject({ message_id: 'wamid.SECOND' })
    // 有东西没存下 → 不能告诉 Meta「都收到了」
    expect(res.status).toBe(503)
  })

  it('全部成功 → 200，并报告存了几条', async () => {
    stubDb()
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ received: true, stored: 1 })
  })

  it('状态回执（没有 messages 数组）→ 200，不当成错误', async () => {
    stubDb()
    const statusOnly = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: 'wamid.X', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    }
    const res = await POST(makePost(statusOnly))
    expect(res.status).toBe(200)
  })
})

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
// 无主号码登记表：这里的测试只关心路由与入库，不让它碰真表。
vi.mock('@/lib/whatsapp/unclaimed', () => ({ recordUnclaimedNumber: vi.fn() }))
vi.mock('@/lib/platform-oauth/vocabulary', () => ({
  decryptToken: vi.fn((v: string) => {
    if (v === 'enc:BAD') throw new Error('bad')
    return v.replace(/^enc:/, '')
  }),
}))

import { GET, POST } from '../route'
import { resetRejectLog } from '@/lib/whatsapp/reject-log'
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
    credRows?: { phone_number_id: string; app_secret_enc: string; status?: string }[]
    credLookupFails?: boolean // table not deployed yet (42P01)
    credLookupTransientFails?: boolean // any other lookup error
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
      in: (col: string, vals: unknown) => {
        f[`__in_${col}`] = vals
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

    if (table === 'whatsapp_app_credentials') {
      result = opts.credLookupFails
        ? { data: null, error: { code: '42P01', message: 'relation does not exist' } }
        : opts.credLookupTransientFails
          ? { data: null, error: { message: 'connection timeout' } }
          : { data: opts.credRows ?? [], error: null }
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

describe('POST — 拒收必须留一行说明（原先拒签完全没有日志）', () => {
  beforeEach(() => resetRejectLog())
  const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.flat().map(String).join(' ')

  it('拒签 → 日志只有原因码/密钥来源/个数/有无签名头，没有密钥、签名、号码、正文', async () => {
    stubDb()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badSig = 'sha256=' + '0'.repeat(64)
    const res = await POST(makePost(messagePayload(), { signature: badSig }))
    expect(res.status).toBe(401)
    const text = logged(errSpy)
    expect(text).toContain('delivery rejected: reason=signature_mismatch secret_source=env numbers=1 signature_header=present')
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(badSig)
    expect(text).not.toContain(PHONE_NUMBER_ID)
    expect(text).not.toContain('请问明天有团吗')
    errSpy.mockRestore()
  })

  it('没带签名头 → 日志写明 signature_header=absent', async () => {
    stubDb()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await POST(makePost(messagePayload(), { signature: null }))
    expect(logged(errSpy)).toContain('signature_header=absent')
    errSpy.mockRestore()
  })

  it('号码有自己的密钥、却用环境密钥签 → 日志写 secret_source=route', async () => {
    stubDb({ credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:other-app-secret' }] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(401)
    expect(logged(errSpy)).toContain('reason=signature_mismatch secret_source=route')
    errSpy.mockRestore()
  })

  it('号码格式异常 → 日志写 reason=malformed_number（响应体仍与拒签一样）', async () => {
    stubDb()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const payload = messagePayload()
    ;(payload.entry[0].changes[0].value.metadata as { phone_number_id: unknown }).phone_number_id = 999888777
    const res = await POST(makePost(payload))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(logged(errSpy)).toContain('reason=malformed_number')
    errSpy.mockRestore()
  })

  it('号码被停用 → 401，响应体不变，日志写 reason=disabled_number', async () => {
    stubDb({ credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:x', status: 'disabled' }] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(logged(errSpy)).toContain('reason=disabled_number')
    expect(logged(errSpy)).not.toContain('reason=mixed_apps')
    errSpy.mockRestore()
  })

  it('同一包里两个号码、只有一个有自己的密钥 → 401，日志写 reason=mixed_apps', async () => {
    stubDb({ credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:x' }] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const payload = messagePayload()
    const second = JSON.parse(JSON.stringify(payload.entry[0].changes[0]))
    second.value.metadata.phone_number_id = '111222333'
    payload.entry[0].changes.push(second)
    const res = await POST(makePost(payload))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(logged(errSpy)).toContain('reason=mixed_apps')
    errSpy.mockRestore()
  })

  it('密钥读不出来 → 500，响应体不变，日志写 reason=secret_unreadable', async () => {
    stubDb({ credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:BAD' }] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Server misconfiguration: webhook secret unreadable' })
    expect(logged(errSpy)).toContain('reason=secret_unreadable')
    errSpy.mockRestore()
  })

  it('拒签的响应体仍是 Invalid signature', async () => {
    stubDb()
    const res = await POST(makePost(messagePayload(), { signature: 'sha256=' + '0'.repeat(64) }))
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
  })

  it('密钥表瞬时出错 → 503 且日志写 reason=lookup_unavailable', async () => {
    stubDb({ credLookupTransientFails: true })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Credential lookup unavailable' })
    expect(logged(errSpy)).toContain('reason=lookup_unavailable secret_source=env')
    errSpy.mockRestore()
  })
})

describe('POST — 签名验证', () => {
  it('签名不对 → 401，只读密钥表，客户/会话/消息表一行都不碰', async () => {
    stubDb()
    const res = await POST(makePost(messagePayload(), { signature: 'sha256=' + '0'.repeat(64) }))
    expect(res.status).toBe(401)
    // 选密钥要先读 whatsapp_app_credentials（只读）；除此之外任何表都不许碰。
    expect(mockFrom.mock.calls.map((c) => c[0])).toEqual(['whatsapp_app_credentials'])
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
        in: () => chain,
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

/**
 * 🔴 魏征复审 2026-09-28，实测确认后修：**WhatsApp 昵称不许盖掉库里已有的真名。**
 *
 * `resolveContact` 的 `renameOk` 默认 true（`lib/crm/identity.ts:249`），所以不显式
 * 关掉的话，每一条 WhatsApp 消息都会把 `contacts.display_name` 改写成客人自设的
 * WhatsApp 昵称。这里传进去的 identity 只有电话号，命中的往往是早就存在的老联系人
 * —— CTS 库里 774 条表单留资 + 642 通电话的人，报名时填的真名会被表情 / 小名静默
 * 覆盖，且原名不可恢复。
 *
 * 两条都要：传了那个开关，**而且**名字本身照旧传过去（首次建人靠它，
 * `identity.ts:203` 的 insert 路径不看 renameOk）。少了后半条，新客人会变成无名氏。
 */
describe('POST — 不许用 WhatsApp 昵称盖掉已有的名字', () => {
  it('调 resolveContact 时明确传 overwriteDisplayName: false', async () => {
    stubDb()
    await POST(makePost(messagePayload({ waId: WA_ID, name: '🌸小美🌸', body: '你好' })))

    expect(mockResolveContact).toHaveBeenCalledWith(
      expect.objectContaining({ overwriteDisplayName: false }),
    )
  })

  it('名字照旧传过去 —— 首次建人要靠它，不能连带把新客人变成无名氏', async () => {
    stubDb()
    await POST(makePost(messagePayload({ waId: WA_ID, name: '🌸小美🌸', body: '你好' })))

    expect(mockResolveContact).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: '🌸小美🌸' }),
    )
  })
})

// ---------------------------------------------------------------------------
// 每个号码用自己的 app secret 验签（whatsapp_app_credentials）。
// 号码列表只从「未验签」的 body 里读出来决定用哪把钥匙；只有那把钥匙的签名
// 对得上才会继续处理。混用 / 未知组合一律拒，一把 app 的 secret 绝不能替
// 另一个 app 的号码背书。
// ---------------------------------------------------------------------------
describe('per-app signature secret', () => {
  const NAL_SECRET = 'nal-app-secret'

  function signWith(secret: string, body: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  }

  it('号码有自己的 secret 行 → 用 NAL_SECRET 签名 → 200 且落库', async () => {
    const captured = stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET }],
    })
    const raw = JSON.stringify(messagePayload())
    const res = await POST(makePost(messagePayload(), { signature: signWith(NAL_SECRET, raw) }))
    expect(res.status).toBe(200)
    expect(captured.msgUpserts).toHaveLength(1)
  })

  it('号码有自己的 app → 用 env SECRET 签名 → 401（env secret 不能替它背书）', async () => {
    stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET }],
    })
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(401)
  })

  it('号码没有行 → env SECRET 签名 → 200（CTS 不变）；NAL_SECRET 签名 → 401', async () => {
    stubDb()
    const ok = await POST(makePost(messagePayload()))
    expect(ok.status).toBe(200)

    const raw = JSON.stringify(messagePayload())
    const bad = await POST(makePost(messagePayload(), { signature: signWith(NAL_SECRET, raw) }))
    expect(bad.status).toBe(401)
  })

  it('混合 payload（一个有行、一个没行）→ 用任一 secret 签名都 401', async () => {
    stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET }],
    })
    const base = messagePayload()
    const other = messagePayload()
    const otherChange = other.entry[0].changes[0]
    otherChange.value.metadata.phone_number_id = '111222333'
    const mixed = {
      entry: [{ changes: [base.entry[0].changes[0], otherChange] }],
    }

    const raw = JSON.stringify(mixed)
    expect((await POST(makePost(mixed, { signature: signWith(NAL_SECRET, raw) }))).status).toBe(401)
    expect((await POST(makePost(mixed, { signature: signWith(SECRET, raw) }))).status).toBe(401)
  })

  it('两个号码各有不同 secret → 401；两个号码共用同一 secret 并用它签名 → 200', async () => {
    const different = stubDb({
      credRows: [
        { phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET },
        { phone_number_id: '111222333', app_secret_enc: 'enc:other-secret' },
      ],
    })
    const base = messagePayload()
    const other = messagePayload()
    const otherChange = other.entry[0].changes[0]
    otherChange.value.metadata.phone_number_id = '111222333'
    const twoNumbers = {
      entry: [{ changes: [base.entry[0].changes[0], otherChange] }],
    }
    const rawTwo = JSON.stringify(twoNumbers)
    expect((await POST(makePost(twoNumbers, { signature: signWith(NAL_SECRET, rawTwo) }))).status).toBe(401)
    expect(different.msgUpserts).toHaveLength(0)

    const shared = stubDb({
      credRows: [
        { phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET },
        { phone_number_id: '111222333', app_secret_enc: 'enc:' + NAL_SECRET },
      ],
    })
    const res = await POST(makePost(twoNumbers, { signature: signWith(NAL_SECRET, rawTwo) }))
    expect(res.status).toBe(200)
    expect(shared.msgUpserts.length).toBeGreaterThan(0)
  })

  it('表没建（credLookupFails）→ env SECRET 签名 → 200（表缺失不能弄坏 CTS）；错误 secret → 503', async () => {
    stubDb({ credLookupFails: true })
    expect((await POST(makePost(messagePayload()))).status).toBe(200)

    const raw = JSON.stringify(messagePayload())
    const res = await POST(makePost(messagePayload(), { signature: signWith(NAL_SECRET, raw) }))
    expect(res.status).toBe(503)
  })

  it('密钥表查询瞬时出错（不是表没建）→ 即使用环境密钥签对也 503，不放行', async () => {
    stubDb({ credLookupTransientFails: true })
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(503)
  })

  it('号码的密钥行被停用 → 401，环境密钥不能替它背书', async () => {
    stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET, status: 'disabled' }],
    })
    expect((await POST(makePost(messagePayload()))).status).toBe(401)
    const raw = JSON.stringify(messagePayload())
    expect((await POST(makePost(messagePayload(), { signature: signWith(NAL_SECRET, raw) }))).status).toBe(401)
  })

  it('phone_number_id 是数字（未加引号）→ 401', async () => {
    stubDb()
    const payload = messagePayload()
    ;(payload.entry[0].changes[0].value.metadata as { phone_number_id: unknown }).phone_number_id = 999888777
    const res = await POST(makePost(payload))
    expect(res.status).toBe(401)
  })

  it('21 个不同号码 → 401', async () => {
    stubDb()
    const changes = Array.from({ length: 21 }, (_, i) => {
      const p = messagePayload()
      p.entry[0].changes[0].value.metadata.phone_number_id = String(100000000 + i)
      return p.entry[0].changes[0]
    })
    const res = await POST(makePost({ entry: [{ changes }] }))
    expect(res.status).toBe(401)
  })

  it('body 恰好 5,000,000 字节不算超限（继续走验签，坏签名 → 401 而不是 413）', async () => {
    stubDb()
    const big = 'x'.repeat(5_000_000)
    const res = await POST(makePost({}, { rawBody: big, signature: 'sha256=' + '0'.repeat(64) }))
    expect(res.status).toBe(401)
  })

  it('body 超过 5,000,000 字节 → 413，且不查 whatsapp_app_credentials', async () => {
    stubDb()
    const big = 'x'.repeat(5_000_001)
    const raw = JSON.stringify({ entry: [], pad: big })
    const res = await POST(makePost({}, { rawBody: raw, signature: sign(raw) }))
    expect(res.status).toBe(413)
    expect(mockFrom).not.toHaveBeenCalledWith('whatsapp_app_credentials')
  })

  it('行里是 enc:BAD → 500', async () => {
    stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:BAD' }],
    })
    const res = await POST(makePost(messagePayload()))
    expect(res.status).toBe(500)
  })

  it('per-app secret 绝不进日志', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET }],
    })
    const raw = JSON.stringify(messagePayload())
    await POST(makePost(messagePayload(), { signature: signWith(NAL_SECRET, raw) }))

    stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET }],
    })
    await POST(makePost(messagePayload()))

    const allArgs = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat()
    for (const arg of allArgs) {
      expect(String(arg)).not.toContain(NAL_SECRET)
    }

    errorSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('凭据查询用 whatsapp_app_credentials 表，号码在 __in_phone_number_id 过滤里', async () => {
    const captured = stubDb({
      credRows: [{ phone_number_id: PHONE_NUMBER_ID, app_secret_enc: 'enc:' + NAL_SECRET }],
    })
    const raw = JSON.stringify(messagePayload())
    await POST(makePost(messagePayload(), { signature: signWith(NAL_SECRET, raw) }))

    expect(mockFrom).toHaveBeenCalledWith('whatsapp_app_credentials')
    expect(captured.filters.whatsapp_app_credentials).toMatchObject({
      __in_phone_number_id: [PHONE_NUMBER_ID],
    })
  })
})

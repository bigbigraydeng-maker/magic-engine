/**
 * 从 CRM 里回邮件。
 *
 * 钉的是四件事：
 *   1. 隔离——conversation 必须真的属于喊它的那个客户，渠道必须真的是邮件
 *   2. 回复用的 id 必须是 createReply 给的真实 id，不能编一个，否则下次
 *      每小时同步会把这封刚发的信当成新信，插出重复的一行
 *   3. 回信对象只认客人最后一次开口那一封——回自己发的那封会把客人漏成收件人
 *   4. 令牌按对话所在的那个邮箱取，不是「客户最新连的那个」；401 会强刷重试一次
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/platform-oauth/token-manager', () => ({
  getValidTokenForConnection: vi.fn(),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { sendMailReply } from '../mail-send'

const INPUT = { clientId: 'c1', conversationId: 'cv1', body: '好的，帮您留位', sentByEmail: 'amy@nal.co.nz' }

interface DbOpts {
  conversation?: { id: string; client_id: string; channel: string; contact_id: string | null; page_id: string | null } | null
  lastInboundMessageId?: string | null
  connection?: { id: string } | null
  auditInsertError?: { message: string } | null
}

let inserted: Record<string, unknown>[]
let touchpointUpserts: Record<string, unknown>[]
let updatedConversation: Record<string, unknown> | null
let auditInserted: Record<string, unknown>[]
let auditUpdates: Record<string, unknown>[]
let connectionQueryFilters: Record<string, unknown>
let messageQueryFilters: Record<string, unknown>

function mockDb(opts: DbOpts) {
  inserted = []
  touchpointUpserts = []
  updatedConversation = null
  auditInserted = []
  auditUpdates = []
  connectionQueryFilters = {}
  messageQueryFilters = {}
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.conversation ?? null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updatedConversation = patch
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === 'conversation_messages') {
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            messageQueryFilters[col] = val
            return {
              eq: (col2: string, val2: unknown) => {
                messageQueryFilters[col2] = val2
                return {
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: opts.lastInboundMessageId ? { message_id: opts.lastInboundMessageId } : null,
                      }),
                    }),
                  }),
                }
              },
            }
          },
        }),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row)
          return { data: null, error: null }
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        upsert: async (row: Record<string, unknown>) => {
          touchpointUpserts.push(row)
          return { data: null, error: null }
        },
      }
    }
    if (table === 'platform_oauth_connections') {
      const chain = {
        eq: (col: string, val: unknown) => {
          connectionQueryFilters[col] = val
          return chain
        },
        maybeSingle: async () => ({ data: opts.connection ?? null }),
      }
      return { select: () => chain }
    }
    if (table === 'conversation_outbound_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          auditInserted.push(row)
          return {
            select: () => ({
              single: async () => ({
                data: opts.auditInsertError ? null : { id: `audit-${auditInserted.length}` },
                error: opts.auditInsertError ?? null,
              }),
            }),
          }
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            auditUpdates.push(patch)
            return { data: null, error: null }
          },
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

function mockGraph(steps: {
  createReply?: Array<{ ok: boolean; status?: number; id?: string }>
  send?: Array<{ ok: boolean; status?: number }>
}) {
  const createReplySteps = [...(steps.createReply ?? [{ ok: true, id: 'draft-1' }])]
  const sendSteps = [...(steps.send ?? [{ ok: true }])]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/createReply')) {
        const s = createReplySteps.shift() ?? createReplySteps[createReplySteps.length - 1]
        return {
          ok: s.ok,
          status: s.status ?? (s.ok ? 201 : 400),
          json: async () => ({ id: s.id }),
          text: async () => 'createReply failed',
        }
      }
      if (String(url).includes('/send')) {
        const s = sendSteps.shift() ?? sendSteps[sendSteps.length - 1]
        return {
          ok: s.ok,
          status: s.status ?? (s.ok ? 202 : 400),
          json: async () => ({}),
          text: async () => 'send failed',
        }
      }
      throw new Error(`unexpected url ${url}`)
    }),
  )
}

const CONNECTED = { id: 'cv1', client_id: 'c1', channel: 'email', contact_id: 'p1', page_id: 'info@nal.co.nz' }
const CONNECTION = { id: 'conn-1' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getValidTokenForConnection as ReturnType<typeof vi.fn>).mockResolvedValue('tok-1')
})

afterEach(() => vi.unstubAllGlobals())

describe('回复内容校验', () => {
  it('空内容直接拒绝，不发网络请求', async () => {
    mockDb({})
    const r = await sendMailReply({ ...INPUT, body: '   ' })
    expect(r).toMatchObject({ ok: false, status: 400, reason: 'empty_body' })
  })
})

describe('隔离', () => {
  it('对话不存在 → 404', async () => {
    mockDb({ conversation: null })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 404, reason: 'not_found' })
  })

  it('对话属于别的客户 → 403，绝不跨客户发信', async () => {
    mockDb({ conversation: { ...CONNECTED, client_id: 'OTHER' } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 403, reason: 'wrong_client' })
  })

  it('不是邮件渠道 → 409，不能拿私信线程去调 Graph', async () => {
    mockDb({ conversation: { ...CONNECTED, channel: 'messenger' } })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 409, reason: 'wrong_channel' })
  })
})

describe('回信对象只认客人最后一次开口', () => {
  it('线程里一封客人来信都没有 → 409，不猜、不回给别人', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: null })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 409, reason: 'no_thread' })
  })

  it('查最新一封时只认客人发来的（direction=inbound），不含我们自己发的', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({})
    await sendMailReply(INPUT)
    expect(messageQueryFilters.direction).toBe('inbound')
  })
})

describe('令牌按对话所在的那个邮箱取', () => {
  it('对话没有归属的邮箱 → 424，不瞎猜用哪个连接', async () => {
    mockDb({ conversation: { ...CONNECTED, page_id: null }, lastInboundMessageId: 'm-in' })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 424, reason: 'no_token' })
  })

  it('按 client_id + 邮箱地址（page_id）查连接，不是「客户最新那条」', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({})
    await sendMailReply(INPUT)
    expect(connectionQueryFilters).toMatchObject({ client_id: 'c1', account_id: 'info@nal.co.nz' })
  })

  it('这个邮箱没有有效连接 → 424，说清楚是授权问题', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: null })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 424, reason: 'no_token' })
  })

  it('Graph 回 401（令牌被收回但缓存还没到期）→ 强刷一次再重试，重试成功就当没事发生', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: false, status: 401 }, { ok: true, id: 'g-retry' }] })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: true, messageId: 'g-retry' })
    expect(getValidTokenForConnection).toHaveBeenCalledWith('conn-1', { forceRefresh: true })
  })

  it('强刷之后还是 401 → 老老实实报失败，不再猜第三次', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: false, status: 401 }, { ok: false, status: 401 }] })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'graph_failed' })
  })
})

describe('发送', () => {
  it('成功 → 用 createReply 给的真实 id，不是编出来的', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'real-graph-id-9' }] })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: true, messageId: 'real-graph-id-9' })
    expect(inserted[0]).toMatchObject({ conversation_id: 'cv1', message_id: 'real-graph-id-9', direction: 'outbound' })
  })

  it('成功后立刻更新会话的最后消息时间，不等下一次同步', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g1' }] })
    await sendMailReply(INPUT)
    expect(updatedConversation).toMatchObject({ last_message_from: 'page' })
  })

  it('回信对象已经认了人 → 补一笔触点，幂等键跟同步用的一样', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g2' }] })
    await sendMailReply(INPUT)
    expect(touchpointUpserts[0]).toMatchObject({
      contact_id: 'p1',
      channel: 'email',
      direction: 'outbound',
      source: 'microsoft_mail',
      source_ref: 'g2',
    })
  })

  it('对话还没认到人 → 不写触点，也不报错', async () => {
    mockDb({ conversation: { ...CONNECTED, contact_id: null }, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g3' }] })
    const r = await sendMailReply(INPUT)
    expect(r.ok).toBe(true)
    expect(touchpointUpserts).toHaveLength(0)
  })

  it('建草稿失败 → 502，不假装发出去了', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: false, status: 400 }] })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'graph_failed' })
    expect(inserted).toHaveLength(0)
  })

  it('草稿建好了但发送那一步失败 → 502，且不写进时间线（没真的发出去）', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g4' }], send: [{ ok: false, status: 500 }] })
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'graph_failed' })
    expect(inserted).toHaveLength(0)
  })
})

describe('发送审计（跟私信同一张表、同一个原则）', () => {
  it('调 Graph 之前先插一行 pending —— 中途崩溃也查得出谁试过发', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g5' }] })
    await sendMailReply(INPUT)
    expect(auditInserted[0]).toMatchObject({
      conversation_id: 'cv1',
      client_id: 'c1',
      sent_by_email: INPUT.sentByEmail,
      status: 'pending',
      messaging_type: 'email',
    })
  })

  it('发成功 → 审计回填成 sent，带上真实的 Graph 消息 id', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g6' }] })
    await sendMailReply(INPUT)
    expect(auditUpdates[0]).toMatchObject({ status: 'sent', meta_message_id: 'g6' })
  })

  it('建草稿失败 → 审计回填成 failed，带上原因', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: false, status: 400 }] })
    await sendMailReply(INPUT)
    expect(auditUpdates[0]).toMatchObject({ status: 'failed' })
  })

  it('发送那一步失败 → 审计也回填成 failed，不是停在 pending 里', async () => {
    mockDb({ conversation: CONNECTED, lastInboundMessageId: 'm-in', connection: CONNECTION })
    mockGraph({ createReply: [{ ok: true, id: 'g7' }], send: [{ ok: false, status: 500 }] })
    await sendMailReply(INPUT)
    expect(auditUpdates[0]).toMatchObject({ status: 'failed' })
  })

  it('审计这一行插不进去 → 直接拒发，不调 Graph（宁可不发也不留断档）', async () => {
    mockDb({
      conversation: CONNECTED,
      lastInboundMessageId: 'm-in',
      connection: CONNECTION,
      auditInsertError: { message: 'db down' },
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await sendMailReply(INPUT)
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'audit_failed' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

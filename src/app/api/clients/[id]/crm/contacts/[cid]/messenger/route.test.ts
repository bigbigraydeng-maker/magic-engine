/**
 * 「这个人能不能在 CRM 里当场回私信」这个读接口的测试。
 *
 * 它本身不发消息，但它的答案直接决定销售面前**出不出现一个发送框**，所以
 * 三件事错不得：
 *
 *   1. 回复窗口必须从**客人**最后一次说话算起。按会话的最后活动时间算，
 *      我们自己刚发的那条会凭空多出 24 小时 —— 销售以为还能回，打完字被
 *      Meta 拒掉；反过来，我们回过之后就判成「不能回」，则是白白挡掉一次
 *      本来合法的跟进。
 *   2. 隔离：查会话必须同时带上 client_id。
 *   3. 一个人可能有多条私信线（换过页面、合并过身份）—— 要回最新那条，
 *      那才是他还在说话的地方。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({
    ok: true,
    allowedClientId: 'client-a',
    user: { email: 'sales@cts.co.nz' },
  })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const NOW = Date.now()
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

/** 查会话时用到的过滤条件和排序 —— 隔离与「取最新那条」都靠它验证。 */
let convoFilters: Record<string, unknown>
let convoOrder: { column: string; ascending: boolean } | null
/** 取客人最后一句时用的过滤条件 —— 必须限定 inbound。 */
let messageFilters: Record<string, unknown>

function mockDb(opts: {
  convo?: { id: string; participant_name: string | null } | null
  lastInboundAt?: string | null
}) {
  convoFilters = {}
  convoOrder = null
  messageFilters = {}
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      const chain = {
        eq: (col: string, val: unknown) => {
          convoFilters[col] = val
          return chain
        },
        order: (column: string, o: { ascending: boolean }) => {
          convoOrder = { column, ascending: o.ascending }
          return chain
        },
        limit: () => chain,
        maybeSingle: async () => ({ data: opts.convo ?? null, error: null }),
      }
      return { select: () => chain }
    }
    if (table === 'conversation_messages') {
      const chain = {
        eq: (col: string, val: unknown) => {
          messageFilters[col] = val
          return chain
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: opts.lastInboundAt ? { sent_at: opts.lastInboundAt } : null,
          error: null,
        }),
      }
      return { select: () => chain }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const call = () =>
  GET(new NextRequest('http://x/api'), { params: { id: 'client-a', cid: 'contact-1' } })

beforeEach(() => vi.clearAllMocks())

describe('有没有私信线', () => {
  it('没有会话 → 明确回 null，抽屉里不出现发送框', async () => {
    mockDb({ convo: null })
    const json = await (await call()).json()
    expect(json.conversationId).toBeNull()
  })

  it('有会话 → 回会话 id 和客人在 Facebook 上的名字', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: 'Susan Lee' }, lastInboundAt: hoursAgo(2) })
    const json = await (await call()).json()
    expect(json).toMatchObject({ conversationId: 'cv-1', participantName: 'Susan Lee' })
  })

  it('一个人有多条私信线 → 取最新的那条（他还在说话的地方）', async () => {
    mockDb({ convo: { id: 'cv-new', participant_name: null }, lastInboundAt: hoursAgo(1) })
    await call()
    expect(convoOrder).toEqual({ column: 'last_message_at', ascending: false })
  })
})

describe('回复窗口 —— 从客人最后一次说话算起', () => {
  it('客人 2 小时前说过话 → 还在 24 小时自由回复窗口里', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null }, lastInboundAt: hoursAgo(2) })
    const json = await (await call()).json()
    expect(json.replyWindow.kind).toBe('standard')
    expect(json.replyWindow.msRemaining).toBeGreaterThan(0)
  })

  it('客人 3 天前说的 → 掉进人工客服窗口，不再是自由回复', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null }, lastInboundAt: hoursAgo(72) })
    const json = await (await call()).json()
    expect(json.replyWindow.kind).toBe('human_agent')
  })

  it('客人 10 天前说的 → 窗口关了，发送框会挡下来', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null }, lastInboundAt: hoursAgo(240) })
    const json = await (await call()).json()
    expect(json.replyWindow).toEqual({ kind: 'closed', msRemaining: 0 })
  })

  it('客人从没说过话（只有我们发的）→ 窗口是关的，不能主动私信', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null }, lastInboundAt: null })
    const json = await (await call()).json()
    expect(json.replyWindow.kind).toBe('closed')
  })

  /**
   * 这条是整份测试的重点：算窗口只能看**客人发来的**消息。
   * 少了 direction=inbound 这个条件，我们自己刚回的那条就会被当成客人说话，
   * 窗口凭空重开 24 小时。
   */
  it('算窗口时只认客人发来的消息 —— 不能拿我们自己发的那条重开窗口', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null }, lastInboundAt: hoursAgo(2) })
    await call()
    expect(messageFilters.direction).toBe('inbound')
    expect(messageFilters.conversation_id).toBe('cv-1')
  })
})

describe('隔离', () => {
  it('查会话时必须同时带上 client_id 和这个人 —— 不能只按 contact_id 捞', async () => {
    mockDb({ convo: { id: 'cv-1', participant_name: null }, lastInboundAt: hoursAgo(1) })
    await call()
    expect(convoFilters.client_id).toBe('client-a')
    expect(convoFilters.contact_id).toBe('contact-1')
  })

  it('没有这个客户的权限 → 原样返回鉴权失败，不泄露有没有这条会话', async () => {
    const { requirePaidClientAccess } = await import('@/lib/auth/client-access')
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'not a member',
    })
    const res = await call()
    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

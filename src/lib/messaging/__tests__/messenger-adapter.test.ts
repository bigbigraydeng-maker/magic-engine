/**
 * Messenger 适配器。
 *
 * 它是总线的第一条线，也是所有后续适配器（WhatsApp / 邮件 / 短信）的样板。
 * 所以这里钉的不只是 Messenger 的行为，更是**每个适配器都必须遵守的形状**：
 *
 *   1. 窗口从**客人**最后一次说话算起 —— 不是我们发的那条
 *   2. 联系不上（没有会话）= 明确关闭，不是「还没试过」
 *   3. 底层的错误码要翻成**人话**，页面直接拿去显示
 *   4. 不新增发送能力 —— 底下走的还是已经上线的那条带审计的路
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/messenger/send', async (orig) => {
  const actual = await orig<typeof import('@/lib/messenger/send')>()
  return { ...actual, sendReply: vi.fn() }
})

import { supabaseAdmin } from '@/lib/supabase'
import { sendReply } from '@/lib/messenger/send'
import { messengerAdapter } from '../adapters/messenger'

const HOUR = 3_600_000
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString()

/** 记下查会话时用过的过滤条件 —— 隔离和「取最新那条」都靠它验证。 */
let convoFilters: Record<string, unknown>
let messageFilters: Record<string, unknown>

function mockDb(opts: { conversationId?: string | null; lastInboundAt?: string | null; convoCount?: number }) {
  convoFilters = {}
  messageFilters = {}
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      const chain = {
        eq: (col: string, val: unknown) => {
          convoFilters[col] = val
          return chain
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: opts.conversationId ? { id: opts.conversationId } : null,
        }),
        then: undefined,
      }
      return {
        select: (_cols: string, o?: { head?: boolean }) =>
          o?.head
            ? { eq: () => ({ eq: async () => ({ count: opts.convoCount ?? 0 }) }) }
            : chain,
      }
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
        }),
      }
      return { select: () => chain }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => vi.clearAllMocks())

describe('这个客户接没接 Messenger', () => {
  it('名下有会话 → 算接通了', async () => {
    mockDb({ convoCount: 515 })
    expect(await messengerAdapter.isConnected('c1')).toBe(true)
  })

  it('一条会话都没有 → 没接通，页面不该给他一个点了没用的输入框', async () => {
    mockDb({ convoCount: 0 })
    expect(await messengerAdapter.isConnected('c1')).toBe(false)
  })
})

describe('窗口', () => {
  it('客人 2 小时前说过话 → 现在能自由回', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(2) })
    expect(await messengerAdapter.window('c1', 'p1')).toMatchObject({ kind: 'open' })
  })

  /** 24 小时 / 7 天的区别是 Meta 的内部规则，销售不需要知道 —— 都是「能回」。 */
  it('客人 3 天前说的（人工客服窗口）→ 对上层仍然是「能回」', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(72) })
    expect((await messengerAdapter.window('c1', 'p1')).kind).toBe('open')
  })

  it('客人 10 天前说的 → 关了', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(240) })
    expect(await messengerAdapter.window('c1', 'p1')).toEqual({ kind: 'closed', msRemaining: 0 })
  })

  /** Meta 不允许主动开口。所以「没聊过」是关着，不是「还没试过」。 */
  it('从没在 Messenger 上聊过 → 关着，不是待定', async () => {
    mockDb({ conversationId: null })
    expect((await messengerAdapter.window('c1', 'p1')).kind).toBe('closed')
  })

  it('算窗口只认客人发来的消息 —— 不能拿我们自己回的那条重开窗口', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(2) })
    await messengerAdapter.window('c1', 'p1')
    expect(messageFilters.direction).toBe('inbound')
  })

  it('查会话时带上 client_id 和渠道 —— 不能只按 contact_id 捞', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    await messengerAdapter.window('c1', 'p1')
    expect(convoFilters).toMatchObject({ client_id: 'c1', contact_id: 'p1', channel: 'messenger' })
  })
})

describe('发送', () => {
  it('发成功 → 带回 Meta 的消息 id', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      metaMessageId: 'mid-9',
      window: 'standard',
    })
    expect(await messengerAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' }))
      .toMatchObject({ ok: true, externalMessageId: 'mid-9' })
  })

  it('没有会话 → 不调用发送，明确说发不了', async () => {
    mockDb({ conversationId: null })
    const r = await messengerAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'no_address' })
    expect(sendReply).not.toHaveBeenCalled()
  })

  /** 页面直接显示这句话，所以它必须是人话、而且带下一步该怎么办。 */
  it('窗口关了 → 翻成人话，并告诉他改用什么', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 409, reason: 'window_closed', error: 'outside window',
    })
    const r = await messengerAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'window_closed' })
    expect(r.ok === false && r.reason).toContain('电话')
  })

  it('授权掉线 → 说清楚是授权问题，不是「发失败了再试试」', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 424, reason: 'no_token', error: 'no token',
    })
    const r = await messengerAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'not_connected' })
    expect(r.ok === false && r.reason).toContain('授权')
  })

  it('拒联复核未完成 → 作为受治理拒绝返回，不伪装成窗口关闭', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      reason: 'dnc_review_required',
      error: '客户可能要求停止联系，请先核对',
    })
    const r = await messengerAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'rejected' })
    expect(r.ok === false && r.reason).toContain('先核对')
  })

  /** 审计要答得出「这句话是谁说的」—— 发送人必须原样传下去。 */
  it('把按发送的人传给底层审计', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendReply as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, metaMessageId: null, window: 'standard' })
    await messengerAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'amy@cts.co.nz' })
    expect(sendReply).toHaveBeenCalledWith(
      expect.objectContaining({ sentByEmail: 'amy@cts.co.nz', conversationId: 'cv1' }),
    )
  })
})

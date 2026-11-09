/**
 * WhatsApp 适配器测试 —— 照 `messenger-adapter.test.ts` 的形状写（那份文件头
 * 说自己是「每个适配器都必须遵守的形状」）。跟那份的唯一实质差异是窗口语义：
 * WhatsApp 只有一档（24 小时开/关），没有 Messenger 的 7 天 human_agent 续期。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/whatsapp/send', async (orig) => {
  const actual = await orig<typeof import('@/lib/whatsapp/send')>()
  return { ...actual, sendWhatsApp: vi.fn() }
})

import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsApp } from '@/lib/whatsapp/send'
import { whatsappAdapter } from '../adapters/whatsapp'

const HOUR = 3_600_000
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString()

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
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: opts.conversationId ? { id: opts.conversationId } : null }).then(resolve),
        maybeSingle: async () => ({
          data: opts.conversationId ? { id: opts.conversationId } : null,
        }),
      }
      return {
        // head:true 是 isConnected 的计数查询。按**列名**建模，不是按 eq 调用次数
        // ——后者眼下也能红，但红的原因是「调用次数变了」而不是「筛错了列」，
        // 将来合法地多加一个过滤条件就会莫名其妙失败。
        select: (_cols: string, o?: { head?: boolean }) => {
          if (!o?.head) return chain
          const countChain: Record<string, unknown> = {
            eq: (col: string, val: unknown) => {
              convoFilters[col] = val
              return countChain
            },
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ count: opts.convoCount ?? 0 }).then(resolve),
          }
          return countChain
        },
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

describe('这个客户接没接 WhatsApp', () => {
  it('名下有会话 → 算接通了', async () => {
    mockDb({ convoCount: 3 })
    expect(await whatsappAdapter.isConnected('c1')).toBe(true)
  })

  it('一条会话都没有 → 没接通', async () => {
    mockDb({ convoCount: 0 })
    expect(await whatsappAdapter.isConnected('c1')).toBe(false)
  })

  it('判断接没接通时同时筛客户和渠道 —— 少一个就会把别人的会话算进来', async () => {
    mockDb({ convoCount: 3 })
    await whatsappAdapter.isConnected('c1')
    expect(convoFilters).toMatchObject({ client_id: 'c1', channel: 'whatsapp' })
  })
})

describe('窗口', () => {
  it('客人 2 小时前说过话 → 现在能自由回', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(2) })
    expect(await whatsappAdapter.window('c1', 'p1')).toMatchObject({ kind: 'open' })
  })

  /** 跟 Messenger 不同的那一条：WhatsApp 没有 7 天续期档，24 小时一过就只能发模板。 */
  it('客人 3 天前说的 → 对 WhatsApp 已经关了（Messenger 这时候还能回）', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(72) })
    expect((await whatsappAdapter.window('c1', 'p1')).kind).toBe('template')
  })

  it('从没在 WhatsApp 上聊过 → 关着，不是待定', async () => {
    mockDb({ conversationId: null })
    expect((await whatsappAdapter.window('c1', 'p1')).kind).toBe('closed')
  })

  it('算窗口只认客人发来的消息', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(2) })
    await whatsappAdapter.window('c1', 'p1')
    expect(messageFilters.direction).toBe('inbound')
  })

  it('查会话时带上 client_id 和渠道', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    await whatsappAdapter.window('c1', 'p1')
    expect(convoFilters).toMatchObject({ client_id: 'c1', contact_id: 'p1', channel: 'whatsapp' })
  })
})

describe('发送', () => {
  it('发成功 → 带回 WhatsApp 的消息 id', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendWhatsApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      whatsappMessageId: 'wamid-9',
      window: 'open',
    })
    expect(await whatsappAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' }))
      .toMatchObject({ ok: true, externalMessageId: 'wamid-9' })
  })

  it('没有会话 → 不调用发送，明确说发不了', async () => {
    mockDb({ conversationId: null })
    const r = await whatsappAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'no_address' })
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it('窗口关了 → 翻成人话，提到模板消息这个选项', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendWhatsApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 409, reason: 'window_closed', error: 'outside window',
    })
    const r = await whatsappAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'window_closed' })
    expect(r.ok === false && r.reason).toContain('模板')
  })

  it('授权掉线 → 说清楚是授权问题', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendWhatsApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 424, reason: 'no_token', error: 'no token',
    })
    const r = await whatsappAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'a@b.c' })
    expect(r).toMatchObject({ ok: false, code: 'not_connected' })
    expect(r.ok === false && r.reason).toContain('授权')
  })

  it('把按发送的人传给底层审计', async () => {
    mockDb({ conversationId: 'cv1', lastInboundAt: hoursAgo(1) })
    ;(sendWhatsApp as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, whatsappMessageId: null, window: 'open' })
    await whatsappAdapter.send({ clientId: 'c1', contactId: 'p1', body: 'hi', sentByEmail: 'amy@cts.co.nz' })
    expect(sendWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ sentByEmail: 'amy@cts.co.nz', conversationId: 'cv1' }),
    )
  })
})

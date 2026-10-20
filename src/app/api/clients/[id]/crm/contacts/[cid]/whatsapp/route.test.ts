import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a' })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

let draftFilters: Record<string, unknown>
function mockDb(opts: {
  convo?: { id: string; participant_name: string | null } | null
  lastInbound?: { sent_at: string; body: string } | null
  blocked?: { blocked_reasons: unknown; created_at: string } | null
  blockedThrows?: boolean
}) {
  draftFilters = {}
  const convo = opts.convo === undefined ? { id: 'conv-1', participant_name: 'Kam' } : opts.convo
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'conversations') {
      const c = {
        select: () => c,
        eq: () => c,
        order: () => c,
        limit: () => c,
        maybeSingle: async () => ({ data: convo, error: null }),
      }
      return c
    }
    if (table === 'conversation_messages') {
      const c = {
        select: () => c,
        eq: () => c,
        order: () => c,
        limit: () => c,
        maybeSingle: async () => ({ data: opts.lastInbound ?? null }),
      }
      return c
    }
    if (table === 'conversation_reply_drafts') {
      const c = {
        select: () => c,
        eq: (col: string, v: unknown) => {
          draftFilters[col] = v
          return c
        },
        order: () => c,
        limit: () => c,
        maybeSingle: async () => {
          if (opts.blockedThrows) throw new Error('db down')
          return { data: opts.blocked ?? null }
        },
      }
      return c
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const call = () =>
  GET(new NextRequest('http://localhost/x'), { params: { id: 'client-a', cid: 'contact-1' } })

beforeEach(() => vi.clearAllMocks())

describe('GET crm/contacts/[cid]/whatsapp', () => {
  it('返回会话、窗口、客人最后一条消息；24 小时内是 standard', async () => {
    mockDb({ lastInbound: { sent_at: iso(3_600_000), body: 'Hello there' } })
    const body = await (await call()).json()
    expect(body.conversationId).toBe('conv-1')
    expect(body.replyWindow.kind).toBe('standard')
    expect(body.lastInbound).toEqual({ body: 'Hello there', sentAt: expect.any(String) })
    expect(body.blockedDraft).toBeNull()
  })

  it('客人最后一句话超过 24 小时 → 窗口 closed（批准发送那一步同样按这个判断，见 F2 的 isWindowClosed）', async () => {
    mockDb({ lastInbound: { sent_at: iso(25 * 3_600_000), body: 'old' } })
    const body = await (await call()).json()
    expect(body.replyWindow.kind).toBe('closed')
  })

  it('客人最后一句话之后有被拦下的草稿 → 返回原因（只是提示，不是可批准的草稿）', async () => {
    mockDb({
      lastInbound: { sent_at: iso(600_000), body: 'hi' },
      blocked: { blocked_reasons: ['content_claims: reply makes unverified claim(s): promise'], created_at: iso(300_000) },
    })
    const body = await (await call()).json()
    expect(body.blockedDraft.reasons).toEqual(['content_claims: reply makes unverified claim(s): promise'])
    expect(draftFilters.verifier_status).toBe('blocked')
    expect(draftFilters.client_id).toBe('client-a')
  })

  it('被拦下的草稿比客人最后一句话还早 → 不提示（那是上一轮的）', async () => {
    mockDb({
      lastInbound: { sent_at: iso(600_000), body: 'hi' },
      blocked: { blocked_reasons: ['x'], created_at: iso(3_600_000) },
    })
    expect((await (await call()).json()).blockedDraft).toBeNull()
  })

  it('读草稿失败 → 当没有，不挡回复', async () => {
    mockDb({ lastInbound: { sent_at: iso(600_000), body: 'hi' }, blockedThrows: true })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).blockedDraft).toBeNull()
  })

  it('没有 WhatsApp 线 → conversationId null', async () => {
    mockDb({ convo: null })
    expect(await (await call()).json()).toEqual({ conversationId: null })
  })

  it('没权限 → 原样 401/403，不查库', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 403, error: 'forbidden' })
    mockDb({})
    expect((await call()).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

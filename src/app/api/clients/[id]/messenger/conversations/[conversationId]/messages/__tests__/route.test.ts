/**
 * Tests for the thread-transcript endpoint.
 *
 * The transcript is verbatim customer conversation, so the bar is the same as
 * the send path: prove the caller may act for this client, then prove the
 * thread belongs to that client before a single message is read.
 *
 * The window it reports is the one the send box trusts, so the "which message
 * starts the clock" logic is pinned too — an outbound message must never reset it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CONVO = '11111111-1111-1111-1111-111111111111'

interface MessageRow {
  direction: 'inbound' | 'outbound'
  sender_name: string | null
  body: string | null
  sent_at: string
}

function request(): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CTS}/messenger/conversations/${CONVO}/messages`,
  )
}

function params(id = CTS) {
  return { params: { id, conversationId: CONVO } }
}

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

/**
 * Two-table stub: the ownership lookup, then the message read. `owned: false`
 * models a thread that exists but belongs to another client — maybeSingle
 * returns null because client_id is part of the filter.
 */
function stubTables({ owned, messages }: { owned: boolean; messages: MessageRow[] }) {
  const conversations = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: owned ? { id: CONVO } : null }),
  }
  const messageQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: messages, error: null }),
  }
  mockFrom.mockImplementation((table: string) =>
    (table === 'conversations' ? conversations : messageQuery) as never,
  )
  return { conversations, messageQuery }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-26T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('GET messages — authorisation', () => {
  it('rejects an unauthenticated caller without touching the database', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await GET(request(), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not a member of the client in the URL', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(request(), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('404s a thread belonging to another client instead of returning its messages', async () => {
    allow()
    const { messageQuery } = stubTables({ owned: false, messages: [] })

    const res = await GET(request(), params())

    expect(res.status).toBe(404)
    expect(messageQuery.limit).not.toHaveBeenCalled()
  })

  it('scopes the ownership lookup by both thread id and client id', async () => {
    allow()
    const { conversations } = stubTables({ owned: true, messages: [] })

    await GET(request(), params())

    expect(conversations.eq).toHaveBeenCalledWith('id', CONVO)
    expect(conversations.eq).toHaveBeenCalledWith('client_id', CTS)
  })
})

describe('GET messages — payload', () => {
  it('returns the thread oldest-first with both sides labelled', async () => {
    allow()
    stubTables({
      owned: true,
      messages: [
        { direction: 'inbound', sender_name: 'Kam', body: 'Hi', sent_at: '2026-07-26T10:00:00Z' },
        { direction: 'outbound', sender_name: null, body: 'Hello', sent_at: '2026-07-26T10:05:00Z' },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      messages: Array<{ direction: string; senderName: string | null; body: string }>
    }

    expect(json.messages).toEqual([
      { direction: 'inbound', senderName: 'Kam', body: 'Hi', sentAt: '2026-07-26T10:00:00Z' },
      { direction: 'outbound', senderName: null, body: 'Hello', sentAt: '2026-07-26T10:05:00Z' },
    ])
  })

  it('renders a null body as empty text rather than leaking null into the UI', async () => {
    allow()
    stubTables({
      owned: true,
      messages: [
        { direction: 'inbound', sender_name: 'Kam', body: null, sent_at: '2026-07-26T10:00:00Z' },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      messages: Array<{ body: string }>
    }

    expect(json.messages[0].body).toBe('')
  })
})

describe('GET messages — reply window', () => {
  it('runs the clock off the customer, not off our own last reply', async () => {
    allow()
    stubTables({
      owned: true,
      messages: [
        // Customer wrote 30h ago → past the free window.
        { direction: 'inbound', sender_name: 'Kam', body: 'Hi', sent_at: '2026-07-25T06:00:00Z' },
        // We answered a minute ago; this must NOT reopen the 24h window.
        { direction: 'outbound', sender_name: null, body: 'Hi', sent_at: '2026-07-26T11:59:00Z' },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      replyWindow: { kind: string }
    }

    expect(json.replyWindow.kind).toBe('human_agent')
  })

  it('uses the most recent customer message when they wrote more than once', async () => {
    allow()
    stubTables({
      owned: true,
      messages: [
        { direction: 'inbound', sender_name: 'Kam', body: 'Hi', sent_at: '2026-07-20T06:00:00Z' },
        { direction: 'inbound', sender_name: 'Kam', body: 'Still there?', sent_at: '2026-07-26T11:00:00Z' },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      replyWindow: { kind: string }
    }

    expect(json.replyWindow.kind).toBe('standard')
  })

  it('reports the window as closed when the customer has never written', async () => {
    allow()
    stubTables({
      owned: true,
      messages: [
        { direction: 'outbound', sender_name: null, body: 'Hello', sent_at: '2026-07-26T11:00:00Z' },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      replyWindow: { kind: string }
    }

    expect(json.replyWindow.kind).toBe('closed')
  })
})

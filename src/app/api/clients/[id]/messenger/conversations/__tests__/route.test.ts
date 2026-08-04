/**
 * Tests for the salesperson's worklist.
 *
 * This endpoint decides what a CTS salesperson sees first, so the ordering IS
 * the product: someone waiting on us outranks a follow-up we promised, which
 * outranks a hot lead nobody owes anything to. Get it wrong and the person who
 * has been waiting two days sits below a thread that is merely interesting.
 *
 * The follow-up signal matters most because it is the invisible one — an
 * overdue thread reads as "answered" everywhere else on the page.
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
const NOW = '2026-07-26T12:00:00Z'

interface Row {
  id: string
  participant_name: string | null
  message_count?: number
  last_message_at: string | null
  last_message_from: 'customer' | 'page' | null
  conversation_briefs: Array<Record<string, unknown>>
}

function brief(over: Record<string, unknown> = {}) {
  return {
    summary: 's',
    intent_level: 'medium',
    customer_needs: [],
    objections: [],
    promises_made: [],
    next_action: null,
    follow_up_due_at: null,
    risk_flags: [],
    trip: {},
    contact: {},
    draft_reply: null,
    generated_at: NOW,
    ...over,
  }
}

function request(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/messenger/conversations`)
}

function params(id = CTS) {
  return { params: { id } }
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

function stubRows(rows: Row[]) {
  const eq = vi.fn().mockReturnThis()
  const query = {
    select: vi.fn().mockReturnThis(),
    eq,
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  mockFrom.mockReturnValue(query as never)
  return query
}

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    participant_name: id,
    message_count: 3,
    last_message_at: '2026-07-26T09:00:00Z',
    last_message_from: 'page',
    conversation_briefs: [brief()],
    ...over,
  }
}

async function names(): Promise<string[]> {
  const json = (await (await GET(request(), params())).json()) as {
    conversations: Array<{ id: string }>
  }
  return json.conversations.map((c) => c.id)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('conversations — isolation', () => {
  it('rejects a non-member without querying', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await GET(request(), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('filters by the client id the guard verified, never a wider query', async () => {
    allow()
    const query = stubRows([])

    await GET(request(), params())

    expect(query.eq).toHaveBeenCalledWith('client_id', CTS)
  })
})

describe('conversations — follow-up is derived, not guessed', () => {
  it('marks a passed follow-up date as overdue', async () => {
    allow()
    stubRows([
      row('a', { conversation_briefs: [brief({ follow_up_due_at: '2026-07-24T00:00:00Z' })] }),
    ])

    const json = (await (await GET(request(), params())).json()) as {
      conversations: Array<{ followUpDueAt: string | null; followUpOverdue: boolean }>
      counts: { followUpOverdue: number }
    }

    expect(json.conversations[0]).toMatchObject({
      followUpDueAt: '2026-07-24T00:00:00Z',
      followUpOverdue: true,
    })
    expect(json.counts.followUpOverdue).toBe(1)
  })

  it('does not mark a future follow-up as overdue', async () => {
    allow()
    stubRows([
      row('a', { conversation_briefs: [brief({ follow_up_due_at: '2026-07-30T00:00:00Z' })] }),
    ])

    const json = (await (await GET(request(), params())).json()) as {
      conversations: Array<{ followUpOverdue: boolean }>
      counts: { followUpOverdue: number }
    }

    expect(json.conversations[0].followUpOverdue).toBe(false)
    expect(json.counts.followUpOverdue).toBe(0)
  })

  it('reports no follow-up at all for a thread with no brief', async () => {
    allow()
    stubRows([row('a', { conversation_briefs: [] })])

    const json = (await (await GET(request(), params())).json()) as {
      conversations: Array<{ followUpDueAt: string | null; followUpOverdue: boolean }>
    }

    expect(json.conversations[0]).toMatchObject({ followUpDueAt: null, followUpOverdue: false })
  })
})

describe('conversations — what a salesperson sees first', () => {
  it('puts a customer who is waiting above an overdue follow-up', async () => {
    allow()
    stubRows([
      row('overdue-follow-up', {
        conversation_briefs: [brief({ follow_up_due_at: '2026-07-01T00:00:00Z' })],
      }),
      row('customer-waiting', { last_message_from: 'customer' }),
    ])

    expect(await names()).toEqual(['customer-waiting', 'overdue-follow-up'])
  })

  it('puts an overdue follow-up above a high-intent thread nobody owes anything', async () => {
    allow()
    stubRows([
      row('hot-but-settled', { conversation_briefs: [brief({ intent_level: 'high' })] }),
      row('overdue-follow-up', {
        conversation_briefs: [brief({ intent_level: 'low', follow_up_due_at: '2026-07-01T00:00:00Z' })],
      }),
    ])

    // Without this rule the overdue thread sinks below the hot one and is never
    // seen again — it looks answered, because it was.
    expect(await names()).toEqual(['overdue-follow-up', 'hot-but-settled'])
  })

  it('still ranks by intent once nobody is owed anything', async () => {
    allow()
    stubRows([
      row('low', { conversation_briefs: [brief({ intent_level: 'low' })] }),
      row('high', { conversation_briefs: [brief({ intent_level: 'high' })] }),
    ])

    expect(await names()).toEqual(['high', 'low'])
  })
})

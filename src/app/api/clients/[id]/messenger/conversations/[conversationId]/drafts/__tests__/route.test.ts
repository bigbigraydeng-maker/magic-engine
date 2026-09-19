/**
 * Tests for the pending-drafts endpoint (Issue #1588).
 *
 * Same authorisation bar as the sibling `messages` route (a thread belonging
 * to another client must 404, not leak its drafts), plus the one thing this
 * endpoint owns: only `verifier_status='pending'` rows are ever returned —
 * this is the human approval queue, not a draft history log.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
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

interface DraftRow {
  id: string
  draft_body: string
  agent_confidence: number | null
  quoted_offering_names: string[] | null
  verifier_output_json: unknown
  created_at: string
}

function request(): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CTS}/messenger/conversations/${CONVO}/drafts`,
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

function stubTables({ owned, drafts }: { owned: boolean; drafts: DraftRow[] }) {
  const conversations = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: owned ? { id: CONVO } : null }),
  }
  const draftsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: drafts, error: null }),
  }
  mockFrom.mockImplementation((table: string) =>
    (table === 'conversations' ? conversations : draftsQuery) as never,
  )
  return { conversations, draftsQuery }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET drafts — authorisation', () => {
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

  it('404s a thread belonging to another client instead of returning its drafts', async () => {
    allow()
    const { draftsQuery } = stubTables({ owned: false, drafts: [] })

    const res = await GET(request(), params())

    expect(res.status).toBe(404)
    expect(draftsQuery.order).not.toHaveBeenCalled()
  })

  it('scopes the ownership lookup by both thread id and client id', async () => {
    allow()
    const { conversations } = stubTables({ owned: true, drafts: [] })

    await GET(request(), params())

    expect(conversations.eq).toHaveBeenCalledWith('id', CONVO)
    expect(conversations.eq).toHaveBeenCalledWith('client_id', CTS)
  })
})

describe('GET drafts — only the approval queue', () => {
  it('filters the query to verifier_status=pending', async () => {
    allow()
    const { draftsQuery } = stubTables({ owned: true, drafts: [] })

    await GET(request(), params())

    expect(draftsQuery.eq).toHaveBeenCalledWith('verifier_status', 'pending')
    expect(draftsQuery.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(draftsQuery.eq).toHaveBeenCalledWith('conversation_id', CONVO)
  })

  it('shapes each row into camelCase fields the panel reads', async () => {
    allow()
    stubTables({
      owned: true,
      drafts: [
        {
          id: 'draft-1',
          draft_body: 'Kia ora — here is the itinerary.',
          agent_confidence: 0.82,
          quoted_offering_names: ['Golden China 12-Day'],
          verifier_output_json: { ok: true, blocked_reasons: [] },
          created_at: '2026-09-15T01:00:00Z',
        },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      drafts: Array<{
        id: string
        draftBody: string
        agentConfidence: number | null
        quotedOfferingNames: string[]
        passedGateIds: string[]
        createdAt: string
      }>
    }

    expect(json.drafts).toEqual([
      {
        id: 'draft-1',
        draftBody: 'Kia ora — here is the itinerary.',
        agentConfidence: 0.82,
        quotedOfferingNames: ['Golden China 12-Day'],
        verifierOutputJson: { ok: true, blocked_reasons: [] },
        passedGateIds: expect.arrayContaining(['brand_redline', 'length', 'url_allowlist']),
        createdAt: '2026-09-15T01:00:00Z',
      },
    ])
    // CTS 是 c0000000-…（params() 默认值）——真的挂上了 cts.ts 的完整闸门列表，不是空壳。
    expect(json.drafts[0].passedGateIds.length).toBe(7)
  })

  it('attaches no gate list for a client whose Verifier policy is not CTS (no platform-wide truth invented)', async () => {
    allow()
    stubTables({
      owned: true,
      drafts: [
        {
          id: 'draft-1',
          draft_body: 'text',
          agent_confidence: null,
          quoted_offering_names: null,
          verifier_output_json: null,
          created_at: '2026-09-15T01:00:00Z',
        },
      ],
    })

    const json = (await (await GET(request(), params(OZTOP))).json()) as {
      drafts: Array<{ passedGateIds: string[] }>
    }

    expect(json.drafts[0].passedGateIds).toEqual([])
  })

  it('renders a null quoted_offering_names as an empty array, not null', async () => {
    allow()
    stubTables({
      owned: true,
      drafts: [
        {
          id: 'draft-1',
          draft_body: 'text',
          agent_confidence: null,
          quoted_offering_names: null,
          verifier_output_json: null,
          created_at: '2026-09-15T01:00:00Z',
        },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      drafts: Array<{ quotedOfferingNames: string[] }>
    }

    expect(json.drafts[0].quotedOfferingNames).toEqual([])
  })

  it('surfaces a query error as 500', async () => {
    allow()
    const conversations = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: CONVO } }),
    }
    const draftsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } }),
    }
    mockFrom.mockImplementation((table: string) =>
      (table === 'conversations' ? conversations : draftsQuery) as never,
    )

    const res = await GET(request(), params())

    expect(res.status).toBe(500)
  })
})

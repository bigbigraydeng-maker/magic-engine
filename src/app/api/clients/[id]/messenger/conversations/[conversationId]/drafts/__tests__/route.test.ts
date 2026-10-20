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
import { ctsVerifierGates } from '@/lib/messenger-agent/verifier/policies/cts'

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
    in: vi.fn().mockReturnThis(),
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

describe('GET drafts — channels', () => {
  it('thread ownership check accepts messenger AND whatsapp (WhatsApp drafts need an approval surface)', async () => {
    allow()
    const { conversations } = stubTables({ owned: true, drafts: [] })

    await GET(request(), params())

    expect(conversations.in).toHaveBeenCalledWith('channel', ['messenger', 'whatsapp'])
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
        semanticFlags: [],
        createdAt: '2026-09-15T01:00:00Z',
      },
    ])
    // CTS 是 c0000000-…（params() 默认值）——这条历史行的 verifier_output_json 里没有
    // `checked_gate_ids`（2026-09-20 语义闸上线前写入的行），回退到只声称七道正则闸
    // 过了，不假装 Jev 语义闸也跑过（子牙+魏征复审：不能用静态清单冒充实际执行记录）。
    // 回退到「静态正则闸清单」的长度（原来写死 7，主干新增一道闸后这条就红了，跟本次改动无关）。
    expect(json.drafts[0].passedGateIds).toEqual(ctsVerifierGates.map((g) => g.id))
  })

  it('reads the real per-draft checked_gate_ids when the row records it (Jev semantic layer actually ran)', async () => {
    allow()
    stubTables({
      owned: true,
      drafts: [
        {
          id: 'draft-2',
          draft_body: 'Kia ora — here is the itinerary.',
          agent_confidence: 0.82,
          quoted_offering_names: [],
          verifier_output_json: {
            ok: true,
            blocked_reasons: [],
            checked_gate_ids: ['brand_redline', 'length', 'url_allowlist', 'brand_redline_semantic'],
          },
          created_at: '2026-09-20T01:00:00Z',
        },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      drafts: Array<{ passedGateIds: string[] }>
    }

    // number_claim_semantic is deliberately absent from the stub — proves this route
    // trusts the row's own record instead of re-deriving a fixed 9-item list.
    expect(json.drafts[0].passedGateIds).toEqual([
      'brand_redline',
      'length',
      'url_allowlist',
      'brand_redline_semantic',
    ])
  })

  it(
    '🔴 regression guard (Codex review 2026-09-20 on PR #1838): surfaces semantic_flags ' +
      "on an otherwise-'pending' (ok:true) row — a semantic hit never blocks the draft, so " +
      'the portal must read the advisory flag from the row itself to show it at all',
    async () => {
      allow()
      stubTables({
        owned: true,
        drafts: [
          {
            id: 'draft-3',
            draft_body: 'text',
            agent_confidence: 0.7,
            quoted_offering_names: [],
            verifier_output_json: {
              ok: true,
              blocked_reasons: [],
              checked_gate_ids: ['brand_redline', 'brand_redline_semantic'],
              semantic_flags: ['brand_redline_semantic: reply may restate a brand-redline claim (Jev score 0.79)'],
            },
            created_at: '2026-09-20T01:00:00Z',
          },
        ],
      })

      const json = (await (await GET(request(), params())).json()) as {
        drafts: Array<{ semanticFlags: string[] }>
      }

      expect(json.drafts[0].semanticFlags).toEqual([
        'brand_redline_semantic: reply may restate a brand-redline claim (Jev score 0.79)',
      ])
    },
  )

  it('defaults semanticFlags to an empty array when the row has no verifier_output_json at all', async () => {
    allow()
    stubTables({
      owned: true,
      drafts: [
        {
          id: 'draft-4',
          draft_body: 'text',
          agent_confidence: null,
          quoted_offering_names: null,
          verifier_output_json: null,
          created_at: '2026-09-15T01:00:00Z',
        },
      ],
    })

    const json = (await (await GET(request(), params())).json()) as {
      drafts: Array<{ semanticFlags: string[] }>
    }

    expect(json.drafts[0].semanticFlags).toEqual([])
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
      in: vi.fn().mockReturnThis(),
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

describe('GET drafts — 越权（WhatsApp 放开后仍按客户隔离）', () => {
  it('A 客户账号读 B 客户的 WhatsApp 草稿 → 403，不碰库', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const res = await GET(request(), params(OZTOP))
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('会话属于别的客户（即使是 whatsapp 渠道）→ 404，且查询同时带 client_id', async () => {
    allow()
    const { conversations, draftsQuery } = stubTables({ owned: false, drafts: [{ id: 'leak', draft_body: 'secret', agent_confidence: 1, quoted_offering_names: [], verifier_output_json: null, created_at: 'x' }] })
    const res = await GET(request(), params())
    expect(res.status).toBe(404)
    expect(conversations.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(draftsQuery.order).not.toHaveBeenCalled()
  })
})

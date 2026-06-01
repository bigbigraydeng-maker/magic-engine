/**
 * Tests for GET /api/clients/[id]/zhuge/latest-actions
 * Reference: ROADMAP.md P12.G.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (declared before imports) ──────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLIENT_ID = 'client-abc-123'

function makeRequest(clientId = CLIENT_ID): [NextRequest, { params: { id: string } }] {
  const req = new NextRequest(`http://localhost/api/clients/${clientId}/zhuge/latest-actions`, {
    headers: { Authorization: 'Bearer test-key' },
  })
  return [req, { params: { id: clientId } }]
}

function makeActionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    flywheel: 'geo',
    action_type: 'publish_geo_directive',
    execution_mode: 'in_house',
    expected_metric: 'geo.query.mention_rate',
    executed_at: '2026-05-20T00:00:00Z',
    payload: {
      rank: 1,
      why_now: 'AI visibility is low',
      evidence_refs: ['finding:f-1'],
      expected_impact: 'high',
      effort: 'low',
      executable_by: 'luban.deploy_geo_directive',
      zhuge_session_key: 'abc123def456789a',
      discovery_id: 'disc-1',
      diagnostic_run_id: null,
    },
    ...overrides,
  }
}

function allowAuth() {
  vi.mocked(requireDashboardClientAccess).mockResolvedValue({ ok: true, user: { email: 'test@test.com' } as never, role: 'admin', allowedClientId: null })
}

function denyAuth() {
  vi.mocked(requireDashboardClientAccess).mockResolvedValue({
    ok: false,
    error: 'Unauthorized',
    status: 401,
  })
}

// ── Two-step Supabase mock: clients check → latest row → session actions ──────

function setupFull(clientExists: boolean, latestRow: unknown | null, actions: unknown[]) {
  const fromImpl = vi.fn().mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: clientExists ? { id: CLIENT_ID } : null,
              error: clientExists ? null : { message: 'Not found' },
            }),
          }),
        }),
      }
    }

    if (table === 'flywheel_actions') {
      // First call → maybeSingle (finds latest row)
      // Second call → returns array (all session actions)
      let callCount = 0
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({ data: latestRow, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        }),
      }
      // For the second select (all actions), return array
      let selectCallCount = 0
      chain.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount >= 2) {
          // Second select chain resolves directly
          const arr = {
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: actions, error: null }),
          }
          return arr
        }
        return chain
      })
      return chain
    }

    return { select: vi.fn().mockReturnThis() }
  })

  vi.mocked(supabaseAdmin.from).mockImplementation(fromImpl)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/zhuge/latest-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    allowAuth()
  })

  it('returns 401 when bearer token is invalid', async () => {
    denyAuth()
    const [req, ctx] = makeRequest()
    const res = await GET(req, ctx)
    expect(res.status).toBe(401)
  })

  it('returns 404 when client does not exist', async () => {
    setupFull(false, null, [])
    const [req, ctx] = makeRequest()
    const res = await GET(req, ctx)
    expect(res.status).toBe(404)
  })

  it('returns empty actions when no Zhuge session exists', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: CLIENT_ID }, error: null }),
            }),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      // flywheel_actions: no row
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    const [req, ctx] = makeRequest()
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; actions: unknown[]; generated_at: null }
    expect(body.success).toBe(true)
    expect(body.actions).toHaveLength(0)
    expect(body.generated_at).toBeNull()
  })

  it('returns sorted actions for the latest session', async () => {
    const row1 = makeActionRow({ payload: { ...makeActionRow().payload, rank: 2 } })
    const row2 = makeActionRow({ id: 'action-2', payload: { ...makeActionRow().payload, rank: 1 } })

    const latestRow = {
      payload: { zhuge_session_key: 'abc123def456789a' },
      executed_at: '2026-05-20T00:00:00Z',
    }

    // Three sequential from() calls: clients → flywheel_actions (latest) → flywheel_actions (session)
    const clientsMock = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: CLIENT_ID }, error: null }),
        }),
      }),
    }
    const latestMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: latestRow, error: null }),
    }
    const sessionMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [row1, row2], error: null }),
    }

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(clientsMock as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(latestMock as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(sessionMock as unknown as ReturnType<typeof supabaseAdmin.from>)

    const [req, ctx] = makeRequest()
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; actions: Array<{ payload: { rank: number } }>; generated_at: string }
    expect(body.success).toBe(true)
    expect(body.actions).toHaveLength(2)
    // sorted by rank ASC: rank 1 first
    expect(body.actions[0].payload.rank).toBe(1)
    expect(body.actions[1].payload.rank).toBe(2)
    expect(body.generated_at).toBe('2026-05-20T00:00:00Z')
  })

  it('returns empty when latest row has no session key in payload', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: CLIENT_ID }, error: null }),
            }),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { payload: {}, executed_at: '2026-05-20T00:00:00Z' },
          error: null,
        }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    const [req, ctx] = makeRequest()
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; actions: unknown[] }
    expect(body.success).toBe(true)
    expect(body.actions).toHaveLength(0)
  })
})

/**
 * GET /api/clients/[id]/meta-ads/actions — truthful reactivation display.
 *
 * A reactivation that never reached Meta (authorized_pending) or failed there
 * (meta_failed) must not read as "reactivated" in the history list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  rows: [] as unknown[],
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.neq = () => builder
      builder.order = () => builder
      builder.limit = () => Promise.resolve({ data: m.rows, error: null })
      return builder
    },
  },
}))

import { GET } from '@/app/api/clients/[id]/meta-ads/actions/route'

function get() {
  return GET(
    new NextRequest('http://localhost/api/clients/c1/meta-ads/actions'),
    { params: { id: 'c1' } },
  )
}

interface ActionPayload {
  status?: string
  before?: { status?: string }
  after?: { status?: string }
  display_status?: string
}

interface ActionResponse {
  success: boolean
  actions: Array<{ action_type: string; payload: ActionPayload }>
}

beforeEach(() => {
  vi.clearAllMocks()
  m.rows = []
})

describe('meta-ads/actions GET — truthful reactivation display', () => {
  it('executed reactivation shows PAUSED → ACTIVE', async () => {
    m.rows = [{
      id: 'a1',
      action_type: 'ads.reactivate_campaign',
      vendor: 'meta',
      payload: { status: 'executed', before: { status: 'PAUSED' }, after: { status: 'ACTIVE' } },
      executed_at: '2026-01-01T00:00:00Z',
      execution_item_id: null,
    }]

    const res = await get()
    const body = await res.json() as ActionResponse

    expect(body.actions[0].payload.after?.status).toBe('ACTIVE')
  })

  it('meta_failed reactivation does NOT show as ACTIVE', async () => {
    m.rows = [{
      id: 'a1',
      action_type: 'ads.reactivate_campaign',
      vendor: 'meta',
      payload: { status: 'meta_failed', before: { status: 'PAUSED' }, after: { status: 'ACTIVE' } },
      executed_at: '2026-01-01T00:00:00Z',
      execution_item_id: null,
    }]

    const res = await get()
    const body = await res.json() as ActionResponse

    expect(body.actions[0].payload.after?.status).toBe('PAUSED')
    expect(body.actions[0].payload.display_status).toBe('meta_failed')
  })

  it('authorized_pending reactivation does NOT show as ACTIVE', async () => {
    m.rows = [{
      id: 'a1',
      action_type: 'ads.reactivate_campaign',
      vendor: 'meta',
      payload: { status: 'authorized_pending', before: { status: 'PAUSED' }, after: { status: 'ACTIVE' } },
      executed_at: '2026-01-01T00:00:00Z',
      execution_item_id: null,
    }]

    const res = await get()
    const body = await res.json() as ActionResponse

    expect(body.actions[0].payload.after?.status).toBe('PAUSED')
    expect(body.actions[0].payload.display_status).toBe('authorized_pending')
  })

  it('pause rows are untouched', async () => {
    m.rows = [{
      id: 'a1',
      action_type: 'ads.pause_campaign',
      vendor: 'meta',
      payload: { before: { status: 'ACTIVE' }, after: { status: 'PAUSED' } },
      executed_at: '2026-01-01T00:00:00Z',
      execution_item_id: null,
    }]

    const res = await get()
    const body = await res.json() as ActionResponse

    expect(body.actions[0].payload.after?.status).toBe('PAUSED')
    expect(body.actions[0].payload.display_status).toBeUndefined()
  })
})

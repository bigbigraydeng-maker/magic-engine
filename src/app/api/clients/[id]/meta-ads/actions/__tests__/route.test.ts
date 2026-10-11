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
  access: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))

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

const INTERNAL = { ok: true, tier: 'admin', allowedClientId: null }
const CLIENT_MEMBER = { ok: true, tier: 'paid_client', allowedClientId: 'c1' }

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
  reason?: string
  adset_name?: string
  campaign_id?: string
}

interface ActionResponse {
  success: boolean
  actions: Array<{ id?: string; action_type: string; payload: ActionPayload }>
}

beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue(INTERNAL)
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

describe('meta-ads/actions GET — 客户看不到没做成的记录，谁都拿不到内部字段', () => {
  beforeEach(() => {
    m.rows = [
      { id: 'pause', action_type: 'ads.pause_campaign', vendor: 'meta', executed_at: '2026-10-10T00:00:00Z', execution_item_id: null,
        payload: { campaign_id: 'cmp_1', before: { status: 'ACTIVE', name: 'Spring' }, after: { status: 'PAUSED', name: 'Spring' } } },
      { id: 'd3-blocked', action_type: 'ads.auto_pause_on_d3', vendor: 'meta', executed_at: '2026-10-10T00:00:00Z', execution_item_id: null,
        payload: { status: 'blocked', reason: 'relation "ad_entity_snapshots" does not exist', adset_name: 'Adset A', diagnosis_evidence: { spend: 1 }, ownership: { client_page_id: 'p1' } } },
      { id: 'd3-dry', action_type: 'ads.auto_pause_on_d3', vendor: 'meta', executed_at: '2026-10-10T00:00:00Z', execution_item_id: null,
        payload: { status: 'dry_run_logged', reason: '如果 autopilot_dry_run 关闭，会提交 Kernel 等人批准暂停这个广告组', adset_name: 'Adset B' } },
      { id: 'd3-paused', action_type: 'ads.auto_pause_on_d3', vendor: 'meta', executed_at: '2026-10-10T00:00:00Z', execution_item_id: null,
        payload: { status: 'paused', adset_name: 'Adset C', diagnosis_evidence: { spend: 2 } } },
      { id: 'react-failed', action_type: 'ads.reactivate_campaign', vendor: 'meta', executed_at: '2026-10-10T00:00:00Z', execution_item_id: null,
        payload: { status: 'meta_failed', campaign_id: 'cmp_2', before: { status: 'PAUSED' }, after: { status: 'ACTIVE' }, authorization: { by: 'pm@example.com' } } },
    ]
  })

  it('客户成员：只拿到真做了的两条', async () => {
    m.access.mockResolvedValue(CLIENT_MEMBER)

    const res = await get()
    const body = await res.json() as ActionResponse

    const ids = body.actions.map(a => a.id).sort()
    expect(ids).toEqual(['d3-paused', 'pause'])
  })

  it('客户成员：响应里没有内部原因、诊断证据、归属信息', async () => {
    m.access.mockResolvedValue(CLIENT_MEMBER)

    const res = await get()
    const raw = await res.text()

    expect(raw).not.toContain('ad_entity_snapshots')
    expect(raw).not.toContain('autopilot_dry_run')
    expect(raw).not.toContain('diagnosis_evidence')
    expect(raw).not.toContain('ownership')
    expect(raw).not.toContain('Adset')
    expect(raw).not.toContain('authorization')
  })

  it('内部：五条都在，但内部字段同样被裁掉', async () => {
    const res = await get()
    const raw = await res.text()
    const body = JSON.parse(raw) as ActionResponse

    const ids = body.actions.map(a => a.id).sort()
    expect(ids).toEqual(['d3-blocked', 'd3-dry', 'd3-paused', 'pause', 'react-failed'])

    expect(raw).not.toContain('ad_entity_snapshots')
    expect(raw).not.toContain('diagnosis_evidence')
    expect(raw).not.toContain('ownership')
    expect(raw).not.toContain('authorization')
  })

  it('面板要用的字段原样保留', async () => {
    const res = await get()
    const body = await res.json() as ActionResponse

    const pause = body.actions.find(a => a.id === 'pause')
    expect(pause?.payload).toEqual({
      campaign_id: 'cmp_1',
      before: { status: 'ACTIVE', name: 'Spring' },
      after: { status: 'PAUSED', name: 'Spring' },
    })

    const reactFailed = body.actions.find(a => a.id === 'react-failed')
    expect(reactFailed?.payload.display_status).toBe('meta_failed')
    expect(reactFailed?.payload.after).toEqual({ status: 'PAUSED' })
  })

  it('受限管理员（演示账号）按客户对待', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: 'c1' })

    const res = await get()
    const body = await res.json() as ActionResponse

    const ids = body.actions.map(a => a.id).sort()
    expect(ids).toEqual(['d3-paused', 'pause'])
  })
})

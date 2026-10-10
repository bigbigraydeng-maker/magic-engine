import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  lookup: vi.fn(),
  paidAccess: vi.fn(),
  authority: vi.fn(),
  approveDraft: vi.fn(),
  rejectDraft: vi.fn(),
  token: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = m.lookup
      return b
    },
  },
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.paidAccess }))
vi.mock('@/lib/ads/spend-activation', () => ({ requireSpendActivationAuthority: m.authority }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: m.token }))
vi.mock('@/lib/ads-strategy/draft-and-gate', () => ({
  approveDraft: m.approveDraft,
  rejectDraft: m.rejectDraft,
  ADS_CREATE_ACTION: 'ads.create_ad',
}))

import { POST } from '@/app/api/ad-approval/[actionId]/route'

function call(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/ad-approval/act1', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ actionId: 'act1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.lookup.mockResolvedValue({ data: { client_id: 'c1' }, error: null })
  m.paidAccess.mockResolvedValue({ ok: true, tier: 'paid_client', user: { id: 'u-client' } })
  m.authority.mockResolvedValue({
    ok: true,
    actorUserId: 'u-pm',
    actorEmail: 'pm@magiclab.test',
    basis: 'global_admin',
  })
  m.token.mockResolvedValue('tok')
  m.approveDraft.mockResolvedValue({ ok: true })
  m.rejectDraft.mockResolvedValue({ ok: true })
})

describe('POST /api/ad-approval/[actionId]', () => {
  it('paid client account (not PM) cannot approve → 403, draft never activated', async () => {
    m.authority.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'x',
      code: 'activation_requires_pm',
    })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('activation_requires_pm')
    expect(m.approveDraft).not.toHaveBeenCalled()
    expect(m.token).not.toHaveBeenCalled()
  })

  it('authority check failure → denied (fail-closed)', async () => {
    m.authority.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'x',
      code: 'activation_auth_failed',
    })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(500)
    expect(m.approveDraft).not.toHaveBeenCalled()
  })

  it('PM approval passes the authority into approveDraft', async () => {
    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(200)
    expect(m.approveDraft).toHaveBeenCalledWith(
      'act1',
      expect.anything(),
      'tok',
      expect.objectContaining({ actorUserId: 'u-pm', basis: 'global_admin' }),
    )
  })

  it('approveDraft warning is surfaced, not hidden', async () => {
    m.approveDraft.mockResolvedValue({ ok: true, warning: 'late' })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, status: 'active', warning: 'late' })
  })

  it('draft lookup error → 503, nothing else runs', async () => {
    m.lookup.mockResolvedValue({ data: null, error: { message: 'db down' } })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(503)
    expect(m.paidAccess).not.toHaveBeenCalled()
    expect(m.authority).not.toHaveBeenCalled()
    expect(m.approveDraft).not.toHaveBeenCalled()
  })

  it('rejecting still works for a paid client account without PM authority', async () => {
    m.authority.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'x',
      code: 'activation_requires_pm',
    })

    const res = await call({ decision: 'reject', reason: 'no' })

    expect(res.status).toBe(200)
    expect(m.rejectDraft).toHaveBeenCalled()
    expect(m.authority).not.toHaveBeenCalled()
  })

  it('other client account cannot even reach the PM check', async () => {
    m.paidAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(403)
    expect(m.authority).not.toHaveBeenCalled()
    expect(m.approveDraft).not.toHaveBeenCalled()
  })
})

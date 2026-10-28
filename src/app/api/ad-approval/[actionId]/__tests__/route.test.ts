import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  lookup: vi.fn(),
  paidAccess: vi.fn(),
  rejectDraft: vi.fn(),
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
vi.mock('@/lib/ads-strategy/draft-and-gate', () => ({
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
  m.rejectDraft.mockResolvedValue({ ok: true })
})

describe('POST /api/ad-approval/[actionId]', () => {
  it('approve no longer spends and points at the confirmation card', async () => {
    const res = await call({ decision: 'approve' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('开投要在确认卡上点。这个入口不再直接开启广告。')
    expect(m.rejectDraft).not.toHaveBeenCalled()
  })

  it('draft lookup error → 503, nothing else runs', async () => {
    m.lookup.mockResolvedValue({ data: null, error: { message: 'db down' } })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(503)
    expect(m.paidAccess).not.toHaveBeenCalled()
    expect(m.rejectDraft).not.toHaveBeenCalled()
  })

  it('rejecting still works for a paid client account', async () => {
    const res = await call({ decision: 'reject', reason: 'no' })

    expect(res.status).toBe(200)
    expect(m.rejectDraft).toHaveBeenCalled()
  })

  it('other client account cannot reject or approve', async () => {
    m.paidAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await call({ decision: 'approve' })

    expect(res.status).toBe(403)
    expect(m.rejectDraft).not.toHaveBeenCalled()
  })
})

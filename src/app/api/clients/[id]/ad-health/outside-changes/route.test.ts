import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOperatorAccess: m.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ads-strategy/outside-change/load', () => ({ loadOutsideChanges: m.load }))

import { GET } from './route'

const call = () => GET(new Request('http://x') as never, { params: { id: 'c1' } })

describe('GET ad-health/outside-changes', () => {
  beforeEach(() => {
    m.access.mockReset()
    m.load.mockReset()
  })

  it('passes through access failures and does not read', async () => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await call()).status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('returns the unmatched changes for an operator', async () => {
    m.access.mockResolvedValue({ ok: true, role: 'admin' })
    m.load.mockResolvedValueOnce([{ kind: 'new_ad', where: '广告 · Clip', what: '新广告', capturedAt: '2026-10-30T10:00:00.000Z', entityId: 'ad-1' }])
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.changes).toHaveLength(1)
    expect(body.changes[0].what).toBe('新广告')
  })

  it('hides the raw error on a failed read', async () => {
    m.access.mockResolvedValue({ ok: true, role: 'admin' })
    m.load.mockRejectedValueOnce(new Error('relation missing'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation missing')
  })
})

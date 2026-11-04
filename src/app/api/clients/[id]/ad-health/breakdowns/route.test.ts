import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ads-strategy/account-timezone', () => ({ resolveAccountTimezone: vi.fn() }))
vi.mock('@/lib/ads-strategy/breakdown-stats/report-load', () => ({
  clampDays: (raw: string | null) => {
    if (raw === null) return 30
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || Number.isNaN(n) || n < 7) return 30
    if (n > 180) return 180
    return n
  },
  loadBreakdownReport: m.load,
}))

import { GET } from './route'

const call = (url = 'http://x') =>
  GET(new Request(url) as never, { params: { id: 'c1' } })

describe('GET ad-health/breakdowns', () => {
  beforeEach(() => {
    m.access.mockReset()
    m.load.mockReset()
  })

  it('only unscoped admins; paid clients and scoped admins get 403 and the loader is never called', async () => {
    for (const a of [
      { ok: true, tier: 'paid_client', allowedClientId: 'c1' },
      { ok: true, tier: 'admin', allowedClientId: 'c1' },
    ]) {
      m.access.mockResolvedValue(a)
      expect((await call()).status).toBe(403)
    }
    expect(m.load).not.toHaveBeenCalled()
  })

  it('passes through access failures', async () => {
    m.access.mockResolvedValue({ ok: false, status: 401, error: 'no' })
    expect((await call()).status).toBe(401)
  })

  it('admin gets the report', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockResolvedValueOnce({ since: 'x', until: 'y', days: 30, accounts: [] })
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).report.accounts).toEqual([])
  })

  it('a throw becomes a 500 with a plain message (no raw error)', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockRejectedValueOnce(new Error('secret table name'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret table name')
  })

  it('clamps ?days=999 to 180 before calling the loader', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockResolvedValueOnce({ since: 'x', until: 'y', days: 180, accounts: [] })
    await call('http://x?days=999')
    expect(m.load.mock.calls[0][1]).toBe(180)
  })
})

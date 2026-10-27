import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), getLive: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/ads-strategy/heartbeat/read', () => ({ readHeartbeatAccount: vi.fn() }))
vi.mock('@/lib/ads-strategy/heartbeat/store', () => ({ createSupabaseStore: vi.fn(() => ({ hasActiveCampaigns: vi.fn(async () => false) })) }))
vi.mock('@/lib/ads-strategy/heartbeat/live-view', () => ({ getLiveToday: m.getLive }))

import { GET } from './route'

const call = () => GET(new Request('http://x') as never, { params: { id: 'c1' } })

describe('GET ad-health/live', () => {
  beforeEach(() => { m.access.mockReset(); m.getLive.mockReset() })

  it('only unscoped admins; paid clients and scoped admins get 403 and Meta is never read', async () => {
    for (const a of [
      { ok: true, tier: 'paid_client', allowedClientId: 'c1' },
      { ok: true, tier: 'admin', allowedClientId: 'c1' },
    ]) {
      m.access.mockResolvedValue(a)
      expect((await call()).status).toBe(403)
    }
    expect(m.getLive).not.toHaveBeenCalled()
  })

  it('wires hasActiveCampaigns from the heartbeat store into the live deps', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.getLive.mockResolvedValueOnce({ readAtIso: 'x', accounts: [] })
    await call()
    const deps = m.getLive.mock.calls[0][1]
    expect(typeof deps.hasActiveCampaigns).toBe('function')
    expect(await deps.hasActiveCampaigns('c1', 'act_1')).toBe(false)
  })

  it('passes through access failures', async () => {
    m.access.mockResolvedValue({ ok: false, status: 401, error: 'no' })
    expect((await call()).status).toBe(401)
  })

  it('admin gets the view; a throw becomes a 500 with a plain message (no raw error)', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.getLive.mockResolvedValueOnce({ readAtIso: 'x', accounts: [] })
    const ok = await call()
    expect(ok.status).toBe(200)
    expect((await ok.json()).view.accounts).toEqual([])
    m.getLive.mockRejectedValueOnce(new Error('secret table name'))
    const bad = await call()
    expect(bad.status).toBe(500)
    expect(JSON.stringify(await bad.json())).not.toContain('secret table name')
  })
})

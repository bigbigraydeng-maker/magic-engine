import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ads-strategy/entity-tree/load', () => ({
  clampTreeDays: (raw: string | null) => (raw === '999' ? 30 : 7),
  loadEntityTree: m.load,
}))

import { GET } from './route'

const call = (url = 'http://x') => GET(new Request(url) as never, { params: { id: 'c1' } })

describe('GET ad-health/entities', () => {
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

  it('admin gets tree plus what was left out', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockResolvedValueOnce({ tree: { campaigns: [] }, hiddenAdsets: 2, noPageRegistered: false })
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tree.campaigns).toEqual([])
    expect(body.hiddenAdsets).toBe(2)
  })

  it('a throw becomes a 500 with a plain message (no raw error)', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockRejectedValueOnce(new Error('secret table name'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret table name')
  })

  it('clamps ?days=999 before calling the loader', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockResolvedValueOnce({ tree: { campaigns: [] }, hiddenAdsets: 0, noPageRegistered: false })
    await call('http://x?days=999')
    expect(m.load.mock.calls[0][1]).toBe(30)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/ads-strategy/ads-next-step/load-ads-next-step', () => ({
  loadAdsNextStepView: m.load,
}))

import { GET } from './route'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

const call = () =>
  GET({} as never, { params: { id: CLIENT } })

describe('GET ad-health/next-step', () => {
  beforeEach(() => {
    m.access.mockReset()
    m.load.mockReset()
  })

  it('passes through access failures (401)', async () => {
    m.access.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await call()
    expect(res.status).toBe(401)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('passes through paid_only as 403', async () => {
    m.access.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'This feature requires a paid plan. Contact Magic Lab to unlock.',
      reason: 'paid_only',
    })
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('paid client gets view with staffView false', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'paid_client', allowedClientId: CLIENT })
    m.load.mockResolvedValueOnce({
      healthRedLights: { kind: 'empty' },
      pendingActions: { kind: 'empty' },
      prescription: { kind: 'empty' },
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.load).toHaveBeenCalledWith({}, CLIENT, { staffView: false })
    expect((await res.json()).view.pendingActions.kind).toBe('empty')
  })

  it('unscoped admin gets view with staffView true', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', allowedClientId: null })
    m.load.mockResolvedValueOnce({
      healthRedLights: { kind: 'ok', data: { items: ['红灯'] } },
      pendingActions: { kind: 'empty' },
      prescription: { kind: 'empty' },
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.load).toHaveBeenCalledWith({}, CLIENT, { staffView: true })
    expect((await res.json()).view.healthRedLights.data.items).toEqual(['红灯'])
  })
})

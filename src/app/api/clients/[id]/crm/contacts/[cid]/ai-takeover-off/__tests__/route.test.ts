import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  contact: { data: { id: 'contact-1' } as { id: string } | null, error: null as { message: string } | null },
  store: { insertEvent: vi.fn(), loadEvents: vi.fn(), setMirror: vi.fn() },
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.requirePaidClientAccess }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => mocks.contact }) }) }) }),
  },
}))
vi.mock('@/lib/crm/ai-takeover/prod', () => ({ createTakeoverStore: () => mocks.store }))

import { POST } from '../route'

const ctx = { params: { id: 'client-a', cid: 'contact-1' } }
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.contact = { data: { id: 'contact-1' }, error: null }
  mocks.requirePaidClientAccess.mockResolvedValue({ ok: true, user: { email: 'lisa@client.co.nz' } })
  mocks.store.insertEvent.mockResolvedValue({ inserted: true })
  mocks.store.loadEvents
    .mockResolvedValueOnce([{ kind: 'ai_takeover_on', createdAt: '2026-11-10T01:00:00Z', actor: 'a' }])
    .mockResolvedValue([
      { kind: 'ai_takeover_on', createdAt: '2026-11-10T01:00:00Z', actor: 'a' },
      { kind: 'ai_takeover_off', createdAt: '2026-11-10T02:00:00Z', actor: 'lisa@client.co.nz' },
    ])
  mocks.store.setMirror.mockResolvedValue(undefined)
})

describe('POST ai-takeover-off', () => {
  it('writes the off event as the signed-in staff member, then clears the mirror', async () => {
    const res = await POST(req({ clientRef: 'r1' }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.store.insertEvent.mock.calls[0][0]).toMatchObject({ kind: 'ai_takeover_off', actor: 'lisa@client.co.nz', sourceRef: 'off:r1' })
    expect(mocks.store.setMirror).toHaveBeenCalledWith('client-a', 'contact-1', null)
  })

  it('needs the idempotency key', async () => {
    expect((await POST(req({}), ctx)).status).toBe(400)
    expect(mocks.store.insertEvent).not.toHaveBeenCalled()
  })

  it('a guest of another client: 404, nothing written', async () => {
    mocks.contact = { data: null, error: null }
    expect((await POST(req({ clientRef: 'r1' }), ctx)).status).toBe(404)
    expect(mocks.store.insertEvent).not.toHaveBeenCalled()
  })

  it('mirror not cleared → "只改了一半，再点一下"', async () => {
    mocks.store.setMirror.mockRejectedValue(new Error('x'))
    const res = await POST(req({ clientRef: 'r1' }), ctx)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ message: '只改了一半，再点一下。' })
  })
})

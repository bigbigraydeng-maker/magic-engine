import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { tag: 'admin' } }))
vi.mock('@/lib/crm/send-stats/read', async (orig) => ({ ...(await orig<typeof import('@/lib/crm/send-stats/read')>()), readSendStats: vi.fn() }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readSendStats } from '@/lib/crm/send-stats/read'
import { GET } from './route'

const ctx = { params: { id: 'client-a' } }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: 'a@b.c' } } as never)
})

describe('GET send-stats', () => {
  it('reads this client only, default 7 days, and returns the payload as is', async () => {
    vi.mocked(readSendStats).mockResolvedValue({ days: 7, truncated: false, reactionsReadable: true, rows: [] })
    const res = await GET(new NextRequest('http://x/api'), ctx)
    expect(await res.json()).toEqual({ days: 7, truncated: false, reactionsReadable: true, rows: [] })
    expect(readSendStats).toHaveBeenCalledWith({ tag: 'admin' }, 'client-a', 7)
  })

  it.each([
    ['30', 30],
    ['9999', 90],
    ['0', 7],
    ['abc', 7],
  ])('days=%s → %i (never more than 90)', async (raw, expected) => {
    vi.mocked(readSendStats).mockResolvedValue({ days: expected, truncated: false, reactionsReadable: true, rows: [] })
    await GET(new NextRequest(`http://x/api?days=${raw}`), ctx)
    expect(readSendStats).toHaveBeenCalledWith(expect.anything(), 'client-a', expected)
  })

  it('passes an access failure through and reads nothing', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 403, error: 'no' } as never)
    expect((await GET(new NextRequest('http://x/api'), ctx)).status).toBe(403)
    expect(readSendStats).not.toHaveBeenCalled()
  })

  it('503 with a plain sentence when the read fails (never an empty list)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(readSendStats).mockRejectedValue(new Error('boom'))
    const res = await GET(new NextRequest('http://x/api'), ctx)
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('boom')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  touchError: null as { message: string } | null,
  touchRows: [] as Array<{ occurred_at: string }>,
  cronRow: null as { finished_at: string } | null,
  cronError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const q = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () =>
        Promise.resolve(
          table === 'cron_run_logs'
            ? { data: m.cronError ? null : m.cronRow, error: m.cronError }
            : { data: null, error: null },
        ),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          table === 'contact_touchpoints'
            ? { data: m.touchError ? null : m.touchRows, error: m.touchError }
            : { data: [], error: null },
        ).then(resolve),
    }
    return q
  }
  return { supabaseAdmin: { from: chain } }
})

import { GET } from './route'

const CLIENT = '00000000-0000-0000-0000-000000000002'

describe('GET hourly-leads', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T03:30:00.000Z'))
    m.touchError = null
    m.touchRows = []
    m.cronRow = { finished_at: '2026-10-20T02:25:00.000Z' }
    m.cronError = null
  })

  it('client viewer gets no jobName', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'client', role: 'client', allowedClientId: CLIENT })
    const res = await GET(new NextRequest('http://x'), { params: { id: CLIENT } })
    const body = await res.json() as Record<string, unknown>
    expect(body.viewer).toBe('client')
    expect(body.jobName).toBeUndefined()
    expect(body.unreadable).toBe(false)
  })

  it('touchpoints read error → unreadable, not zero chart', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
    m.touchError = { message: 'db down' }
    const res = await GET(new NextRequest('http://x'), { params: { id: CLIENT } })
    const body = await res.json() as { unreadable: boolean; chart?: unknown }
    expect(body.unreadable).toBe(true)
    expect(body.chart).toBeUndefined()
  })
})

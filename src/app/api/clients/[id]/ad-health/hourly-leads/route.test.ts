import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  touchError: null as { message: string } | null,
  /** 从这一页的 from 起返回错误，用来模拟读到一半失败。null = 不注入。 */
  touchFailFrom: null as number | null,
  touchRows: [] as Array<{ occurred_at: string }>,
  ranges: [] as Array<[number, number]>,
  cronRow: null as { finished_at: string } | null,
  cronError: null as { message: string } | null,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    let rangeFrom = 0
    let rangeTo = 999
    const q = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      order: () => q,
      limit: () => q,
      range: (from: number, to: number) => {
        rangeFrom = from
        rangeTo = to
        if (table === 'contact_touchpoints') m.ranges.push([from, to])
        return q
      },
      maybeSingle: () =>
        Promise.resolve(
          table === 'cron_run_logs'
            ? { data: m.cronError ? null : m.cronRow, error: m.cronError }
            : { data: null, error: null },
        ),
      then: (resolve: (v: unknown) => unknown) => {
        if (table !== 'contact_touchpoints') {
          return Promise.resolve({ data: [], error: null }).then(resolve)
        }
        if (m.touchError) {
          return Promise.resolve({ data: null, error: m.touchError }).then(resolve)
        }
        if (m.touchFailFrom !== null && rangeFrom >= m.touchFailFrom) {
          return Promise.resolve({ data: null, error: { message: 'page failed' } }).then(resolve)
        }
        const page = m.touchRows.slice(rangeFrom, rangeTo + 1).slice(0, 1000)
        return Promise.resolve({ data: page, error: null }).then(resolve)
      },
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
    m.touchFailFrom = null
    m.touchRows = []
    m.ranges = []
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

  it('pages past the 1000-row cap so the newest lead is kept', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
    const old = { occurred_at: '2026-09-25T01:00:00.000Z' }
    const todayLead = { occurred_at: '2026-10-20T01:00:00.000Z' }
    m.touchRows = [...Array.from({ length: 1000 }, () => old), todayLead]
    const res = await GET(new NextRequest('http://x'), { params: { id: CLIENT } })
    const body = await res.json() as {
      unreadable: boolean
      chart: { totals: { todaySoFar: number } }
    }
    expect(m.ranges).toEqual([[0, 999], [1000, 1999]])
    expect(body.unreadable).toBe(false)
    expect(body.chart.totals.todaySoFar).toBe(1)
  })

  it('incomplete page read → unreadable', async () => {
    m.access.mockResolvedValue({ ok: true, tier: 'admin', role: 'admin', allowedClientId: null })
    m.touchRows = Array.from({ length: 1001 }, () => ({ occurred_at: '2026-10-20T01:00:00.000Z' }))
    m.touchFailFrom = 1000
    const res = await GET(new NextRequest('http://x'), { params: { id: CLIENT } })
    const body = await res.json() as { unreadable: boolean; message?: string; chart?: unknown }
    expect(body.unreadable).toBe(true)
    expect(body.message).toBe('读不到')
    expect(body.chart).toBeUndefined()
  })
})

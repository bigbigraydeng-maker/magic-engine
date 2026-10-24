/**
 * POST /api/clients/[id]/ad-health/execute-prescription
 *
 * Locks two things: only internal accounts may run it (requirePlanApproverAccess), and a
 * successful run in the last 10 minutes blocks a second one (approximate de-dup via
 * winner_reel_sync_log).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  sync: vi.fn(),
  cfgEnabled: true,
  recentRows: [] as Array<{ id: string }>,
  logFilters: [] as Array<[string, unknown]>,
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePlanApproverAccess: m.access }))
vi.mock('@/lib/winner-reel-sync/engine', () => ({ syncWinnerReels: m.sync }))
vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (col: string, val: unknown) => {
      if (table === 'winner_reel_sync_log') m.logFilters.push([`eq:${col}`, val])
      return q
    }
    q.gte = (col: string, val: unknown) => {
      m.logFilters.push([`gte:${col}`, val])
      return q
    }
    q.limit = () => Promise.resolve({ data: m.recentRows, error: null })
    q.maybeSingle = () => Promise.resolve({ data: { enabled: m.cfgEnabled }, error: null })
    return q
  }
  return { supabaseAdmin: { from: chain } }
})

import { POST } from './route'

const CLIENT = 'c0000000-0000-0000-0000-00000000000a'

function post(body: unknown = { kind: 'refresh_creatives' }) {
  return POST(
    new NextRequest(`http://localhost/api/clients/${CLIENT}/ad-health/execute-prescription`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: { id: CLIENT } },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.cfgEnabled = true
  m.recentRows = []
  m.logFilters.length = 0
  m.access.mockResolvedValue({ ok: true, tier: 'admin', user: { id: 'u1' } })
  m.sync.mockResolvedValue({ status: 'ok', postsScanned: 4, adsAdded: [{ name: 'Reel A', score: 9 }], guardsHit: [] })
})

describe('execute-prescription — access', () => {
  it('🔴 non-internal account → 403, sync engine never runs', async () => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: '批准和修改推广计划需要 Magic Lab 内部账号', reason: 'approver_only' })
    const res = await post()
    expect(res.status).toBe(403)
    expect(m.sync).not.toHaveBeenCalled()
  })
})

describe('execute-prescription — 10 minute de-dup', () => {
  it('no recent successful run → runs the sync once', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(m.sync).toHaveBeenCalledTimes(1)
    const filters = Object.fromEntries(m.logFilters)
    expect(filters['eq:client_id']).toBe(CLIENT)
    expect(filters['eq:status']).toBe('ok')
    const since = Date.parse(filters['gte:run_at'] as string)
    expect(Date.now() - since).toBeGreaterThan(9 * 60 * 1000)
    expect(Date.now() - since).toBeLessThan(11 * 60 * 1000)
  })

  it('🔴 a successful run logged within 10 minutes → 429, sync engine not called', async () => {
    m.recentRows = [{ id: 'log-1' }]
    const res = await post()
    expect(res.status).toBe(429)
    expect((await res.json()).recently_run).toBe(true)
    expect(m.sync).not.toHaveBeenCalled()
  })
})

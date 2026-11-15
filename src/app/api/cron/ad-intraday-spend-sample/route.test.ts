import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: vi.fn() }))

import { GET } from './route'

describe('GET ad-intraday-spend-sample', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects a missing secret', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await GET(new NextRequest('http://localhost/api/cron/ad-intraday-spend-sample?dry_run=1'))
    expect(res.status).toBe(401)
  })

  it('dry_run replays the fixture and does not call fetch', async () => {
    vi.stubEnv('CRON_SECRET', 'trial')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const before = fetchSpy.mock.calls.length
    const res = await GET(new NextRequest('http://localhost/api/cron/ad-intraday-spend-sample?dry_run=1', {
      headers: { authorization: 'Bearer trial' },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dry_run ?? body.dryRun).toBe(true)
    expect(body.rows).toBe(2)
    expect(body.purged).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.overCapClients).toHaveLength(1)
    expect(body.proposal.cards).toBe(1)
    expect(body.proposal.todos).toBe(0)
    expect(body.proposal.action).toBe('decrease')
    expect(body.cpl).toMatchObject({ cards: 1, kind: 'judged' })
    expect(fetchSpy.mock.calls.length).toBe(before)
  })
})

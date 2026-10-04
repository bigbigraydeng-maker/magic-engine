import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  conns: [] as Array<{ client_id: string; config: { property_id?: string } | null }>,
  raw: null as unknown,
  throwErr: false,
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: h.conns, error: null })
  return { supabaseAdmin: { from: () => chain } }
})
vi.mock('@/lib/ga4/client', () => ({
  fetchGa4FormFunnelRaw: async () => {
    if (h.throwErr) throw new Error('boom')
    return h.raw
  },
}))

import { GET } from '../route'

const req = (qs = '', auth?: string) =>
  new NextRequest(`http://x/api/cron/ga4-form-funnel${qs}`, { headers: auth ? { authorization: auth } : {} })
const RAW = { periodStart: 'a', periodEnd: 'b', events: { form_start: { events: 10, users: 8 } }, startByPath: [], thankYouByPath: [{ path: '/thank-you', events: 3, users: 2 }] }

describe('GET /api/cron/ga4-form-funnel', () => {
  afterEach(() => {
    delete process.env.CRON_SECRET
    h.conns = []
    h.raw = null
    h.throwErr = false
  })

  it('fails closed without the secret / wrong bearer; rejects a non-UUID client_id', async () => {
    expect((await GET(req())).status).toBe(500)
    process.env.CRON_SECRET = 's'
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('', 'Bearer nope'))).status).toBe(401)
    expect((await GET(req("?client_id=x'%20or%201=1", 'Bearer s'))).status).toBe(400)
  })

  it('reports per client, read-only, with the summary; skips a connection without a property id', async () => {
    process.env.CRON_SECRET = 's'
    h.conns = [{ client_id: 'c1', config: { property_id: '123' } }, { client_id: 'c2', config: {} }]
    h.raw = RAW
    const res = await GET(req('?dry_run=1', 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.read_only).toBe(true)
    expect(body.results[0].summary.proxyAbandonRate).toBeCloseTo(0.75, 5)
    expect(body.results[1].status).toBe('no_ga4_connection')
  })

  it('a failed GA4 read is reported (HTTP 500) with a trimmed message — never silently empty', async () => {
    process.env.CRON_SECRET = 's'
    h.conns = [{ client_id: 'c1', config: { property_id: '123' } }]
    h.throwErr = true
    const res = await GET(req('', 'Bearer s'))
    expect(res.status).toBe(500)
    expect((await res.json()).results[0]).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('days is bounded (out-of-range falls back to 28)', async () => {
    process.env.CRON_SECRET = 's'
    h.raw = RAW
    const body = await (await GET(req('?days=9999', 'Bearer s'))).json()
    expect(body.days).toBe(28)
  })
})

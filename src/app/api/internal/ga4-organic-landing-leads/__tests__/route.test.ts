import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  conns: [] as Array<{ client_id: string; config: { property_id?: string } | null }>,
  raw: null as unknown,
  err: null as unknown,
  eqCalls: [] as unknown[][],
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (...a: unknown[]) => {
    h.eqCalls.push(a)
    return chain
  }
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: h.conns, error: null })
  return { supabaseAdmin: { from: () => chain } }
})
vi.mock('@/lib/ga4/client', () => {
  class Ga4ApiError extends Error {
    constructor(public httpStatus: number, public googleStatus: string, public googleReason: string, message: string) {
      super(message)
    }
  }
  return {
    Ga4ApiError,
    fetchGa4OrganicLandingLeadsRaw: async () => {
      if (h.err) throw h.err
      return h.raw
    },
  }
})

import { GET } from '../route'
import { Ga4ApiError } from '@/lib/ga4/client'

const CID = 'c0000000-0000-0000-0000-000000000000'
const req = (qs = '', auth?: string) =>
  new NextRequest(`http://x/api/internal/ga4-organic-landing-leads${qs}`, { headers: auth ? { authorization: auth } : {} })
const RAW = {
  periodStart: 'a', periodEnd: 'b', truncated: false,
  rows: [{ channel: 'Organic Search', landingPath: '/tours/a', event: 'enquiry_thank_you', events: 3, users: 2 }],
}

describe('GET /api/internal/ga4-organic-landing-leads', () => {
  it('a client with no landing/event configuration is reported not_configured and GA4 is never asked', async () => {
    process.env.CRON_SECRET = 's'
    const OTHER = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
    h.conns = [{ client_id: OTHER, config: { property_id: '123' } }]
    h.raw = RAW
    const body = await (await GET(req(`?client_id=${OTHER}`, 'Bearer s'))).json()
    expect(body.results[0].status).toBe('not_configured')
    expect(body.results[0].summary).toBeUndefined()
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
    h.conns = []
    h.raw = null
    h.err = null
    h.eqCalls = []
  })

  it('fails closed without the secret / wrong bearer; client_id is REQUIRED and must be a UUID', async () => {
    expect((await GET(req(`?client_id=${CID}`))).status).toBe(500)
    process.env.CRON_SECRET = 's'
    expect((await GET(req(`?client_id=${CID}`))).status).toBe(401)
    expect((await GET(req(`?client_id=${CID}`, 'Bearer nope'))).status).toBe(401)
    expect((await GET(req('', 'Bearer s'))).status).toBe(400)
    expect((await GET(req("?client_id=x'%20or%201=1", 'Bearer s'))).status).toBe(400)
  })

  it('reads ONLY the requested client, read-only, and returns the plain-sentence summary', async () => {
    process.env.CRON_SECRET = 's'
    h.conns = [{ client_id: CID, config: { property_id: '123' } }]
    h.raw = RAW
    const res = await GET(req(`?client_id=${CID}&dry_run=1`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.read_only).toBe(true)
    expect(body.results[0].summary.plain).toContain('enquiry_thank_you 共 3 次')
    expect(body.results[0].summary.buckets[0].landingClass).toBe('product')
    expect(h.eqCalls.some(c => c[0] === 'client_id' && c[1] === CID)).toBe(true)
  })

  it('a connection without a property id is reported, not failed', async () => {
    process.env.CRON_SECRET = 's'
    h.conns = [{ client_id: CID, config: {} }]
    const res = await GET(req(`?client_id=${CID}`, 'Bearer s'))
    expect(res.status).toBe(200)
    expect((await res.json()).results[0].status).toBe('no_ga4_connection')
  })

  it('no usable GA4 authorisation is shown as no_token but is NOT a failure (HTTP 200)', async () => {
    process.env.CRON_SECRET = 's'
    h.conns = [{ client_id: CID, config: { property_id: '123' } }]
    h.raw = null
    const res = await GET(req(`?client_id=${CID}`, 'Bearer s'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.failed).toBe(0)
    expect(body.results[0].status).toBe('no_token')
  })

  it('a failed GA4 read returns HTTP 500 with a FIXED short code — Google\'s response text never leaves the server', async () => {
    process.env.CRON_SECRET = 's'
    h.conns = [{ client_id: CID, config: { property_id: '123' } }]
    h.err = new Ga4ApiError(403, 'PERMISSION_DENIED', 'forbidden', 'User x@y.com has no access to properties/999')
    const res = await GET(req(`?client_id=${CID}`, 'Bearer s'))
    const text = JSON.stringify(await res.json())
    expect(res.status).toBe(500)
    expect(text).toContain('GA4 HTTP 403 PERMISSION_DENIED')
    expect(text).not.toContain('x@y.com')
    expect(text).not.toContain('properties/999')
  })

  it('days is bounded (out-of-range falls back to 28)', async () => {
    process.env.CRON_SECRET = 's'
    h.raw = RAW
    const body = await (await GET(req(`?client_id=${CID}&days=9999`, 'Bearer s'))).json()
    expect(body.days).toBe(28)
  })
})

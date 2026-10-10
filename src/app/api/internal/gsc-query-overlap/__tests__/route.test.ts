import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const CID = 'c0000000-0000-0000-0000-000000000000'

const h = vi.hoisted(() => ({
  conns: [] as unknown[],
  connsError: null as unknown,
  gscRows: null as unknown,
  gscThrows: null as unknown,
  calls: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.then = (resolve: (v: unknown) => void) => resolve({ data: h.conns, error: h.connsError })
    return c
  }
  return { supabaseAdmin: { from: () => chain() } }
})

vi.mock('@/lib/gsc/client', () => {
  class GscApiError extends Error {
    httpStatus: number
    googleStatus: string
    constructor(httpStatus: number, googleStatus: string) {
      super('secret google text')
      this.httpStatus = httpStatus
      this.googleStatus = googleStatus
    }
  }
  return {
    GscApiError,
    querySearchAnalyticsRows: async (_t: string, _s: string, q: unknown) => {
      h.calls.push(q)
      if (h.gscThrows) throw h.gscThrows
      return h.gscRows
    },
    withGscAccess: async (_c: string, fn: (t: string) => Promise<unknown>) => {
      if (h.gscRows === null && !h.gscThrows) return null
      return fn('tok')
    },
  }
})

import { GET } from '../route'
import { GscApiError } from '@/lib/gsc/client'

function req(qs: string, auth = 'Bearer s3cret'): NextRequest {
  return new NextRequest(`http://localhost/api/internal/gsc-query-overlap?${qs}`, {
    headers: { authorization: auth },
  })
}

describe('GET /api/internal/gsc-query-overlap', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cret'
    h.conns = [{ client_id: CID, config: { site_url: 'https://example.com/' } }]
    h.connsError = null
    h.gscRows = []
    h.gscThrows = null
    h.calls = []
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('rejects a wrong secret and a missing client_id', async () => {
    expect((await GET(req(`client_id=${CID}`, 'Bearer nope'))).status).toBe(401)
    expect((await GET(req('days=28'))).status).toBe(400)
  })

  it('reports no_gsc_connection without calling Google', async () => {
    h.conns = []
    const res = await GET(req(`client_id=${CID}`))
    expect((await res.json()).status).toBe('no_gsc_connection')
    expect(h.calls).toHaveLength(0)
  })

  it('reports no_token when no access token can be resolved', async () => {
    h.gscRows = null
    expect((await (await GET(req(`client_id=${CID}`))).json()).status).toBe('no_token')
  })

  it('returns overlapping queries and page pairs, asking Google for query+page rows', async () => {
    h.gscRows = [
      { keys: ['china tours', 'https://example.com/a'], clicks: 3, impressions: 40, ctr: 0.07, position: 5 },
      { keys: ['china tours', 'https://example.com/b/'], clicks: 1, impressions: 30, ctr: 0.03, position: 9 },
      { keys: ['only a', 'https://example.com/a'], clicks: 1, impressions: 50, ctr: 0.02, position: 4 },
    ]
    const body = await (await GET(req(`client_id=${CID}&days=14`))).json()
    expect(body.status).toBe('ok')
    expect(body.overlapping_queries).toBe(1)
    expect(body.pairs[0]).toMatchObject({ page_a: '/a', page_b: '/b', shared_queries: 1 })
    expect(body.rows_fetched).toBe(3)
    expect((h.calls[0] as { dimensions: string[] }).dimensions).toEqual(['query', 'page'])
  })

  it('shows a fixed short code, never Google text, when Google fails', async () => {
    h.gscThrows = new GscApiError(403, 'PERMISSION_DENIED', 'forbidden', 'x')
    const res = await GET(req(`client_id=${CID}`))
    const text = JSON.stringify(await res.json())
    expect(res.status).toBe(500)
    expect(text).toContain('GSC HTTP 403 PERMISSION_DENIED')
    expect(text).not.toContain('secret google text')
  })
})

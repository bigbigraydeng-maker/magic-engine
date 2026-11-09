// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('@/lib/gsc/__tests__/fake-db')).fakeDb.client }))

const fetchPage = vi.fn()
vi.mock('@/lib/gsc/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gsc/client')>('@/lib/gsc/client')
  return {
    ...actual,
    withGscAccess: async (_clientId: string, fn: (token: string) => Promise<unknown>) => fn('token'),
    querySearchAnalyticsRows: (...args: unknown[]) => fetchPage(...args),
  }
})

import { fakeDb } from '@/lib/gsc/__tests__/fake-db'
import { GscApiError } from '@/lib/gsc/client'
import { GET } from './route'

const A = 'c0000000-0000-0000-0000-000000000000'

function call(query: string, auth = 'Bearer secret'): Promise<Response> {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  return GET(new NextRequest(`http://localhost/api/internal/gsc-query-page-probe?${query}`, { headers }))
}

function row(query: string, page: string, clicks = 1) {
  return { keys: [query, page], clicks, impressions: clicks * 10, ctr: 0.1, position: 4 }
}

beforeEach(() => {
  process.env.CRON_SECRET = 'secret'
  fakeDb.reset()
  fetchPage.mockReset()
  fakeDb.tables.client_connectors = [{ client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: 'https://ctstours.example.com/' } }]
  fakeDb.tables.clients = [{ id: A, seo_config: { brand_terms: ['cts'] }, brand_aliases: [] }]
})

describe('GET /api/internal/gsc-query-page-probe', () => {
  it('refuses a missing / wrong secret, a missing client and out-of-range days', async () => {
    expect((await call(`client_id=${A}`, '')).status).toBe(401)
    expect((await call(`client_id=${A}`, 'Bearer nope')).status).toBe(401)
    expect((await call('client_id=not-a-uuid')).status).toBe(400)
    expect((await call(`client_id=${A}&days=0`)).status).toBe(400)
    expect((await call(`client_id=${A}&days=8`)).status).toBe(400)
    expect((await call(`client_id=${A}&days=abc`)).status).toBe(400)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('a client without a GSC connection is reported, nothing is fetched', async () => {
    fakeDb.tables.client_connectors = []
    const res = await call(`client_id=${A}`)
    expect((await res.json()).status).toBe('no_gsc_connection')
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('🔴 reports counts per day through the real row conversion, writes no table, and never returns query text', async () => {
    fetchPage.mockResolvedValue([
      row('cts tours secret-person-name', 'https://ctstours.example.com/a', 3),
      row('Cts Tours Secret-Person-Name', 'https://ctstours.example.com/a', 2),
      row('ctstour nz', 'https://ctstours.example.com/b'),
      row('great wall', 'https://ctstours.example.com/c', 5),
    ])
    const before = JSON.stringify(fakeDb.tables)
    const res = await call(`client_id=${A}&days=2`)
    const body = await res.json()
    const text = JSON.stringify(body)
    expect(res.status).toBe(200)
    expect(body.read_only).toBe(true)
    expect(body.reports).toHaveLength(2)
    expect(body.reports[0]).toMatchObject({ rows_from_google: 4, storable_rows: 4, duplicate_keys: 0, case_only_duplicates: 1, skipped_long_rows: 0 })
    expect(body.total_storable_rows).toBe(8)
    expect(body.avg_rows_per_day).toBe(4)
    expect(body.brand_split.status).toBe('ok')
    expect(body.brand_split.brand.clicks).toBe(10)
    expect(body.brand_split.suspect_missed_brand_count).toBe(1)
    expect(text).not.toContain('secret-person-name')
    expect(text).not.toContain('ctstour nz')
    expect(JSON.stringify(fakeDb.tables)).toBe(before)
  })

  it('reads a second page when the first one is full, and flags a day whose second page is full too', async () => {
    const full = Array.from({ length: 25000 }, (_v, i) => row(`q${i}`, 'https://ctstours.example.com/a'))
    fetchPage.mockResolvedValueOnce(full).mockResolvedValueOnce([row('tail', 'https://ctstours.example.com/a')])
    const one = await (await call(`client_id=${A}&days=1`)).json()
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[1][2]).toMatchObject({ startRow: 25000, dimensions: ['query', 'page'] })
    expect(one.reports[0]).toMatchObject({ rows_from_google: 25001, truncated_at_google_cap: false })

    fetchPage.mockReset()
    fetchPage.mockResolvedValue(full)
    const capped = await (await call(`client_id=${A}&days=1`)).json()
    expect(capped.reports[0].truncated_at_google_cap).toBe(true)
  })

  it('a client with no brand terms gets a status, not a split', async () => {
    fakeDb.tables.clients = [{ id: A, seo_config: {}, brand_aliases: [] }]
    fetchPage.mockResolvedValue([row('cts tours', 'https://ctstours.example.com/a')])
    const body = await (await call(`client_id=${A}&days=1`)).json()
    expect(body.brand_split).toEqual({ status: 'brand_terms_not_configured' })
  })

  it('a Google error is reported as a short fixed code, never Google\'s text', async () => {
    fetchPage.mockRejectedValue(new GscApiError(403, 'PERMISSION_DENIED', 'forbidden', 'User sample@example.com has no access', 'detail'))
    const res = await call(`client_id=${A}&days=1`)
    const text = await res.text()
    expect(res.status).toBe(500)
    expect(text).toContain('GSC HTTP 403 PERMISSION_DENIED')
    expect(text).not.toContain('sample@example.com')
  })
})

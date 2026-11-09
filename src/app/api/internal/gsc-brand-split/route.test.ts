// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('@/lib/gsc/__tests__/fake-db')).fakeDb.client }))

import { fakeDb } from '@/lib/gsc/__tests__/fake-db'
import { addDays, pacificDay } from '@/lib/gsc/page-daily-plan'
import { GET } from './route'

const A = 'c0000000-0000-0000-0000-000000000000'

function call(query: string, auth = 'Bearer secret'): Promise<Response> {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  return GET(new NextRequest(`http://localhost/api/internal/gsc-brand-split?${query}`, { headers }))
}

beforeEach(() => {
  process.env.CRON_SECRET = 'secret'
  fakeDb.reset()
  const day = addDays(pacificDay(new Date()), -6)
  fakeDb.tables.clients = [{ id: A, seo_config: { brand_terms: ['cts'] }, brand_aliases: [] }]
  fakeDb.tables.client_connectors = [{ client_id: A, anchor: 'gsc', status: 'connected', config: { site_url: 'https://ctstours.example.com/' } }]
  fakeDb.tables.gsc_query_page_daily = [
    { client_id: A, day, query: 'cts tours', page_url: 'https://x/a', page_key: 'x/a', clicks: 4, impressions: 40, position: 3 },
    { client_id: A, day, query: 'ctstour private-name', page_url: 'https://x/a', page_key: 'x/a', clicks: 1, impressions: 5, position: 9 },
    { client_id: A, day, query: 'great wall', page_url: 'https://x/b', page_key: 'x/b', clicks: 2, impressions: 20, position: 6 },
  ]
  fakeDb.tables.gsc_page_daily = [
    { client_id: A, day, page_url: 'https://x/a', page_key: 'x/a', clicks: 6, impressions: 60, ctr: 0.1, position: 3 },
    { client_id: A, day, page_url: 'https://x/b', page_key: 'x/b', clicks: 2, impressions: 20, ctr: 0.1, position: 6 },
  ]
})

describe('GET /api/internal/gsc-brand-split', () => {
  it('refuses a wrong secret, a bad client and out-of-range days', async () => {
    expect((await call(`client_id=${A}`, '')).status).toBe(401)
    expect((await call('client_id=x')).status).toBe(400)
    expect((await call(`client_id=${A}&days=6`)).status).toBe(400)
    expect((await call(`client_id=${A}&days=91`)).status).toBe(400)
  })

  it('🔴 returns bucket totals, the gap to page level and counts — never query text', async () => {
    const res = await call(`client_id=${A}`)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.brand.clicks).toBe(4)
    expect(body.non_brand.clicks).toBe(3)
    expect(body.suspect_missed_brand_count).toBe(1)
    expect(body.unattributed.clicks).toBe(1)
    expect(JSON.stringify(body)).not.toContain('private-name')
    expect(body.buckets).toBeUndefined()
  })

  it('a client with no brand terms is reported as not configured', async () => {
    fakeDb.tables.clients = [{ id: A, seo_config: {}, brand_aliases: [] }]
    const body = await (await call(`client_id=${A}`)).json()
    expect(body.status).toBe('brand_terms_not_configured')
  })
})

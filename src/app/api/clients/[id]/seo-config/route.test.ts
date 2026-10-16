// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', async () => ({ supabaseAdmin: (await import('@/lib/gsc/__tests__/fake-db')).fakeDb.client }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn(async () => ({ ok: true })) }))

import { fakeDb } from '@/lib/gsc/__tests__/fake-db'
import { PATCH } from './route'

const ID = 'c0000000-0000-0000-0000-000000000000'

function patch(body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/clients/${ID}/seo-config`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ id: ID }) })
}

beforeEach(() => {
  fakeDb.reset()
  fakeDb.tables.clients = [{ id: ID, seo_config: { weekly_blog: true } }]
})

describe('PATCH seo-config: brand terms', () => {
  it('stores trimmed, de-duplicated terms next to the existing keys', async () => {
    const res = await patch({ brand_terms: [' cts ', 'boying', 'cts'], brand_ambiguous_terms: ['china travel service'] })
    expect(res.status).toBe(200)
    const stored = fakeDb.tables.clients[0].seo_config as Record<string, unknown>
    expect(stored.weekly_blog).toBe(true)
    expect(stored.brand_terms).toEqual(['cts', 'boying'])
    expect(stored.brand_ambiguous_terms).toEqual(['china travel service'])
  })

  it('🔴 rejects what would match every query or is not a list of strings', async () => {
    for (const bad of [['', 'cts'], [' '], ['a'], ['!!'], 'cts', [5], [['cts']], Array.from({ length: 51 }, (_v, i) => `term${i}`), ['x'.repeat(61)]]) {
      const res = await patch({ brand_terms: bad })
      expect(res.status).toBe(400)
    }
    expect((fakeDb.tables.clients[0].seo_config as Record<string, unknown>).brand_terms).toBeUndefined()
  })

  it('a body with only a brand key is accepted (it is a known key)', async () => {
    expect((await patch({ brand_ambiguous_terms: [] })).status).toBe(200)
  })

  it('a body with no known key is still refused', async () => {
    expect((await patch({ nothing: true })).status).toBe(400)
  })
})

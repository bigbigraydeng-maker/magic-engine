import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ access: vi.fn(), allowed: vi.fn(), collect: vi.fn(), keywords: vi.fn(), db: vi.fn() }))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.access }))
vi.mock('@/lib/web-intelligence/contracts', () => ({ allowedClient: mocks.allowed }))
vi.mock('@/lib/web-intelligence/external-run', () => ({ collectAndRecordExternalObservations: mocks.collect }))
vi.mock('@/lib/web-intelligence/sources', () => ({ sourceDefaultUrls: (sourceId: string) => sourceId === 'travel-today' ? ['https://traveltoday.co.nz/news/'] : [] }))
vi.mock('@/lib/keywords/resolver', () => ({ getClientKeywords: mocks.keywords }))
vi.mock('@/lib/web-intelligence/operating-brief', () => ({ normalizeOperatingProducts: () => [] }))
vi.mock('@/lib/web-intelligence/profiles/travel', () => ({ deriveTravelScope: () => ({ market_ids: ['china'] }), travelMarketTerms: () => ['china'] }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.db } }))

import { POST } from '../route'

const request = (body: unknown) => new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('external web intelligence route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({ ok: true, role: 'admin' })
    mocks.allowed.mockReturnValue(true)
    mocks.keywords.mockResolvedValue({ keywords: ['china tours'] })
    mocks.db.mockReturnValue({ select: () => ({ eq: () => ({ or: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) }) })
    mocks.collect.mockResolvedValue({ error: null, observations: [{ title: 'signal' }], persisted: 1, duplicates: 0, rejected: 0, writeFailures: 0, runId: 'run-1' })
  })

  it('uses the registered industry media URL and returns a receipt', async () => {
    const response = await POST(request({ source_id: 'travel-today' }), { params: Promise.resolve({ id: 'client-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'travel-today', clientId: 'client-1', actorId: 'automation-lab/news-article-extractor',
      actorInput: expect.objectContaining({ startUrls: ['https://traveltoday.co.nz/news/'] }),
    }))
    await expect(response.json()).resolves.toMatchObject({ source_id: 'travel-today', persisted: 1, run_id: 'run-1' })
  })

  it('passes bounded SEEK queries to the job adapter', async () => {
    const response = await POST(request({ source_id: 'seek-nz', queries: [' China travel ', '', 'travel consultant'], max_results: 100 }), { params: Promise.resolve({ id: 'client-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'seek-nz', actorId: 'vewdUX0xT82kKEPPd',
      actorInput: expect.objectContaining({ searchQueries: ['China travel', 'travel consultant'], maxItems: 50 }),
    }))
  })

  it('rejects sources that are not enabled', async () => {
    const response = await POST(request({ source_id: 'facebook-group' }), { params: Promise.resolve({ id: 'client-1' }) })
    expect(response.status).toBe(400)
    expect(mocks.collect).not.toHaveBeenCalled()
  })

  it('requires administrator access', async () => {
    mocks.access.mockResolvedValue({ ok: true, role: 'member' })
    const response = await POST(request({ source_id: 'travel-today' }), { params: Promise.resolve({ id: 'client-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.collect).not.toHaveBeenCalled()
  })
})

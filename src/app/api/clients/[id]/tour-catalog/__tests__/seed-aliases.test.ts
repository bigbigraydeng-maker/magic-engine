import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAdmin: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/store', () => ({
  addAlias: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/seed', () => ({
  fetchFirstPartyFeed: vi.fn(),
  seedCatalog: vi.fn(),
}))

vi.mock('@/lib/web-intelligence/first-party-tours', () => ({
  firstPartyTourSourceUrl: vi.fn(),
}))

import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { addAlias } from '@/lib/tour-catalog/store'
import { fetchFirstPartyFeed, seedCatalog } from '@/lib/tour-catalog/seed'
import { firstPartyTourSourceUrl } from '@/lib/web-intelligence/first-party-tours'
import { POST as seedPOST } from '../seed/route'
import { POST as aliasesPOST } from '../aliases/route'

const requireCatalogAdminMock = vi.mocked(requireCatalogAdmin)
const addAliasMock = vi.mocked(addAlias)
const fetchFirstPartyFeedMock = vi.mocked(fetchFirstPartyFeed)
const seedCatalogMock = vi.mocked(seedCatalog)
const firstPartyTourSourceUrlMock = vi.mocked(firstPartyTourSourceUrl)

const CLIENT_ID = 'client-1'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function allowAccess(): void {
  requireCatalogAdminMock.mockResolvedValue({ ok: true, actor: 'admin@example.com' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /tour-catalog/seed', () => {
  it('returns 400 when domain is missing', async () => {
    allowAccess()
    const res = await seedPOST(makeRequest({}), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'domain_required' })
    expect(firstPartyTourSourceUrlMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the feed is not configured', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue(null)
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'feed_not_configured' })
    expect(fetchFirstPartyFeedMock).not.toHaveBeenCalled()
  })

  it('returns 502 when the feed fetch fails', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    fetchFirstPartyFeedMock.mockRejectedValue(new Error('feed_http_500'))
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'feed_unavailable',
      message: 'feed_http_500',
    })
    expect(seedCatalogMock).not.toHaveBeenCalled()
  })

  it('returns the seedCatalog result on success', async () => {
    allowAccess()
    firstPartyTourSourceUrlMock.mockReturnValue('https://example.com/feed.json')
    const feed = { source: 's', source_version: '1', products: [] }
    fetchFirstPartyFeedMock.mockResolvedValue(feed)
    const seedResult = {
      toursInserted: 2,
      departuresInserted: 3,
      skippedExisting: ['a/b/c'],
      notes: [],
    }
    seedCatalogMock.mockResolvedValue(seedResult)

    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ...seedResult })
    expect(seedCatalogMock).toHaveBeenCalledWith({}, CLIENT_ID, feed)
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAdminMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })
    const res = await seedPOST(makeRequest({ domain: 'example.com' }), makeParams())
    expect(res.status).toBe(403)
    expect(firstPartyTourSourceUrlMock).not.toHaveBeenCalled()
  })
})

describe('POST /tour-catalog/aliases', () => {
  it('returns 400 when alias or tourId is missing', async () => {
    allowAccess()
    const res = await aliasesPOST(makeRequest({ alias: 'x' }), makeParams())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'alias_and_tour_required' })
    expect(addAliasMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the alias is taken', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'alias_taken' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'alias_taken' })
  })

  it('returns 404 when the tour is not found', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: false, message: 'tour_not_found' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'tour_not_found' })
  })

  it('returns 200 with aliasNorm on success', async () => {
    allowAccess()
    addAliasMock.mockResolvedValue({ ok: true, aliasNorm: 'x' })
    const res = await aliasesPOST(
      makeRequest({ alias: 'X', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, aliasNorm: 'x' })
    expect(addAliasMock).toHaveBeenCalledWith({}, CLIENT_ID, 'X', 't1')
  })

  it('passes through the access denial response', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
    })
    requireCatalogAdminMock.mockResolvedValue({
      ok: false,
      response: denied as never,
    })
    const res = await aliasesPOST(
      makeRequest({ alias: 'x', tourId: 't1' }),
      makeParams(),
    )
    expect(res.status).toBe(403)
    expect(addAliasMock).not.toHaveBeenCalled()
  })
})

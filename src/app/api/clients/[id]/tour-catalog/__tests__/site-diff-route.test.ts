import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { blankTour } from '@/lib/tour-catalog/__tests__/content-fixture'
import { adminAccess } from './access-fixtures'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

const { requireCatalogAccess, getClientDomain, loadDraftCatalog, fetchFirstPartyFeed, firstPartyTourSourceUrl } = vi.hoisted(() => ({
  requireCatalogAccess: vi.fn(),
  getClientDomain: vi.fn(),
  loadDraftCatalog: vi.fn(),
  fetchFirstPartyFeed: vi.fn(),
  firstPartyTourSourceUrl: vi.fn(),
}))
vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAccess }))
vi.mock('@/lib/tour-catalog/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tour-catalog/store')>()),
  getClientDomain,
  loadDraftCatalog,
}))
vi.mock('@/lib/tour-catalog/seed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tour-catalog/seed')>()),
  fetchFirstPartyFeed,
}))
vi.mock('@/lib/web-intelligence/first-party-tours', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/web-intelligence/first-party-tours')>()),
  firstPartyTourSourceUrl,
}))

import { GET } from '../site-diff/route'

const CONTEXT = { params: Promise.resolve({ id: 'client-1' }) }
const call = () => GET(new NextRequest('http://localhost/api/clients/client-1/tour-catalog/site-diff?url=https://evil.example/feed'), CONTEXT)

const PRODUCT = {
  id: 'web-1',
  slug: 'sample-tour',
  destination: 'china',
  tier: 'classic',
  name: 'Sample tour',
  title: 'Sample tour',
  is_active: true,
  updated_at: '2026-01-01',
  departure_dates: [],
  departure_pricing: {},
  tour_cities: [],
  itinerary: [],
  inclusions: [],
  exclusions: [],
  hero_image: '/images/a.jpg',
}
const TOUR = blankTour({ title: 'Sample tour', heroImage: '/images/a.jpg' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com'))
  getClientDomain.mockResolvedValue('https://www.Example.co.nz/')
  firstPartyTourSourceUrl.mockReturnValue('https://www.example.co.nz/api/internal/tours')
  fetchFirstPartyFeed.mockResolvedValue({ source: 's', source_version: '1', products: [PRODUCT] })
  loadDraftCatalog.mockResolvedValue({ tours: [TOUR], departures: [], aliases: [] })
})

describe('GET site-diff', () => {
  it('reports a clean comparison', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      websiteTours: 1,
      catalogTours: 1,
      onlyOnWebsite: [],
      onlyInCatalog: [],
      differences: [],
      notes: [],
    })
  })

  it('reads the feed of the client’s registered domain, never an address from the request', async () => {
    await call()
    expect(firstPartyTourSourceUrl).toHaveBeenCalledWith('example.co.nz')
    expect(fetchFirstPartyFeed).toHaveBeenCalledWith('https://www.example.co.nz/api/internal/tours')
  })

  it('lists differing fields, tours on one side only, and what the reader could not take in', async () => {
    fetchFirstPartyFeed.mockResolvedValue({
      source: 's',
      source_version: '1',
      skipped_products: 2,
      products: [
        { ...PRODUCT, hero_image: '/images/other.jpg', departure_dates: ['sometime in May'] },
        { ...PRODUCT, slug: 'website-only', name: 'Website only' },
      ],
    })
    loadDraftCatalog.mockResolvedValue({
      tours: [TOUR, blankTour({ id: 't2', slug: 'catalog-only', name: 'Catalog only', sortOrder: 1 })],
      departures: [],
      aliases: [],
    })
    const body = await (await call()).json()
    expect(body.websiteTours).toBe(2)
    expect(body.catalogTours).toBe(2)
    expect(body.onlyOnWebsite).toEqual(['Website only'])
    expect(body.onlyInCatalog).toEqual(['Catalog only'])
    expect(body.differences).toEqual([
      { tourName: 'Sample tour', fieldLabel: '主图', website: '/images/other.jpg', catalog: '/images/a.jpg' },
      { tourName: 'Sample tour', fieldLabel: '出发日期', website: '["sometime in May"]', catalog: '[]' },
    ])
    expect(body.notes).toEqual(['有 2 个团读不出来，已跳过', 'china/classic/sample-tour：departure_unparseable:sometime in May'])
  })

  it.each([
    ['no domain registered', () => getClientDomain.mockResolvedValue(null), 400, 'no_domain'],
    ['no feed configured for the domain', () => firstPartyTourSourceUrl.mockReturnValue(null), 400, 'no_domain'],
    ['the feed cannot be fetched', () => fetchFirstPartyFeed.mockRejectedValue(new Error('feed_http_500')), 502, 'feed_unavailable'],
    ['the domain lookup fails', () => getClientDomain.mockRejectedValue(new Error('db')), 500, 'diff_failed'],
    ['the catalog cannot be loaded', () => loadDraftCatalog.mockRejectedValue(new Error('db')), 500, 'diff_failed'],
  ])('%s', async (_label, arrange, status, error) => {
    arrange()
    const res = await call()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error })
  })

  it('does nothing when access is denied, and asks for manage_settings', async () => {
    requireCatalogAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    const res = await call()
    expect(res.status).toBe(403)
    expect(requireCatalogAccess).toHaveBeenCalledWith('client-1', 'manage_settings')
    expect(getClientDomain).not.toHaveBeenCalled()
    expect(fetchFirstPartyFeed).not.toHaveBeenCalled()
    expect(loadDraftCatalog).not.toHaveBeenCalled()
  })

  it('never returns departure internals', async () => {
    loadDraftCatalog.mockResolvedValue({
      tours: [blankTour({ title: 'Sample tour', heroImage: '/images/a.jpg', managesDepartures: true })],
      departures: [{ id: 'd1', tourId: 'tour-blank', clientId: 'client-1', departOn: '2099-05-01', returnOn: null, priceTextOverride: null, status: 'open', internal: { airline: 'SECRET-AIR' }, updatedAt: 'v1' }],
      aliases: [],
    })
    const text = JSON.stringify(await (await call()).json())
    expect(text).toContain('出发日期')
    expect(text).not.toContain('SECRET-AIR')
  })
})

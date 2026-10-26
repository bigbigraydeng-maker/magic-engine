import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { blankTour, patchContext } from '@/lib/tour-catalog/__tests__/content-fixture'
import { adminAccess, editorAccess } from './access-fixtures'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))

const { requireCatalogAccess, updateTour, loadTourPatchContext } = vi.hoisted(() => ({
  requireCatalogAccess: vi.fn(),
  updateTour: vi.fn(),
  loadTourPatchContext: vi.fn(),
}))
vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAccess }))
vi.mock('@/lib/tour-catalog/store-edit', () => ({ updateTour }))
vi.mock('@/lib/tour-catalog/patch-context', () => ({ loadTourPatchContext }))

import { PATCH } from '../tours/[tourId]/route'

/**
 * PATCH tours/[tourId] with the REAL validator: the two tiers of design §6.11.1 item 6 as the
 * browser would meet them. The validator's context comes from loadTourPatchContext, and the tier
 * comes from the session's permissions — never from the request.
 */

const CLIENT_ID = 'client-1'
const TOUR_ID = '11111111-1111-4111-8111-111111111111'
const POOL_IMAGE = 'https://img.example-cdn.com/a.jpg'
const EXISTING = blankTour({ id: TOUR_ID, heroImage: POOL_IMAGE, gallery: [POOL_IMAGE] })

function request(patch: unknown): NextRequest {
  return new NextRequest('http://localhost/test', {
    method: 'PATCH',
    body: JSON.stringify({ expectedUpdatedAt: 'v1', patch }),
    headers: { 'content-type': 'application/json' },
  })
}
const context = () => ({ params: Promise.resolve({ id: CLIENT_ID, tourId: TOUR_ID }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  updateTour.mockResolvedValue({ ok: true, value: EXISTING })
  // The loader is handed the tier; give back a context that reflects exactly what it was told.
  loadTourPatchContext.mockImplementation(async (_db: unknown, _client: string, _tour: string, canEditSite: boolean) =>
    patchContext({ canEditSite, imagePool: new Set([POOL_IMAGE]), existingTour: EXISTING, imageHosts: ['img.example-cdn.com'] }),
  )
})

describe('client editor', () => {
  beforeEach(() => requireCatalogAccess.mockResolvedValue(editorAccess('staff@client.example')))

  it('the validator is told this caller has no edit_site, for this client and this tour', async () => {
    await PATCH(request({ name: 'Renamed' }), context())
    expect(loadTourPatchContext).toHaveBeenCalledWith({ marker: 'db' }, CLIENT_ID, TOUR_ID, false)
  })

  it.each([
    ['rating', 4.9],
    ['reviewCount', 500],
    ['reviewSummary', 'Best ever'],
    ['metaTitle', 'T'],
    ['metaDescription', 'D'],
    ['tags', ['a']],
    ['faqs', []],
    ['quickAnswer', 'Q'],
  ])('403 Forbidden and nothing saved when the patch carries %s', async (key, value) => {
    const res = await PATCH(request({ name: 'Renamed', [key]: value }), context())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('403 for an image address that is not already in the catalog, even on an allowed host', async () => {
    for (const patch of [{ heroImage: 'https://img.example-cdn.com/new.jpg' }, { gallery: [POOL_IMAGE, '/images/new.jpg'] }]) {
      const res = await PATCH(request(patch), context())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    }
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('403 for adding an operator logo', async () => {
    const res = await PATCH(request({ itinerary: [{ day: 1, title: 'T', description: '', operatorLogo: { src: POOL_IMAGE, alt: 'x' } }] }), context())
    expect(res.status).toBe(403)
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('200 for the fields an editor may change, saved under the session email', async () => {
    const res = await PATCH(request({ soldOut: true, singleSupplementNote: 'Limited rooms', gallery: [], heroImage: POOL_IMAGE }), context())
    expect(res.status).toBe(200)
    expect(updateTour).toHaveBeenCalledWith(
      { marker: 'db' },
      CLIENT_ID,
      TOUR_ID,
      'v1',
      { sold_out: true, single_supplement_note: 'Limited rooms', gallery: [], hero_image: POOL_IMAGE },
      'staff@client.example',
    )
  })

  it('a canEditSite flag smuggled into the body changes nothing', async () => {
    const req = new NextRequest('http://localhost/test', {
      method: 'PATCH',
      body: JSON.stringify({ expectedUpdatedAt: 'v1', canEditSite: true, permissions: { edit_site: true }, patch: { metaTitle: 'T' } }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, context())
    expect(res.status).toBe(403)
    expect(loadTourPatchContext).toHaveBeenCalledWith({ marker: 'db' }, CLIENT_ID, TOUR_ID, false)
  })
})

describe('global admin', () => {
  beforeEach(() => requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com')))

  it('the validator is told this caller has edit_site', async () => {
    await PATCH(request({ name: 'Renamed' }), context())
    expect(loadTourPatchContext).toHaveBeenCalledWith({ marker: 'db' }, CLIENT_ID, TOUR_ID, true)
  })

  it('saves site-only fields and a new image on an allowed host', async () => {
    const res = await PATCH(request({ metaTitle: 'T', rating: 4.8, heroImage: 'https://img.example-cdn.com/new.jpg' }), context())
    expect(res.status).toBe(200)
    expect(updateTour.mock.calls[0][4]).toEqual({ meta_title: 'T', rating: 4.8, hero_image: 'https://img.example-cdn.com/new.jpg' })
  })

  it('400 with field paths for content that breaks the rules', async () => {
    const res = await PATCH(
      request({ rating: 4.85, gallery: [POOL_IMAGE, 'https://elsewhere.example.org/x.jpg'], faqs: [{ question: 'Q', answer: 'A', link: { href: 'https://x.example', label: 'L' } }] }),
      context(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'invalid_fields',
      fields: [
        { field: 'gallery[1]', code: 'image_host_not_allowed' },
        { field: 'faqs[0].link.href', code: 'invalid_link' },
        { field: 'rating', code: 'invalid_number' },
      ],
    })
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('400 for siteExtras: it is not an editable field for anyone', async () => {
    const res = await PATCH(request({ siteExtras: { related_blog_slugs: ['x'] } }), context())
    expect(res.status).toBe(400)
    expect(updateTour).not.toHaveBeenCalled()
  })
})

describe('context', () => {
  beforeEach(() => requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com')))

  it('404 when the tour is not in this client’s catalog — before any validation or save', async () => {
    loadTourPatchContext.mockResolvedValue(null)
    const res = await PATCH(request({ name: 'X' }), context())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('500 and nothing saved when the context cannot be loaded (fails closed)', async () => {
    loadTourPatchContext.mockRejectedValue(new Error('db down'))
    const res = await PATCH(request({ name: 'X' }), context())
    expect(res.status).toBe(500)
    expect(updateTour).not.toHaveBeenCalled()
  })

  it('does not load anything when access is denied', async () => {
    const { NextResponse } = await import('next/server')
    requireCatalogAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    const res = await PATCH(request({ name: 'X' }), context())
    expect(res.status).toBe(403)
    expect(loadTourPatchContext).not.toHaveBeenCalled()
  })
})

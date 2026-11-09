import { describe, expect, it } from 'vitest'
import { tourPatchToDb, validateTourPatch } from '../edit-validation'
import { SITE_ONLY_PATCH_KEYS } from '../content-validation'
import { blankTour, patchContext } from './content-fixture'

/**
 * The two permission tiers of design §6.11.1 item 6, through the one entry point every caller
 * uses. `forbidden: true` is what the route turns into 403.
 */

const POOL_IMAGE = 'https://img.example-cdn.com/tours/a.jpg'
const LOGO = { src: '/images/logos/air.png', alt: 'Sample Air' }
const EXISTING = blankTour({
  heroImage: POOL_IMAGE,
  gallery: [POOL_IMAGE, '/images/tours/b.jpg'],
  itinerary: [
    { day: 1, title: 'Arrive', description: 'A', accommodation: 'Hotel One', operatorLogo: LOGO },
    { day: 2, title: 'Wall', description: 'B', festiveLabel: 'Lantern Festival' },
  ],
})
const POOL = new Set([POOL_IMAGE, '/images/tours/b.jpg', LOGO.src])

const editor = (extra = {}) => patchContext({ canEditSite: false, imagePool: POOL, existingTour: EXISTING, ...extra })
const admin = (extra = {}) => patchContext({ canEditSite: true, imagePool: POOL, existingTour: EXISTING, ...extra })

const FORBIDDEN = { ok: false, forbidden: true, errors: [{ field: '*', code: 'forbidden' }] }

const SITE_VALUES: Record<string, unknown> = {
  rating: 4.8,
  reviewCount: 12,
  reviewSummary: 'Lovely',
  metaTitle: 'Title',
  metaDescription: 'Description',
  tags: ['small group'],
  faqs: [{ question: 'Q', answer: 'A', link: null }],
  quickAnswer: 'Nine days.',
}

describe('client editor (no edit_site)', () => {
  it('covers every site-only key in this test', () => {
    expect(Object.keys(SITE_VALUES).sort()).toEqual([...SITE_ONLY_PATCH_KEYS].sort())
  })

  it.each(Object.keys(SITE_VALUES))('is refused outright when the patch carries %s', (key) => {
    expect(validateTourPatch({ [key]: SITE_VALUES[key] }, editor())).toEqual(FORBIDDEN)
    // …even with a null, an invalid value, or next to a field they may edit.
    expect(validateTourPatch({ [key]: null }, editor())).toEqual(FORBIDDEN)
    expect(validateTourPatch({ [key]: { nonsense: true } }, editor())).toEqual(FORBIDDEN)
    expect(validateTourPatch({ name: 'Renamed', [key]: SITE_VALUES[key] }, editor())).toEqual(FORBIDDEN)
  })

  it('may edit the old fields, the single-supplement note and the sold-out switch', () => {
    const result = validateTourPatch({ name: 'Renamed', singleSupplementNote: ' Limited rooms ', soldOut: true }, editor())
    expect(result).toEqual({ ok: true, value: { name: 'Renamed', singleSupplementNote: 'Limited rooms', soldOut: true } })
  })

  it('may pick, reorder and remove images that are already in the catalog', () => {
    expect(validateTourPatch({ heroImage: '/images/tours/b.jpg' }, editor())).toEqual({ ok: true, value: { heroImage: '/images/tours/b.jpg' } })
    expect(validateTourPatch({ heroImage: null }, editor())).toEqual({ ok: true, value: { heroImage: null } })
    expect(validateTourPatch({ heroImage: '' }, editor())).toEqual({ ok: true, value: { heroImage: null } })
    expect(validateTourPatch({ gallery: ['/images/tours/b.jpg', POOL_IMAGE] }, editor())).toEqual({
      ok: true,
      value: { gallery: ['/images/tours/b.jpg', POOL_IMAGE] },
    })
    expect(validateTourPatch({ gallery: [] }, editor())).toEqual({ ok: true, value: { gallery: [] } })
  })

  it.each([
    ['a brand-new address on the allow-listed host', 'https://img.example-cdn.com/tours/new.jpg'],
    ['a new site path', '/images/tours/new.jpg'],
    ['a new address on the client domain', 'https://www.example.co.nz/new.jpg'],
    ['a javascript: address', 'javascript:alert(1)'],
  ])('is refused when the hero image is %s', (_label, address) => {
    const ctx = editor({ imageHosts: ['img.example-cdn.com'], clientDomain: 'example.co.nz' })
    expect(validateTourPatch({ heroImage: address }, ctx)).toEqual(FORBIDDEN)
    expect(validateTourPatch({ gallery: [POOL_IMAGE, address] }, ctx)).toEqual(FORBIDDEN)
  })

  it('may edit accommodation and festive labels while sending the logos back unchanged', () => {
    const itinerary = [
      { day: 1, title: 'Arrive', description: 'A', accommodation: 'Hotel Changed', operatorLogo: LOGO },
      { day: 2, title: 'Wall', description: 'B', festiveLabel: 'Spring Festival', accommodation: 'Hotel Two' },
    ]
    const result = validateTourPatch({ itinerary }, editor())
    expect(result).toEqual({ ok: true, value: { itinerary } })
  })

  it.each([
    ['removes a logo', [{ day: 1, title: 'Arrive', description: 'A' }, { day: 2, title: 'Wall', description: 'B' }]],
    ['sets a logo to null', [{ day: 1, title: 'Arrive', description: 'A', operatorLogo: null }, { day: 2, title: 'Wall', description: 'B' }]],
    ['adds a logo', [{ day: 1, title: 'Arrive', description: 'A', operatorLogo: LOGO }, { day: 2, title: 'Wall', description: 'B', operatorLogo: LOGO }]],
    ['changes a logo address', [{ day: 1, title: 'Arrive', description: 'A', operatorLogo: { ...LOGO, src: POOL_IMAGE } }, { day: 2, title: 'Wall', description: 'B' }]],
    ['changes a logo description', [{ day: 1, title: 'Arrive', description: 'A', operatorLogo: { ...LOGO, alt: 'Other Air' } }, { day: 2, title: 'Wall', description: 'B' }]],
    ['sends an unreadable logo', [{ day: 1, title: 'Arrive', description: 'A', operatorLogo: 'x' }, { day: 2, title: 'Wall', description: 'B' }]],
    ['drops the day that carries the logo', [{ day: 1, title: 'Wall', description: 'B' }]],
    ['moves the logo to another day', [{ day: 1, title: 'Arrive', description: 'A' }, { day: 2, title: 'Wall', description: 'B', operatorLogo: LOGO }]],
    ['changes a logo and also sends an invalid title', [{ day: 1, title: '', description: 'A', operatorLogo: { ...LOGO, alt: 'Other' } }, { day: 2, title: 'Wall', description: 'B' }]],
  ])('is refused when the itinerary %s', (_label, itinerary) => {
    expect(validateTourPatch({ itinerary }, editor())).toEqual(FORBIDDEN)
  })

  it('still gets ordinary field errors (400, not 403) for a mistake in a field they may edit', () => {
    const result = validateTourPatch({ name: '', soldOut: 'yes' }, editor())
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: 'name', code: 'required' },
        { field: 'soldOut', code: 'invalid_type' },
      ],
    })
  })
})

describe('global admin (edit_site)', () => {
  it('may set every site-only key', () => {
    const result = validateTourPatch(SITE_VALUES, admin())
    expect(result).toEqual({ ok: true, value: SITE_VALUES })
  })

  it('may enter a new image address, but only one that passes the image rules', () => {
    const ctx = admin({ imageHosts: ['img.example-cdn.com'], clientDomain: 'example.co.nz' })
    expect(validateTourPatch({ heroImage: 'https://img.example-cdn.com/new.webp' }, ctx).ok).toBe(true)
    expect(validateTourPatch({ heroImage: 'https://www.example.co.nz/new.jpg' }, ctx).ok).toBe(true)
    expect(validateTourPatch({ heroImage: '/images/new.png' }, ctx).ok).toBe(true)
    expect(validateTourPatch({ heroImage: 'https://elsewhere.example.org/new.jpg', gallery: [POOL_IMAGE, 'https://img.example-cdn.com/x.svg'] }, ctx)).toEqual({
      ok: false,
      errors: [
        { field: 'heroImage', code: 'image_host_not_allowed' },
        { field: 'gallery[1]', code: 'invalid_image_url' },
      ],
    })
  })

  it('may add, change and remove operator logos; a logo address is checked like any image', () => {
    const itinerary = [
      { day: 1, title: 'Arrive', description: 'A' },
      { day: 2, title: 'Wall', description: 'B', operatorLogo: { src: '/images/logos/new.png', alt: 'New Air' } },
    ]
    expect(validateTourPatch({ itinerary }, admin())).toEqual({ ok: true, value: { itinerary } })
    const bad = [{ day: 1, title: 'Arrive', description: 'A', operatorLogo: { src: 'https://elsewhere.example.org/l.png', alt: 'x' } }]
    expect(validateTourPatch({ itinerary: bad }, admin())).toEqual({
      ok: false,
      errors: [{ field: 'itinerary[0].operatorLogo.src', code: 'image_host_not_allowed' }],
    })
  })
})

describe('itinerary keeps only the keys it knows — now including the three day extras', () => {
  it('keeps accommodation, festiveLabel and operatorLogo and drops anything else', () => {
    const result = validateTourPatch(
      {
        itinerary: [
          { day: 1, title: 'Arrive', description: 'A', meals: ['Dinner'], accommodation: ' Hotel One ', festiveLabel: 'Lantern Festival', operatorLogo: { ...LOGO, extra: 1 }, internalNote: 'drop me' },
        ],
      },
      admin(),
    )
    expect(result).toEqual({
      ok: true,
      value: {
        itinerary: [
          { day: 1, title: 'Arrive', description: 'A', meals: ['Dinner'], accommodation: 'Hotel One', festiveLabel: 'Lantern Festival', operatorLogo: LOGO },
        ],
      },
    })
  })

  it('reports day-extra problems with their path', () => {
    const result = validateTourPatch(
      { itinerary: [{ day: 1, title: 'Arrive', description: 'A', accommodation: 'x'.repeat(301), festiveLabel: 'two\nlines' }] },
      admin(),
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: 'itinerary[0].accommodation', code: 'too_long' },
        { field: 'itinerary[0].festiveLabel', code: 'invalid_characters' },
      ],
    })
  })
})

describe('angle brackets are refused in every editable text, old fields included (design §6.11.1 item 5)', () => {
  it.each([
    ['name', { name: 'Tour <b>' }, 'name'],
    ['title', { title: 'a > b' }, 'title'],
    ['shortDescription', { shortDescription: 'line\n<script>' }, 'shortDescription'],
    ['durationText', { durationText: '<9 Days' }, 'durationText'],
    ['highlights', { highlights: ['ok', 'no <i>'] }, 'highlights'],
    ['inclusions', { inclusions: ['a > b'] }, 'inclusions'],
    ['exclusions', { exclusions: ['<'] }, 'exclusions'],
    ['tourCities', { tourCities: ['Xi>an'] }, 'tourCities'],
    ['itinerary title', { itinerary: [{ day: 1, title: 'T<', description: '' }] }, 'itinerary[0].title'],
    ['itinerary description', { itinerary: [{ day: 1, title: 'T', description: 'see </script>' }] }, 'itinerary[0].description'],
    ['itinerary meals', { itinerary: [{ day: 1, title: 'T', description: '', meals: ['<Dinner>'] }] }, 'itinerary[0].meals'],
    ['accommodation', { itinerary: [{ day: 1, title: 'T', description: '', accommodation: 'Hotel <5*>' }] }, 'itinerary[0].accommodation'],
    ['metaTitle', { metaTitle: '<title>' }, 'metaTitle'],
    ['faq answer', { faqs: [{ question: 'Q', answer: 'a <a href>', link: null }] }, 'faqs[0].answer'],
    ['tag', { tags: ['<b>'] }, 'tags[0]'],
  ])('%s', (_label, patch, field) => {
    const result = validateTourPatch(patch, admin())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual([{ field, code: 'invalid_characters' }])
  })
})

describe('tourPatchToDb', () => {
  it('maps the content keys to their columns alongside the old ones', () => {
    expect(tourPatchToDb({ name: 'N', heroImage: null, soldOut: true, metaTitle: 'T', faqs: [], rating: 4.5, reviewCount: 3 })).toEqual({
      name: 'N',
      hero_image: null,
      sold_out: true,
      meta_title: 'T',
      faqs: [],
      rating: 4.5,
      review_count: 3,
    })
  })

  it('never produces a site_extras column, whatever is passed in', () => {
    const sneaky = { siteExtras: { related_blog_slugs: ['x'] }, site_extras: { a: 1 } } as Record<string, unknown>
    expect(tourPatchToDb(sneaky)).toEqual({})
    const result = validateTourPatch({ siteExtras: { related_blog_slugs: ['x'] } }, admin())
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: 'siteExtras', code: 'field_not_editable' },
        { field: '*', code: 'empty_patch' },
      ],
    })
  })
})

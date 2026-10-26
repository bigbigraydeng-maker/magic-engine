import { describe, expect, it } from 'vitest'
import type { CatalogItineraryDay, CatalogTour } from '../types'
import type { FieldError } from '../text-rules'
import {
  SITE_ONLY_PATCH_KEYS,
  contentPatchToDb,
  operatorLogosChanged,
  slugifyTag,
  validateContentFields,
  validateDayExtras,
  type TourPatchContext,
} from '../content-validation'

const DOMAIN = 'example.co.nz'
const LISTED = 'cdn.example-images.com'
const POOL_IMAGE = 'https://' + LISTED + '/pool.jpg'

function makeTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-1',
    clientId: 'client-1',
    slug: 'grand-tour',
    destination: 'china',    tier: 'signature',
    name: 'Grand Tour',
    title: null,
    shortDescription: null,
    durationText: '10 days',
    displayPriceText: null,
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    singleSupplement: null,
    maxGroupSize: null,
    isActive: true,
    managesDepartures: true,
    sortOrder: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    heroImage: null,
    gallery: [],
    metaTitle: null,
    metaDescription: null,
    tags: [],
    faqs: [],
    soldOut: false,
    singleSupplementNote: null,
    rating: null,
    reviewCount: null,
    reviewSummary: null,
    quickAnswer: null,
    siteExtras: {},
    ...overrides,
  }
}

function makeCtx(overrides: Partial<TourPatchContext> = {}): TourPatchContext {
  return {
    imagePool: new Set<string>([POOL_IMAGE]),
    imageHosts: [LISTED],
    clientDomain: DOMAIN,
    canEditSite: true,
    existingTour: makeTour(),
    ...overrides,
  }
}

function run(input: Record<string, unknown>, ctx: TourPatchContext): { errors: FieldError[]; result: ReturnType<typeof validateContentFields> } {
  const errors: FieldError[] = []
  const result = validateContentFields(input, ctx, errors)
  return { errors, result }
}

describe('validateContentFields permissions', () => {
  it.each(SITE_ONLY_PATCH_KEYS)('marks %s forbidden for an editor', (key) => {
    const { result } = run({ [key]: null }, makeCtx({ canEditSite: false }))
    expect(result.forbidden).toBe(true)
  })

  it.each(SITE_ONLY_PATCH_KEYS)('does not mark %s forbidden for an admin', (key) => {
    const { result } = run({ [key]: null }, makeCtx({ canEditSite: true }))
    expect(result.forbidden).toBe(false)
  })

  it('lets an editor pick a pool image for heroImage and gallery', () => {
    const { result } = run({ heroImage: POOL_IMAGE, gallery: [POOL_IMAGE] }, makeCtx({ canEditSite: false }))
    expect(result.forbidden).toBe(false)
  })

  it('marks a new address forbidden for an editor', () => {
    const { result } = run({ heroImage: 'https://' + LISTED + '/new.jpg' }, makeCtx({ canEditSite: false }))
    expect(result.forbidden).toBe(true)
  })

  it('lets an editor set heroImage to null', () => {
    const { result } = run({ heroImage: null }, makeCtx({ canEditSite: false }))
    expect(result.forbidden).toBe(false)
  })
})

describe('validateContentFields images', () => {
  it('accepts an admin new address on an allowed host', () => {
    const { errors, result } = run({ heroImage: 'https://' + LISTED + '/new.jpg' }, makeCtx())
    expect(errors).toEqual([])
    expect(result.patch.heroImage).toBe('https://' + LISTED + '/new.jpg')
  })

  it('refuses an admin new address on an unknown host', () => {
    const { errors } = run({ heroImage: 'https://other.example/x.jpg' }, makeCtx())
    expect(errors).toEqual([{ field: 'heroImage', code: 'image_host_not_allowed' }])
  })

  it('reports gallery host errors at the input index', () => {
    const { errors } = run({ gallery: [POOL_IMAGE, 'https://other.example/x.jpg'] }, makeCtx())
    expect(errors).toEqual([{ field: 'gallery[1]', code: 'image_host_not_allowed' }])
  })

  it('refuses a gallery of 31 items', () => {
    const gallery = Array.from({ length: 31 }, () => POOL_IMAGE)
    const { errors } = run({ gallery }, makeCtx())
    expect(errors).toEqual([{ field: 'gallery', code: 'too_many_items' }])
  })
})

describe('validateContentFields faqs', () => {
  it('refuses 13 faqs', () => {
    const faqs = Array.from({ length: 13 }, () => ({ question: 'Q', answer: 'A' }))
    const { errors } = run({ faqs }, makeCtx())
    expect(errors).toEqual([{ field: 'faqs', code: 'too_many_items' }])
  })

  it('refuses a 301-char question and a 1001-char answer', () => {
    const { errors } = run(
      { faqs: [{ question: 'q'.repeat(301), answer: 'a'.repeat(1001) }] },
      makeCtx(),
    )
    expect(errors).toContainEqual({ field: 'faqs[0].question', code: 'too_long' })
    expect(errors).toContainEqual({ field: 'faqs[0].answer', code: 'too_long' })
  })

  it('requires a question', () => {
    const { errors } = run({ faqs: [{ answer: 'A' }] }, makeCtx())
    expect(errors).toContainEqual({ field: 'faqs[0].question', code: 'invalid_type' })
  })

  it.each(['https://x.com', '/api/x', '/admin', '/marketing/a', '/a//b', '/A', '/a?b=1'])(
    'refuses link href %s',
    (href) => {
      const { errors } = run({ faqs: [{ question: 'Q', answer: 'A', link: { href, label: 'L' } }] }, makeCtx())
      expect(errors).toContainEqual({ field: 'faqs[0].link.href', code: 'invalid_link' })
    },
  )

  it('keeps a good link and turns an omitted link into null', () => {
    const { errors, result } = run(
      { faqs: [{ question: 'Q', answer: 'A', link: { href: '/tours/x', label: 'L' } }, { question: 'Q2', answer: 'A2' }] },
      makeCtx(),
    )
    expect(errors).toEqual([])
    expect(result.patch.faqs).toEqual([
      { question: 'Q', answer: 'A', link: { href: '/tours/x', label: 'L' } },
      { question: 'Q2', answer: 'A2', link: null },
    ])
  })
})

describe('validateContentFields tags', () => {
  it('refuses 31 tags', () => {
    const tags = Array.from({ length: 31 }, (_, i) => 'tag' + i)
    const { errors } = run({ tags }, makeCtx())
    expect(errors).toEqual([{ field: 'tags', code: 'too_many_items' }])
  })

  it('refuses a 61-char tag', () => {
    const { errors } = run({ tags: ['t'.repeat(61)] }, makeCtx())
    expect(errors).toEqual([{ field: 'tags[0]', code: 'item_too_long' }])
  })

  it('refuses a tag with no alphanumerics', () => {
    const { errors } = run({ tags: ['!!!'] }, makeCtx())
    expect(errors).toEqual([{ field: 'tags[0]', code: 'invalid_tag' }])
  })

  it('refuses two tags with the same slug', () => {
    const { errors } = run({ tags: ['Great Wall', 'great-wall'] }, makeCtx())
    expect(errors).toEqual([{ field: 'tags[1]', code: 'duplicate_tag' }])
  })
})

describe('validateContentFields text fields', () => {
  it('refuses an over-long metaTitle and metaDescription', () => {
    const { errors } = run({ metaTitle: 'm'.repeat(121), metaDescription: 'd'.repeat(401) }, makeCtx())
    expect(errors).toContainEqual({ field: 'metaTitle', code: 'too_long' })
    expect(errors).toContainEqual({ field: 'metaDescription', code: 'too_long' })
  })

  it('refuses a line break in metaTitle', () => {
    const { errors } = run({ metaTitle: 'a\nb' }, makeCtx())
    expect(errors).toEqual([{ field: 'metaTitle', code: 'invalid_characters' }])
  })

  it('accepts a line break in quickAnswer and refuses 1501 chars', () => {
    const ok = run({ quickAnswer: 'a\nb' }, makeCtx())
    expect(ok.errors).toEqual([])
    const bad = run({ quickAnswer: 'q'.repeat(1501) }, makeCtx())
    expect(bad.errors).toEqual([{ field: 'quickAnswer', code: 'too_long' }])
  })

  it('refuses an angle bracket in a text field', () => {
    const { errors } = run({ metaTitle: 'a<b' }, makeCtx())
    expect(errors).toEqual([{ field: 'metaTitle', code: 'invalid_characters' }])
  })
})

describe('validateContentFields numbers and booleans', () => {
  it('accepts rating 4.8 and null', () => {
    expect(run({ rating: 4.8 }, makeCtx()).errors).toEqual([])
    expect(run({ rating: null }, makeCtx()).errors).toEqual([])
  })

  it.each([4.85, -0.1, 5.1, '4'])('refuses rating %s', (rating) => {
    const { errors } = run({ rating }, makeCtx())
    expect(errors).toEqual([{ field: 'rating', code: 'invalid_number' }])
  })

  it('accepts reviewCount 0 and refuses 1.5 and -1', () => {
    expect(run({ reviewCount: 0 }, makeCtx()).errors).toEqual([])
    expect(run({ reviewCount: 1.5 }, makeCtx()).errors).toEqual([{ field: 'reviewCount', code: 'invalid_number' }])
    expect(run({ reviewCount: -1 }, makeCtx()).errors).toEqual([{ field: 'reviewCount', code: 'invalid_number' }])
  })

  it('refuses a non-boolean soldOut', () => {
    const { errors } = run({ soldOut: 'yes' }, makeCtx())
    expect(errors).toEqual([{ field: 'soldOut', code: 'invalid_type' }])
  })
})

describe('validateDayExtras', () => {
  it('trims and keeps accommodation', () => {
    const errors: FieldError[] = []
    const out = validateDayExtras({ accommodation: '  Hotel X  ' }, 'itinerary[2]', makeCtx(), errors)
    expect(errors).toEqual([])
    expect(out).toEqual({ accommodation: 'Hotel X' })
  })

  it('refuses a 301-char accommodation', () => {
    const errors: FieldError[] = []
    validateDayExtras({ accommodation: 'a'.repeat(301) }, 'itinerary[2]', makeCtx(), errors)
    expect(errors).toEqual([{ field: 'itinerary[2].accommodation', code: 'too_long' }])
  })

  it('refuses a 61-char festiveLabel', () => {
    const errors: FieldError[] = []
    validateDayExtras({ festiveLabel: 'f'.repeat(61) }, 'itinerary[2]', makeCtx(), errors)
    expect(errors).toEqual([{ field: 'itinerary[2].festiveLabel', code: 'too_long' }])
  })

  it('accepts a logo with a pool src', () => {
    const errors: FieldError[] = []
    const out = validateDayExtras(
      { operatorLogo: { src: POOL_IMAGE, alt: 'Logo' } },
      'itinerary[2]',
      makeCtx(),
      errors,
    )
    expect(errors).toEqual([])
    expect(out).toEqual({ operatorLogo: { src: POOL_IMAGE, alt: 'Logo' } })
  })

  it('refuses a logo with an unknown host', () => {
    const errors: FieldError[] = []
    validateDayExtras(
      { operatorLogo: { src: 'https://other.example/x.jpg', alt: 'Logo' } },
      'itinerary[2]',
      makeCtx(),
      errors,
    )
    expect(errors).toEqual([{ field: 'itinerary[2].operatorLogo.src', code: 'image_host_not_allowed' }])
  })

  it('refuses a 201-char logo alt', () => {
    const errors: FieldError[] = []
    validateDayExtras(
      { operatorLogo: { src: POOL_IMAGE, alt: 'a'.repeat(201) } },
      'itinerary[2]',
      makeCtx(),
      errors,
    )
    expect(errors).toEqual([{ field: 'itinerary[2].operatorLogo.alt', code: 'too_long' }])
  })

  it('leaves keys absent for null values', () => {
    const errors: FieldError[] = []
    const out = validateDayExtras(
      { accommodation: null, festiveLabel: null, operatorLogo: null },
      'itinerary[2]',
      makeCtx(),
      errors,
    )
    expect(errors).toEqual([])
    expect(out).toEqual({})
  })
})

describe('operatorLogosChanged', () => {
  const withLogo = (day: number, src: string, alt: string): CatalogItineraryDay => ({
    day,
    title: 'Day ' + day,
    description: 'x',
    operatorLogo: { src, alt },
  })
  const plain = (day: number): CatalogItineraryDay => ({ day, title: 'Day ' + day, description: 'x' })

  it('is false for identical lists', () => {
    const a = [withLogo(1, POOL_IMAGE, 'L')]
    const b = [withLogo(1, POOL_IMAGE, 'L')]
    expect(operatorLogosChanged(a, b)).toBe(false)
  })

  it('is true when a logo is added', () => {
    expect(operatorLogosChanged([plain(1)], [withLogo(1, POOL_IMAGE, 'L')])).toBe(true)
  })

  it('is true when a logo is removed', () => {
    expect(operatorLogosChanged([withLogo(1, POOL_IMAGE, 'L')], [plain(1)])).toBe(true)
  })

  it('is true when a src changes', () => {
    expect(operatorLogosChanged([withLogo(1, POOL_IMAGE, 'L')], [withLogo(1, 'https://' + LISTED + '/other.jpg', 'L')])).toBe(true)
  })

  it('is true when an alt changes', () => {
    expect(operatorLogosChanged([withLogo(1, POOL_IMAGE, 'L')], [withLogo(1, POOL_IMAGE, 'M')])).toBe(true)
  })

  it('is true when a day carrying a logo is dropped from next', () => {
    expect(operatorLogosChanged([withLogo(1, POOL_IMAGE, 'L')], [])).toBe(true)
  })
})

describe('contentPatchToDb', () => {
  it('maps every key and omits absent keys', () => {
    const out = contentPatchToDb({
      heroImage: POOL_IMAGE,
      gallery: [POOL_IMAGE],
      metaTitle: 'T',
      metaDescription: 'D',
      tags: ['a'],
      faqs: [],
      soldOut: true,
      singleSupplementNote: 'N',
      rating: 4.8,
      reviewCount: 3,
      reviewSummary: 'S',
      quickAnswer: 'Q',
    })
    expect(out).toEqual({
      hero_image: POOL_IMAGE,
      gallery: [POOL_IMAGE],
      meta_title: 'T',
      meta_description: 'D',
      tags: ['a'],
      faqs: [],
      sold_out: true,
      single_supplement_note: 'N',
      rating: 4.8,
      review_count: 3,
      review_summary: 'S',
      quick_answer: 'Q',
    })
    expect(contentPatchToDb({})).toEqual({})
  })
})

describe('slugifyTag', () => {
  it('turns a range into a single dash', () => {
    expect(slugifyTag('10–16 small group')).toBe('10-16-small-group')
  })
})

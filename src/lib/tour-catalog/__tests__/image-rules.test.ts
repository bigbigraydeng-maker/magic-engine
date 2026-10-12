import { describe, expect, it } from 'vitest'
import type { CatalogTour } from '../types'
import {
  MAX_IMAGE_URL_LENGTH,
  collectImagePool,
  imageHostSuggestions,
  imageUrlIssue,
  imageUrlShapeIssue,
  isValidImageHost,
  type ImageRuleContext,
} from '../image-rules'

const DOMAIN = 'example.co.nz'
const LISTED = 'cdn.example-images.com'

function makeTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-1',
    clientId: 'client-1',
    slug: 'grand-tour',
    destination: 'china',
    tier: 'signature',
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

function makeCtx(overrides: Partial<ImageRuleContext> = {}): ImageRuleContext {
  return {
    imagePool: new Set<string>(),
    imageHosts: [LISTED],
    clientDomain: DOMAIN,
    ...overrides,
  }
}

describe('imageUrlIssue', () => {
  it('excuses an address already in the pool from the host list only', () => {
    const offList = 'https://not-listed.example/x.jpg'
    expect(imageUrlIssue(offList, makeCtx())).toBe('image_host_not_allowed')
    expect(imageUrlIssue(offList, makeCtx({ imagePool: new Set([offList]) }))).toBeNull()
  })

  it('still refuses an unsafe address that is already in the pool', () => {
    const long = 'https://' + LISTED + '/' + 'a'.repeat(900)
    const cases: Array<[string, string]> = [
      ['javascript:alert(1)', 'invalid_image_url'],
      ['data:image/png;base64,AAAA', 'invalid_image_url'],
      ['http://anything.example/x.jpg', 'invalid_image_url'],
      ['//evil.example/x.jpg', 'invalid_image_url'],
      ['https://' + LISTED + '/x.svg', 'invalid_image_url'],
      [long, 'too_long'],
    ]
    for (const [raw, expected] of cases) {
      expect(imageUrlIssue(raw, makeCtx({ imagePool: new Set([raw]) }))).toBe(expected)
    }
  })

  it('refuses markup, quotes, fragments and invisible characters in an https address', () => {
    const base = 'https://' + DOMAIN
    const bad = [
      base + '/</script><script>alert(1)</script>.jpg',
      base + '/a.jpg"onerror="alert(1)',
      base + "/a.jpg'onerror='alert(1)",
      base + '/a.jpg`',
      base + '/a.jpg#</script>',
      base + '/a.jpg#frag',
      base + '/a' + String.fromCharCode(0x200b) + '.jpg',
      base + '/a' + String.fromCharCode(0x202e) + '.jpg',
      base + '/a' + String.fromCharCode(0x2028) + '.jpg',
      base + '/a' + String.fromCharCode(0xfeff) + '.jpg',
      base + '/a' + String.fromCharCode(0x7f) + '.jpg',
      base + '/a\nb.jpg',
      base + '/a b.jpg',
      base + '/a{b}.jpg',
      base + '/a|b.jpg',
      base + '/a^b.jpg',
      'https://' + DOMAIN + '\\@evil.example/a.jpg',
      'https://exa mple.co.nz/a.jpg',
    ]
    for (const raw of bad) {
      expect(imageUrlIssue(raw, makeCtx()), raw).toBe('invalid_image_url')
      expect(imageUrlIssue(raw, makeCtx({ imagePool: new Set([raw]) })), raw).toBe('invalid_image_url')
    }
  })

  it('refuses svg however it is spelled in the path', () => {
    const base = 'https://' + LISTED
    const bad = [
      base + '/x.SvG',
      base + '/x.svgz',
      base + '/x.svg/',
      base + '/x.svg;v=1',
      base + '/x.svg/extra.png',
      base + '/x%2Esvg',
      base + '/x.%73vg',
      base + '/x.svg%3Fy.png',
      base + '/x.svg?download=1',
      base + '/%E0%A4%A.jpg',
    ]
    for (const raw of bad) expect(imageUrlIssue(raw, makeCtx()), raw).toBe('invalid_image_url')
    expect(imageUrlIssue(base + '/svg-icons/photo.png', makeCtx())).toBeNull()
    expect(imageUrlIssue(base + '/my.svgs/photo.png', makeCtx())).toBeNull()
  })

  it('accepts ordinary CDN addresses with a query string', () => {
    const ctx = makeCtx()
    expect(imageUrlIssue('https://' + LISTED + '/photo-1508804185872?w=1600&q=80&auto=format&fit=crop', ctx)).toBeNull()
    expect(imageUrlIssue('https://' + LISTED + '/storage/v1/object/public/a_b/c%20d~(1).JPG', ctx)).toBeNull()
  })

  it('imageUrlShapeIssue checks everything but the host', () => {
    expect(imageUrlShapeIssue('https://anywhere.example/a.jpg')).toBeNull()
    expect(imageUrlShapeIssue('/images/a.jpg')).toBeNull()
    expect(imageUrlShapeIssue('//evil.example/a.jpg')).toBe('invalid_image_url')
    expect(imageUrlShapeIssue('http://anywhere.example/a.jpg')).toBe('invalid_image_url')
    expect(imageUrlShapeIssue('https://anywhere.example/' + 'a'.repeat(600))).toBe('too_long')
  })

  it('refuses an address longer than the limit', () => {
    const raw = 'https://' + LISTED + '/' + 'a'.repeat(MAX_IMAGE_URL_LENGTH) + '.jpg'
    expect(raw.length).toBeGreaterThan(MAX_IMAGE_URL_LENGTH)
    expect(imageUrlIssue(raw, makeCtx())).toBe('too_long')
  })

  it('accepts a site-relative path under /images/', () => {
    expect(imageUrlIssue('/images/a/b.jpg', makeCtx())).toBeNull()
  })

  it('refuses bad site-relative paths', () => {
    const ctx = makeCtx()
    expect(imageUrlIssue('/images/a.svg', ctx)).toBe('invalid_image_url')
    expect(imageUrlIssue('/images/../x.jpg', ctx)).toBe('invalid_image_url')
    expect(imageUrlIssue('/images//x.jpg', ctx)).toBe('invalid_image_url')
    expect(imageUrlIssue('/other/x.jpg', ctx)).toBe('invalid_image_url')
    expect(imageUrlIssue('/images/x.jpg?x=1', ctx)).toBe('invalid_image_url')
    expect(imageUrlIssue('//evil.example/x.jpg', ctx)).toBe('invalid_image_url')
  })

  it('accepts https on the client domain and on a subdomain', () => {
    const ctx = makeCtx()
    expect(imageUrlIssue('https://example.co.nz/x.jpg', ctx)).toBeNull()
    expect(imageUrlIssue('https://www.example.co.nz/x.jpg', ctx)).toBeNull()
  })

  it('accepts https on a listed host', () => {
    expect(imageUrlIssue('https://' + LISTED + '/x.jpg', makeCtx())).toBeNull()
  })

  it('refuses an unlisted host', () => {
    expect(imageUrlIssue('https://other.example/x.jpg', makeCtx())).toBe('image_host_not_allowed')
  })

  it('refuses a look-alike host', () => {
    expect(imageUrlIssue('https://' + LISTED + '.evil.example/x.jpg', makeCtx())).toBe(
      'image_host_not_allowed',
    )
  })

  it('refuses malformed https addresses', () => {
    const ctx = makeCtx()
    const bad = [
      'https://user:pw@' + LISTED + '/x.jpg',
      'https://' + LISTED + ':8443/x.jpg',
      'http://' + LISTED + '/x.jpg',
      'HTTPS://' + LISTED + '/x.jpg',
      'https://' + LISTED + '/x.svg',
      'https://' + LISTED + '/x.SVG',
      'https://' + LISTED + '/x y.jpg',
      'https://' + LISTED + '/x\ty.jpg',
      'https://' + LISTED + '/x\\y.jpg',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ]
    for (const raw of bad) {
      expect(imageUrlIssue(raw, ctx)).toBe('invalid_image_url')
    }
  })

  it('accepts an https address with no extension on a listed host', () => {
    expect(imageUrlIssue('https://' + LISTED + '/image', makeCtx())).toBeNull()
  })
})

describe('collectImagePool', () => {
  it('de-dupes, sorts and includes logo src', () => {
    const tour = makeTour({
      heroImage: 'https://b.example/x.jpg',
      gallery: ['https://a.example/x.jpg', 'https://b.example/x.jpg'],
      itinerary: [
        { day: 1, title: 'Day 1', description: 'x', operatorLogo: { src: 'https://c.example/x.jpg', alt: 'C' } },
      ],
    })
    expect(collectImagePool([tour])).toEqual([
      'https://a.example/x.jpg',
      'https://b.example/x.jpg',
      'https://c.example/x.jpg',
    ])
  })
})

describe('imageHostSuggestions', () => {
  it('counts uses, orders by count then host, and excludes allowed hosts', () => {
    const tour = makeTour({
      heroImage: 'https://z.example/x.jpg',
      gallery: [
        'https://z.example/y.jpg',
        'https://a.example/x.jpg',
        'https://' + LISTED + '/x.jpg',
        'https://example.co.nz/x.jpg',
      ],
    })
    expect(imageHostSuggestions([tour], [LISTED], DOMAIN)).toEqual([
      { host: 'z.example', count: 2 },
      { host: 'a.example', count: 1 },
    ])
  })
})

describe('isValidImageHost', () => {
  it('accepts a bare lower-case hostname', () => {
    expect(isValidImageHost('cdn.example-images.com')).toBe(true)
  })

  it('refuses anything else', () => {
    const bad: unknown[] = [
      'Example.com',
      'example',
      'https://x.com',
      'x.com/path',
      'x.com:443',
      '10.0.0.1',
      '[::1]',
      '',
      12,
      'a'.repeat(250) + '.com',
    ]
    for (const value of bad) {
      expect(isValidImageHost(value)).toBe(false)
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  TOUR_FIELD_SPECS,
  computeDiffHash,
  diffCatalog,
  parsePublishedSnapshot,
  projectCatalog,
  renderField,
} from '../publish'
import type { CatalogContent } from '../publish'
import type { CatalogTour } from '../types'
import { blankTour } from './content-fixture'

const TODAY = '2026-10-10'

function oldShapeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    client_id: 'c1',
    slug: 's1',
    destination: 'china',
    tier: 'classic',
    name: 'Golden China',
    title: null,
    short_description: null,
    duration_text: '10 days',
    display_price_text: 'From NZD $4,999 per person',
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tour_cities: [],
    single_supplement: null,
    max_group_size: null,
    is_active: true,
    manages_departures: true,
    sort_order: 1,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function snapshotWith(row: Record<string, unknown>): unknown {
  return { schema_version: 1, tours: [row], departures: [] }
}

function parseOne(row: Record<string, unknown>): CatalogTour {
  const content = parsePublishedSnapshot(snapshotWith(row))
  expect(content).not.toBeNull()
  return content!.tours[0]
}

function draftFrom(tour: CatalogTour): CatalogContent {
  return { tours: [tour], departures: [] }
}

describe('parsePublishedSnapshot content columns', () => {
  it('reads old-shape rows with empty content defaults', () => {
    const tour = parseOne(oldShapeRow())
    expect(tour.heroImage).toBeNull()
    expect(tour.gallery).toEqual([])
    expect(tour.metaTitle).toBeNull()
    expect(tour.metaDescription).toBeNull()
    expect(tour.tags).toEqual([])
    expect(tour.faqs).toEqual([])
    expect(tour.soldOut).toBe(false)
    expect(tour.singleSupplementNote).toBeNull()
    expect(tour.rating).toBeNull()
    expect(tour.reviewCount).toBeNull()
    expect(tour.reviewSummary).toBeNull()
    expect(tour.quickAnswer).toBeNull()
    expect(tour.siteExtras).toEqual({})
  })

  it('does not drop a row with wrong-typed content columns', () => {
    const tour = parseOne(
      oldShapeRow({
        hero_image: 5,
        gallery: 'x',
        tags: {},
        faqs: 'x',
        sold_out: 'yes',
        rating: 'abc',
        review_count: null,
        site_extras: [],
      }),
    )
    expect(tour.heroImage).toBeNull()
    expect(tour.gallery).toEqual([])
    expect(tour.tags).toEqual([])
    expect(tour.faqs).toEqual([])
    expect(tour.soldOut).toBe(false)
    expect(tour.rating).toBeNull()
    expect(tour.reviewCount).toBeNull()
    expect(tour.siteExtras).toEqual({})
  })

  it('reads filled content columns through', () => {
    const tour = parseOne(
      oldShapeRow({
        hero_image: '/images/hero.jpg',
        gallery: ['/images/a.jpg'],
        meta_title: 'Meta title',
        meta_description: 'Meta description',
        tags: ['culture'],
        faqs: [{ question: 'Q1', answer: 'A1', link: { href: '/faq', label: 'More' } }],
        sold_out: true,
        single_supplement_note: 'Limited rooms',
        rating: '4.8',
        review_count: 12,
        review_summary: 'Lovely trip',
        quick_answer: 'A quick answer',
        site_extras: { related_blog_slugs: ['blog-one'] },
        itinerary: [
          {
            day: 1,
            title: 'Arrive',
            description: 'Welcome',
            accommodation: 'Hotel One',
            festiveLabel: 'Lantern Festival',
            operatorLogo: { src: '/images/air.png', alt: 'Sample Air' },
          },
        ],
      }),
    )
    expect(tour.heroImage).toBe('/images/hero.jpg')
    expect(tour.gallery).toEqual(['/images/a.jpg'])
    expect(tour.metaTitle).toBe('Meta title')
    expect(tour.metaDescription).toBe('Meta description')
    expect(tour.tags).toEqual(['culture'])
    expect(tour.faqs).toEqual([{ question: 'Q1', answer: 'A1', link: { href: '/faq', label: 'More' } }])
    expect(tour.soldOut).toBe(true)
    expect(tour.singleSupplementNote).toBe('Limited rooms')
    expect(tour.rating).toBe(4.8)
    expect(tour.reviewCount).toBe(12)
    expect(tour.reviewSummary).toBe('Lovely trip')
    expect(tour.quickAnswer).toBe('A quick answer')
    expect(tour.siteExtras).toEqual({ related_blog_slugs: ['blog-one'] })
    expect(tour.itinerary[0].accommodation).toBe('Hotel One')
    expect(tour.itinerary[0].festiveLabel).toBe('Lantern Festival')
    expect(tour.itinerary[0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
  })
})

describe('diffCatalog content columns', () => {
  it('reports no changes when the draft equals the parsed old-shape snapshot', () => {
    const published = parsePublishedSnapshot(snapshotWith(oldShapeRow()))
    expect(published).not.toBeNull()
    const diff = diffCatalog(published, draftFrom(published!.tours[0]), TODAY)
    expect(diff.changes).toEqual([])
  })

  it('reports a single change for each content field', () => {
    const base = blankTour({ id: 't1' })
    const published = draftFrom(base)

    const cases: Array<{ label: string; risk: 'high' | 'normal'; mutate: (t: CatalogTour) => CatalogTour }> = [
      { label: '主图', risk: 'high', mutate: (t) => ({ ...t, heroImage: '/images/hero.jpg' }) },
      { label: '整团售罄', risk: 'high', mutate: (t) => ({ ...t, soldOut: true }) },
      { label: '单房差说明', risk: 'high', mutate: (t) => ({ ...t, singleSupplementNote: 'Limited rooms' }) },
      { label: '评分', risk: 'high', mutate: (t) => ({ ...t, rating: 4.8 }) },
      { label: '评价数', risk: 'high', mutate: (t) => ({ ...t, reviewCount: 12 }) },
      { label: '评价摘要', risk: 'high', mutate: (t) => ({ ...t, reviewSummary: 'Lovely trip' }) },
      { label: '搜索标题', risk: 'high', mutate: (t) => ({ ...t, metaTitle: 'Meta title' }) },
      { label: '搜索描述', risk: 'high', mutate: (t) => ({ ...t, metaDescription: 'Meta description' }) },
      { label: '标签', risk: 'normal', mutate: (t) => ({ ...t, tags: ['culture'] }) },
      { label: '快速回答', risk: 'normal', mutate: (t) => ({ ...t, quickAnswer: 'A quick answer' }) },
      { label: '站点附加信息', risk: 'normal', mutate: (t) => ({ ...t, siteExtras: { related_blog_slugs: ['blog-one'] } }) },
      { label: '图集：新增', risk: 'normal', mutate: (t) => ({ ...t, gallery: ['/images/a.jpg'] }) },
    ]

    for (const testCase of cases) {
      const draft = draftFrom(testCase.mutate(base))
      const diff = diffCatalog(published, draft, TODAY)
      expect(diff.changes.length).toBe(1)
      expect(diff.changes[0].fieldLabel).toBe(testCase.label)
      expect(diff.changes[0].risk).toBe(testCase.risk)
    }
  })

  it('renders the sold-out flip with the right before and after', () => {
    const base = blankTour({ id: 't1' })
    const diff = diffCatalog(draftFrom(base), draftFrom({ ...base, soldOut: true }), TODAY)
    expect(diff.changes.length).toBe(1)
    expect(diff.changes[0].fieldLabel).toBe('整团售罄')
    expect(diff.changes[0].before).toBe('未售罄')
    expect(diff.changes[0].after).toBe('已售罄')
  })

  it('reports an added FAQ without a link as normal and with a link as high', () => {
    const base = blankTour({ id: 't1' })
    const withoutLink = diffCatalog(
      draftFrom(base),
      draftFrom({ ...base, faqs: [{ question: 'Q1', answer: 'A1', link: null }] }),
      TODAY,
    )
    expect(withoutLink.changes.length).toBe(1)
    expect(withoutLink.changes[0].risk).toBe('normal')

    const withLink = diffCatalog(
      draftFrom(base),
      draftFrom({ ...base, faqs: [{ question: 'Q1', answer: 'A1', link: { href: '/faq', label: 'More' } }] }),
      TODAY,
    )
    expect(withLink.changes.length).toBe(1)
    expect(withLink.changes[0].risk).toBe('high')
  })
})

describe('projected tour field coverage', () => {
  function mutate(tour: CatalogTour, key: string): CatalogTour {
    switch (key) {
      case 'slug':
        return { ...tour, slug: 's2' }
      case 'destination':
        return { ...tour, destination: 'japan' }
      case 'tier':
        return { ...tour, tier: 'discovery' }
      case 'name':
        return { ...tour, name: 'Another name' }
      case 'title':
        return { ...tour, title: 'A title' }
      case 'shortDescription':
        return { ...tour, shortDescription: 'A short description' }
      case 'durationText':
        return { ...tour, durationText: '12 days' }
      case 'displayPriceText':
        return { ...tour, displayPriceText: 'From NZD $5,999 per person' }
      case 'highlights':
        return { ...tour, highlights: ['Great wall'] }
      case 'itinerary':
        return { ...tour, itinerary: [{ day: 1, title: 'Arrive', description: 'Welcome' }] }
      case 'inclusions':
        return { ...tour, inclusions: ['Hotels'] }
      case 'exclusions':
        return { ...tour, exclusions: ['Flights'] }
      case 'tourCities':
        return { ...tour, tourCities: ['Beijing'] }
      case 'singleSupplement':
        return { ...tour, singleSupplement: 'From NZD $900' }
      case 'maxGroupSize':
        return { ...tour, maxGroupSize: 20 }
      case 'isActive':
        return { ...tour, isActive: !tour.isActive }
      case 'managesDepartures':
        return { ...tour, managesDepartures: !tour.managesDepartures }
      case 'sortOrder':
        return { ...tour, sortOrder: 5 }
      case 'heroImage':
        return { ...tour, heroImage: '/images/hero.jpg' }
      case 'gallery':
        return { ...tour, gallery: ['/images/a.jpg'] }
      case 'metaTitle':
        return { ...tour, metaTitle: 'Meta title' }
      case 'metaDescription':
        return { ...tour, metaDescription: 'Meta description' }
      case 'tags':
        return { ...tour, tags: ['culture'] }
      case 'faqs':
        return { ...tour, faqs: [{ question: 'Q1', answer: 'A1', link: null }] }
      case 'soldOut':
        return { ...tour, soldOut: true }
      case 'singleSupplementNote':
        return { ...tour, singleSupplementNote: 'Limited rooms' }
      case 'rating':
        return { ...tour, rating: 4.8 }
      case 'reviewCount':
        return { ...tour, reviewCount: 12 }
      case 'reviewSummary':
        return { ...tour, reviewSummary: 'Lovely trip' }
      case 'quickAnswer':
        return { ...tour, quickAnswer: 'A quick answer' }
      case 'siteExtras':
        return { ...tour, siteExtras: { related_blog_slugs: ['blog-one'] } }
      default:
        throw new Error('unhandled projected key: ' + key)
    }
  }

  it('reports at least one change for every projected field except id', () => {
    const base = blankTour({ id: 't1' })
    const published = draftFrom(base)
    const keys = Object.keys(projectCatalog(published).tours[0])
    for (const key of keys) {
      if (key === 'id') continue
      const draft = draftFrom(mutate(base, key))
      const diff = diffCatalog(published, draft, TODAY)
      expect(diff.changes.length, `key ${key} produced no change`).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('computeDiffHash', () => {
  it('differs when only heroImage differs', () => {
    const base = blankTour({ id: 't1' })
    const a = projectCatalog(draftFrom(base))
    const b = projectCatalog(draftFrom({ ...base, heroImage: '/images/hero.jpg' }))
    const hashA = computeDiffHash({
      publishedVersion: 0,
      draftVersion: 1,
      publishedProjection: null,
      draftProjection: a,
      highRiskCount: 0,
    })
    const hashB = computeDiffHash({
      publishedVersion: 0,
      draftVersion: 1,
      publishedProjection: null,
      draftProjection: b,
      highRiskCount: 0,
    })
    expect(hashA).not.toBe(hashB)
  })
})

describe('TOUR_FIELD_SPECS and renderField', () => {
  it('exposes the content field specs', () => {
    const byField = new Map(TOUR_FIELD_SPECS.map((spec) => [spec.field, spec]))
    expect(byField.get('heroImage')).toEqual({ field: 'heroImage', fieldLabel: '主图', risk: 'high' })
    expect(byField.get('soldOut')).toEqual({ field: 'soldOut', fieldLabel: '整团售罄', risk: 'high' })
    expect(byField.get('tags')).toEqual({ field: 'tags', fieldLabel: '标签', risk: 'normal' })
    expect(byField.get('quickAnswer')).toEqual({ field: 'quickAnswer', fieldLabel: '快速回答', risk: 'normal' })
  })

  it('renders booleans and arrays', () => {
    expect(renderField('soldOut', true)).toBe('已售罄')
    expect(renderField('soldOut', false)).toBe('未售罄')
    expect(renderField('managesDepartures', true)).toBe('是')
    expect(renderField('managesDepartures', false)).toBe('否')
    expect(renderField('tags', ['a', 'b'])).toBe('a；b')
  })
})

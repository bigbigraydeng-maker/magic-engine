import { describe, expect, it } from 'vitest'

import type { CatalogFaq } from '../catalog-contract'
import type { CatalogItineraryDay } from '../types'
import type { ProjectedTour } from '../publish-projection'
import {
  contentChanges,
  faqChanges,
  galleryChanges,
  itineraryChanges,
  siteExtrasChanges,
} from '../publish-content'

function makeProjected(overrides: Partial<ProjectedTour>): ProjectedTour {
  return {
    id: 'tour-1',
    slug: 'tour-1',
    destination: 'New Zealand',
    tier: 'classic',
    name: 'Sample Tour',
    title: null,
    shortDescription: null,
    durationText: null,
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

function day(overrides: Partial<CatalogItineraryDay>): CatalogItineraryDay {
  return {
    day: 1,
    title: 'T',
    description: 'D',
    ...overrides,
  }
}

function faq(overrides: Partial<CatalogFaq>): CatalogFaq {
  return {
    question: 'Q',
    answer: 'A',
    link: null,
    ...overrides,
  }
}

const TOUR_ID = 'tour-1'
const TOUR_NAME = 'Sample Tour'

describe('itineraryChanges', () => {
  it('returns nothing when the itineraries are identical', () => {
    const tour = makeProjected({ itinerary: [day({ meals: ['Breakfast', 'Dinner'] })] })
    expect(itineraryChanges(tour, tour, TOUR_ID, TOUR_NAME)).toEqual([])
  })

  it('reports a title change with the old rendering format', () => {
    const published = makeProjected({ itinerary: [day({ title: 'T', meals: ['Breakfast', 'Dinner'] })] })
    const draft = makeProjected({ itinerary: [day({ title: 'T2', meals: ['Breakfast', 'Dinner'] })] })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('行程 第 1 天')
    expect(rows[0].risk).toBe('normal')
    expect(rows[0].before).toBe('第 1 天｜T｜D｜餐：Breakfast/Dinner')
    expect(rows[0].after).toBe('第 1 天｜T2｜D｜餐：Breakfast/Dinner')
  })

  it('reports an accommodation-only change', () => {
    const published = makeProjected({ itinerary: [day({})] })
    const draft = makeProjected({ itinerary: [day({ accommodation: 'New Hotel' })] })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].risk).toBe('normal')
    expect(rows[0].after).toContain('｜住宿：New Hotel')
  })

  it('reports a festive label added', () => {
    const published = makeProjected({ itinerary: [day({})] })
    const draft = makeProjected({ itinerary: [day({ festiveLabel: 'Lantern Festival' })] })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].after).toContain('｜节日标记：')
  })

  it('reports a logo added as a single high-risk row', () => {
    const published = makeProjected({ itinerary: [day({}), day({ day: 2 })] })
    const draft = makeProjected({
      itinerary: [day({}), day({ day: 2, operatorLogo: { src: '/images/a.png', alt: 'Sample Air' } })],
    })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('行程 第 2 天 航司标志')
    expect(rows[0].risk).toBe('high')
    expect(rows[0].before).toBeNull()
    expect(rows[0].after).toBe('/images/a.png（Sample Air）')
  })

  it('reports a logo src change and an alt change as high-risk rows', () => {
    const published = makeProjected({
      itinerary: [day({ operatorLogo: { src: '/images/a.png', alt: 'Sample Air' } })],
    })
    const srcDraft = makeProjected({
      itinerary: [day({ operatorLogo: { src: '/images/b.png', alt: 'Sample Air' } })],
    })
    const srcRows = itineraryChanges(published, srcDraft, TOUR_ID, TOUR_NAME)
    expect(srcRows).toHaveLength(1)
    expect(srcRows[0].risk).toBe('high')

    const altDraft = makeProjected({
      itinerary: [day({ operatorLogo: { src: '/images/a.png', alt: 'Other Air' } })],
    })
    const altRows = itineraryChanges(published, altDraft, TOUR_ID, TOUR_NAME)
    expect(altRows).toHaveLength(1)
    expect(altRows[0].risk).toBe('high')
  })

  it('reports a logo removed with a null after', () => {
    const published = makeProjected({
      itinerary: [day({ operatorLogo: { src: '/images/a.png', alt: 'Sample Air' } })],
    })
    const draft = makeProjected({ itinerary: [day({})] })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].risk).toBe('high')
    expect(rows[0].after).toBeNull()
  })

  it('reports a body and logo change on the same day as two rows, body first', () => {
    const published = makeProjected({
      itinerary: [day({ title: 'T', operatorLogo: { src: '/images/a.png', alt: 'Sample Air' } })],
    })
    const draft = makeProjected({
      itinerary: [day({ title: 'T2', operatorLogo: { src: '/images/b.png', alt: 'Sample Air' } })],
    })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(2)
    expect(rows[0].fieldLabel).toBe('行程 第 1 天')
    expect(rows[1].fieldLabel).toBe('行程 第 1 天 航司标志')
  })

  it('reports a day present on one side only as a body row plus a logo row', () => {
    const published = makeProjected({ itinerary: [] })
    const draft = makeProjected({
      itinerary: [day({ operatorLogo: { src: '/images/a.png', alt: 'Sample Air' } })],
    })
    const rows = itineraryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(2)
    expect(rows[0].fieldLabel).toBe('行程 第 1 天')
    expect(rows[0].before).toBeNull()
    expect(rows[1].fieldLabel).toBe('行程 第 1 天 航司标志')
    expect(rows[1].risk).toBe('high')
  })
})

describe('galleryChanges', () => {
  it('returns nothing when the galleries are identical', () => {
    const tour = makeProjected({ gallery: ['/images/a.jpg'] })
    expect(galleryChanges(tour, tour, TOUR_ID, TOUR_NAME)).toEqual([])
  })

  it('reports one added image', () => {
    const published = makeProjected({ gallery: ['/images/a.jpg', '/images/b.jpg'] })
    const draft = makeProjected({ gallery: ['/images/a.jpg', '/images/b.jpg', '/images/c.jpg'] })
    const rows = galleryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('图集：新增')
    expect(rows[0].before).toBe('共 2 张')
    expect(rows[0].after).toBe('共 3 张：c.jpg')
  })

  it('reports one removed image', () => {
    const published = makeProjected({ gallery: ['/images/a.jpg', '/images/b.jpg'] })
    const draft = makeProjected({ gallery: ['/images/a.jpg'] })
    const rows = galleryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('图集：移除')
    expect(rows[0].before).toBe('共 2 张：b.jpg')
    expect(rows[0].after).toBe('共 1 张')
  })

  it('reports added and removed together in that order', () => {
    const published = makeProjected({ gallery: ['/images/a.jpg', '/images/b.jpg'] })
    const draft = makeProjected({ gallery: ['/images/a.jpg', '/images/c.jpg'] })
    const rows = galleryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(2)
    expect(rows[0].fieldLabel).toBe('图集：新增')
    expect(rows[1].fieldLabel).toBe('图集：移除')
  })

  it('reports a pure reorder as one row listing tails', () => {
    const published = makeProjected({ gallery: ['/images/a.jpg', '/images/b.jpg'] })
    const draft = makeProjected({ gallery: ['/images/b.jpg', '/images/a.jpg'] })
    const rows = galleryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('图集：顺序变化')
    expect(rows[0].before).toBe('a.jpg、b.jpg')
    expect(rows[0].after).toBe('b.jpg、a.jpg')
  })

  it('strips query strings when computing the tail', () => {
    const published = makeProjected({ gallery: [] })
    const draft = makeProjected({ gallery: ['https://img.example.com/a/b.webp?w=800'] })
    const rows = galleryChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].after).toBe('共 1 张：b.webp')
  })
})

describe('faqChanges', () => {
  it('returns nothing when the FAQs are identical', () => {
    const tour = makeProjected({ faqs: [faq({})] })
    expect(faqChanges(tour, tour, TOUR_ID, TOUR_NAME)).toEqual([])
  })

  it('reports an answer edit as a normal row labelled with the question', () => {
    const published = makeProjected({ faqs: [faq({ question: 'Q1', answer: 'A1' })] })
    const draft = makeProjected({ faqs: [faq({ question: 'Q1', answer: 'A2' })] })
    const rows = faqChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('常见问题：Q1')
    expect(rows[0].risk).toBe('normal')
    expect(rows[0].before).toBe('答：A1')
    expect(rows[0].after).toBe('答：A2')
  })

  it('cuts a long question to 30 characters in the label', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const published = makeProjected({ faqs: [faq({ question: long, answer: 'A1' })] })
    const draft = makeProjected({ faqs: [faq({ question: long, answer: 'A2' })] })
    const rows = faqChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows[0].fieldLabel).toBe(`常见问题：${long.slice(0, 30)}`)
  })

  it('reports a link added to an existing FAQ as high risk', () => {
    const published = makeProjected({ faqs: [faq({ question: 'Q1', answer: 'A1' })] })
    const draft = makeProjected({
      faqs: [faq({ question: 'Q1', answer: 'A1', link: { href: '/x', label: 'More' } })],
    })
    const rows = faqChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].risk).toBe('high')
  })

  it('reports a link href edit as high risk', () => {
    const published = makeProjected({
      faqs: [faq({ question: 'Q1', answer: 'A1', link: { href: '/x', label: 'More' } })],
    })
    const draft = makeProjected({
      faqs: [faq({ question: 'Q1', answer: 'A1', link: { href: '/y', label: 'More' } })],
    })
    const rows = faqChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].risk).toBe('high')
  })

  it('reports a new FAQ without a link as normal and with a link as high', () => {
    const published = makeProjected({ faqs: [] })
    const plainDraft = makeProjected({ faqs: [faq({ question: 'Q1', answer: 'A1' })] })
    const plainRows = faqChanges(published, plainDraft, TOUR_ID, TOUR_NAME)
    expect(plainRows).toHaveLength(1)
    expect(plainRows[0].risk).toBe('normal')
    expect(plainRows[0].before).toBeNull()

    const linkedDraft = makeProjected({
      faqs: [faq({ question: 'Q1', answer: 'A1', link: { href: '/x', label: 'More' } })],
    })
    const linkedRows = faqChanges(published, linkedDraft, TOUR_ID, TOUR_NAME)
    expect(linkedRows).toHaveLength(1)
    expect(linkedRows[0].risk).toBe('high')
  })

  it('reports a removed FAQ with a link as high risk', () => {
    const published = makeProjected({
      faqs: [faq({ question: 'Q1', answer: 'A1', link: { href: '/x', label: 'More' } })],
    })
    const draft = makeProjected({ faqs: [] })
    const rows = faqChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].risk).toBe('high')
    expect(rows[0].after).toBeNull()
  })

  it('reports a pure reorder as one order row', () => {
    const published = makeProjected({ faqs: [faq({ question: 'Q1' }), faq({ question: 'Q2' })] })
    const draft = makeProjected({ faqs: [faq({ question: 'Q2' }), faq({ question: 'Q1' })] })
    const rows = faqChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('常见问题：顺序变化')
    expect(rows[0].risk).toBe('normal')
  })
})

describe('siteExtrasChanges', () => {
  it('returns nothing when the extras are equal with a different key order', () => {
    const published = makeProjected({ siteExtras: { a: 1, b: 2 } })
    const draft = makeProjected({ siteExtras: { b: 2, a: 1 } })
    expect(siteExtrasChanges(published, draft, TOUR_ID, TOUR_NAME)).toEqual([])
  })

  it('reports one row when the extras differ', () => {
    const published = makeProjected({ siteExtras: { a: 1 } })
    const draft = makeProjected({ siteExtras: { a: 2 } })
    const rows = siteExtrasChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows).toHaveLength(1)
    expect(rows[0].fieldLabel).toBe('站点附加信息')
    expect(rows[0].risk).toBe('normal')
  })
})

describe('contentChanges', () => {
  it('concatenates gallery, faq and site extras rows in that order', () => {
    const published = makeProjected({
      gallery: ['/images/a.jpg'],
      faqs: [faq({ question: 'Q1', answer: 'A1' })],
      siteExtras: { a: 1 },
    })
    const draft = makeProjected({
      gallery: ['/images/a.jpg', '/images/b.jpg'],
      faqs: [faq({ question: 'Q1', answer: 'A2' })],
      siteExtras: { a: 2 },
    })
    const rows = contentChanges(published, draft, TOUR_ID, TOUR_NAME)
    expect(rows.map((row) => row.fieldLabel)).toEqual([
      '图集：新增',
      '常见问题：Q1',
      '站点附加信息',
    ])
  })
})

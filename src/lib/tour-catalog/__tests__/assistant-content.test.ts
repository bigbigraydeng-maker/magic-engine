import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_CONTENT_KEYS,
  buildCatalogIndex,
  checkProposal,
  tourDetail,
} from '../assistant'
import { mergeItineraryExtras } from '../assistant-itinerary'
import type { CatalogSnapshot } from '../store'
import type { CatalogItineraryDay } from '../types'
import { blankTour } from './content-fixture'

function makeSnapshot(): CatalogSnapshot {
  const tour = blankTour({
    id: 'tour-1',
    itinerary: [
      {
        day: 1,
        title: 'Arrive',
        description: 'A',
        accommodation: 'Hotel One',
        festiveLabel: 'Lantern Festival',
        operatorLogo: { src: '/images/air.png', alt: 'Sample Air' },
      },
      { day: 2, title: 'Wall', description: 'B', accommodation: 'Hotel Two' },
      { day: 3, title: 'Fly home', description: 'C' },
    ],
    gallery: ['/images/a.jpg'],
    heroImage: '/images/a.jpg',
    siteExtras: { related_blog_slugs: ['x'] },
  })
  return { tours: [tour], departures: [], aliases: [] }
}

function threeDays(): CatalogItineraryDay[] {
  return [
    { day: 1, title: 'Arrive', description: 'A' },
    { day: 2, title: 'Wall changed', description: 'B' },
    { day: 3, title: 'Fly home', description: 'C' },
  ]
}

describe('mergeItineraryExtras', () => {
  const snapshot = makeSnapshot()
  const current = snapshot.tours[0].itinerary

  it('restores stored extras by day number', () => {
    const merged = mergeItineraryExtras(current, threeDays()).itinerary as CatalogItineraryDay[]
    expect(merged[0].accommodation).toBe('Hotel One')
    expect(merged[0].festiveLabel).toBe('Lantern Festival')
    expect(merged[0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
    expect(merged[1].accommodation).toBe('Hotel Two')
  })

  it('lets a proposed accommodation and festiveLabel win', () => {
    const proposed = [
      { day: 1, title: 'Arrive', description: 'A', accommodation: 'New Hotel', festiveLabel: 'New Festival' },
    ]
    const merged = mergeItineraryExtras(current, proposed).itinerary as CatalogItineraryDay[]
    expect(merged[0].accommodation).toBe('New Hotel')
    expect(merged[0].festiveLabel).toBe('New Festival')
  })

  it('always replaces a proposed operatorLogo with the stored one', () => {
    const proposed = [
      { day: 1, title: 'Arrive', description: 'A', operatorLogo: { src: '/images/other.png', alt: 'Other' } },
    ]
    const merged = mergeItineraryExtras(current, proposed).itinerary as CatalogItineraryDay[]
    expect(merged[0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
  })

  it('removes a proposed operatorLogo when the stored day has none', () => {
    const proposed = [
      { day: 3, title: 'Fly home', description: 'C', operatorLogo: { src: '/images/other.png', alt: 'Other' } },
    ]
    const merged = mergeItineraryExtras(current, proposed).itinerary as CatalogItineraryDay[]
    expect('operatorLogo' in merged[0]).toBe(false)
  })

  it('adds nothing for a day number that does not exist', () => {
    const proposed = [{ day: 9, title: 'Extra', description: 'D' }]
    const merged = mergeItineraryExtras(current, proposed).itinerary as CatalogItineraryDay[]
    expect('accommodation' in merged[0]).toBe(false)
    expect('festiveLabel' in merged[0]).toBe(false)
    expect('operatorLogo' in merged[0]).toBe(false)
  })

  it('returns non-array input unchanged and leaves non-object items alone', () => {
    expect(mergeItineraryExtras(current, 'nope')).toEqual({ itinerary: 'nope', unmatchedDays: [] })
    const merged = mergeItineraryExtras(current, ['raw', 5]).itinerary as unknown[]
    expect(merged).toEqual(['raw', 5])
  })
})

describe('checkProposal content handling', () => {
  const snapshot = makeSnapshot()

  it('merges stored extras into a proposed itinerary', () => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { itinerary: threeDays() },
    })
    expect(result).not.toBeNull()
    expect(result!.check.ok).toBe(true)
    const itinerary = result!.proposal.kind === 'update_tour' ? result!.proposal.patch.itinerary : undefined
    expect(itinerary).toBeDefined()
    expect(itinerary![0].accommodation).toBe('Hotel One')
    expect(itinerary![0].festiveLabel).toBe('Lantern Festival')
    expect(itinerary![0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
    expect(itinerary![1].accommodation).toBe('Hotel Two')
  })

  it('accepts a changed accommodation', () => {
    const days = threeDays()
    days[1] = { ...days[1], accommodation: 'New Hotel' }
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { itinerary: days },
    })
    expect(result).not.toBeNull()
    expect(result!.check.ok).toBe(true)
    const itinerary = result!.proposal.kind === 'update_tour' ? result!.proposal.patch.itinerary : undefined
    expect(itinerary![1].accommodation).toBe('New Hotel')
  })

  it('keeps the stored logo even when the model sends a different one', () => {
    const days = threeDays()
    days[0] = { ...days[0], operatorLogo: { src: '/images/other.png', alt: 'Other' } }
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { itinerary: days },
    })
    expect(result).not.toBeNull()
    expect(result!.check.ok).toBe(true)
    const itinerary = result!.proposal.kind === 'update_tour' ? result!.proposal.patch.itinerary : undefined
    expect(itinerary![0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
  })

  // Extras follow the day's TITLE now (assistant-itinerary.ts). Dropping the day that carries the
  // logo therefore drops the logo — which the assistant may not do — instead of quietly moving the
  // logo onto whatever day took over that day number.
  it('refuses a proposal that drops the day carrying the logo', () => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: {
        itinerary: [
          { day: 1, title: 'Wall', description: 'B' },
          { day: 2, title: 'Fly home', description: 'C' },
        ],
      },
    })
    expect(result?.check).toEqual({ ok: false, errors: [{ field: '*', code: 'forbidden' }] })
  })

  it('keeps the logo and the hotels in place when a later day is dropped', () => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: {
        itinerary: [
          { day: 1, title: 'Arrive', description: 'A' },
          { day: 2, title: 'Fly home', description: 'C' },
        ],
      },
    })
    expect(result).not.toBeNull()
    if (result === null || result.proposal.kind !== 'update_tour') throw new Error('unexpected proposal')
    expect(result.check).toEqual({ ok: true, warnings: [{ code: 'itinerary_shrinks', from: 3, to: 2 }] })
    expect(result.proposal.patch.itinerary?.[0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
    expect(result.proposal.patch.itinerary?.[0].accommodation).toBe('Hotel One')
    expect(result.proposal.patch.itinerary?.[1].accommodation).toBeUndefined()
  })

  it('refuses an itinerary that no longer has the day number carrying the logo', () => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { itinerary: [] },
    })
    expect(result?.check).toEqual({ ok: false, errors: [{ field: '*', code: 'forbidden' }] })
  })

  it.each([
    ['heroImage', '/images/hero.jpg'],
    ['gallery', ['/images/a.jpg']],
    ['metaTitle', 'Meta title'],
    ['metaDescription', 'Meta description'],
    ['tags', ['culture']],
    ['faqs', [{ question: 'Q1', answer: 'A1', link: null }]],
    ['rating', 4.8],
    ['reviewCount', 12],
    ['reviewSummary', 'Lovely trip'],
    ['quickAnswer', 'A quick answer'],
  ])('rejects the blocked content key %s', (key, value) => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { [key]: value },
    })
    expect(result).not.toBeNull()
    expect(result!.check.ok).toBe(false)
    if (!result!.check.ok) {
      expect(result!.check.errors).toContainEqual({ field: key, code: 'assistant_field_not_allowed' })
    }
  })

  it('accepts singleSupplementNote and soldOut', () => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { singleSupplementNote: 'Limited rooms', soldOut: true },
    })
    expect(result).not.toBeNull()
    expect(result!.check.ok).toBe(true)
    const patch = result!.proposal.kind === 'update_tour' ? result!.proposal.patch : {}
    expect(patch.singleSupplementNote).toBe('Limited rooms')
    expect(patch.soldOut).toBe(true)
  })

  it('accepts the snake_case aliases', () => {
    const result = checkProposal(snapshot, {
      kind: 'update_tour',
      tourId: 'tour-1',
      summary: 's',
      patch: { single_supplement_note: 'Limited rooms', sold_out: true },
    })
    expect(result).not.toBeNull()
    expect(result!.check.ok).toBe(true)
    const patch = result!.proposal.kind === 'update_tour' ? result!.proposal.patch : {}
    expect(patch.singleSupplementNote).toBe('Limited rooms')
    expect(patch.soldOut).toBe(true)
  })
})

describe('assistant content surface', () => {
  it('exposes exactly the two allowed content keys', () => {
    expect(ASSISTANT_CONTENT_KEYS).toEqual(['singleSupplementNote', 'soldOut'])
  })

  it('tourDetail strips gallery, siteExtras and clientId', () => {
    const snapshot = makeSnapshot()
    const detail = tourDetail(snapshot, 'tour-1')
    expect(detail).not.toBeNull()
    const parsed = JSON.parse(detail!) as Record<string, unknown>
    expect('gallery' in parsed).toBe(false)
    expect('siteExtras' in parsed).toBe(false)
    expect('clientId' in parsed).toBe(false)
    expect(Array.isArray(parsed.itinerary)).toBe(true)
    const itinerary = parsed.itinerary as CatalogItineraryDay[]
    expect(itinerary[0].accommodation).toBe('Hotel One')
    expect(parsed.heroImage).toBe('/images/a.jpg')
  })

  it('buildCatalogIndex omits content details', () => {
    const snapshot = makeSnapshot()
    const index = buildCatalogIndex(snapshot)
    expect(index).not.toContain('Hotel One')
    expect(index).not.toContain('/images/a.jpg')
    expect(index).not.toContain('related_blog_slugs')
  })
})

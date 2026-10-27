import { describe, it, expect } from 'vitest'
import { checkTourCompleteness, missingItems, type CompletenessTour } from '../completeness'

const day = (n: number, extra: Record<string, string> = {}) => ({ day: n, description: `day ${n}`, ...extra })

const complete: CompletenessTour = {
  managesDepartures: true,
  durationText: '3 Days',
  displayPriceText: 'From NZD $4,999 per person',
  singleSupplement: 'NZD $950',
  highlights: ['a', 'b', 'c'],
  itinerary: [day(1), day(2, { accommodation: 'Hotel A' }), day(3)],
  inclusions: ['x'],
  exclusions: ['y'],
  tourCities: ['guilin'],
  heroImage: '/images/a.jpg',
  gallery: ['1', '2', '3'],
  metaTitle: 'China Unveiled 14-Day Tour from Auckland',
  metaDescription: 'A 3-day tour.',
  faqs: [{}, {}, {}],
  quickAnswer: 'Three days.',
}

const keys = (t: CompletenessTour, deps = 1) => missingItems(checkTourCompleteness(t, deps)).map(i => i.key)

describe('checkTourCompleteness', () => {
  it('has nothing missing on a fully filled tour', () => {
    expect(keys(complete)).toEqual([])
  })

  it('flags a freshly created tour (nothing but name and departures)', () => {
    const fresh: CompletenessTour = { managesDepartures: true }
    expect(keys(fresh, 4)).toEqual(
      expect.arrayContaining(['price', 'singleSupplement', 'highlights', 'inclusions', 'exclusions', 'cities', 'itinerary', 'stay', 'hero', 'gallery', 'metaTitle', 'metaDescription', 'faqs', 'quickAnswer']),
    )
    expect(keys(fresh, 4)).not.toContain('departures')
  })

  it('needs a departure only for tours that manage departures', () => {
    expect(keys({ ...complete, managesDepartures: true }, 0)).toContain('departures')
    expect(keys({ ...complete, managesDepartures: false }, 0)).not.toContain('departures')
  })

  it('treats a TBC price as missing', () => {
    expect(keys({ ...complete, displayPriceText: 'From NZD $TBC per person' })).toEqual(['price'])
  })

  it('names the itinerary days that have no hotel (first and last day are exempt)', () => {
    const items = checkTourCompleteness({ ...complete, itinerary: [day(1), day(2), day(3), day(4)] }, 1)
    const stay = items.find(i => i.key === 'stay')
    expect(stay?.ok).toBe(false)
    expect(stay?.detail).toBe('第 2、3 天没填酒店')
  })

  it('catches a duration that does not match the number of itinerary days', () => {
    const items = checkTourCompleteness({ ...complete, durationText: '14 Days' }, 1)
    expect(items.find(i => i.key === 'duration')?.detail).toBe('「天数」写 14 天，行程有 3 天')
  })

  it('rejects a web title over 60 characters and a description over 160', () => {
    expect(keys({ ...complete, metaTitle: 'x'.repeat(61) })).toEqual(['metaTitle'])
    expect(keys({ ...complete, metaDescription: 'x'.repeat(161) })).toEqual(['metaDescription'])
    expect(keys({ ...complete, metaTitle: 'x'.repeat(60), metaDescription: 'x'.repeat(160) })).toEqual([])
  })

  it('wants at least 3 FAQs, 3 gallery images and 3 highlights', () => {
    expect(keys({ ...complete, faqs: [{}, {}] })).toEqual(['faqs'])
    expect(keys({ ...complete, gallery: ['1', '2'] })).toEqual(['gallery'])
    expect(keys({ ...complete, highlights: ['a', 'b'] })).toEqual(['highlights'])
  })
})

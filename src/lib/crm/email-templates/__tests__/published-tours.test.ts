import { describe, expect, it } from 'vitest'
import {
  buildTourUrl,
  listPickOptions,
  publishedToursProvider,
  resolvePicks,
} from '@/lib/crm/email-templates/facts/published-tours'
import type { RenderFacts, ResolvedPick } from '@/lib/crm/email-templates/facts/types'
import type { PickFilter, PublishedToursProviderSettings } from '@/lib/crm/email-templates/types'
import type {
  PublishedTourFact,
  PublishedTourFactDeparture,
} from '@/lib/tour-catalog/publish-contract'

const settings: PublishedToursProviderSettings = {
  urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
  allToursUrl: 'https://www.example.com/tours',
}

function tour(overrides: Partial<PublishedTourFact> = {}): PublishedTourFact {
  return {
    id: 't1',
    slug: 'essentials',
    destination: 'china',
    tier: 'discovery',
    name: 'China Discovery — Best of China',
    title: null,
    durationText: '15 Days',
    displayPriceText: 'From NZD $4,080 per person',
    highlights: [
      'Great Wall',
      'Forbidden City',
      'Terracotta Army',
      'Yangtze cruise',
      'Chengdu pandas',
      'Li River',
      'Shanghai Bund',
      'Pingyao',
    ],
    inclusions: ['Hotels', 'Meals', 'Guide', 'Transport', 'Entrance fees'],
    exclusions: [],
    singleSupplement: null,
    soldOut: false,
    managesDepartures: true,
    isActive: true,
    departures: [
      {
        departOn: '2027-03-11',
        displayDate: '11 March 2027',
        status: 'open',
        priceTextOverride: null,
      },
      {
        departOn: '2027-05-13',
        displayDate: '13 May 2027',
        status: 'limited',
        priceTextOverride: 'NZD $4,380',
      },
    ],
    ...overrides,
  }
}

function facts(picks: ResolvedPick[], overrides: Partial<RenderFacts> = {}): RenderFacts {
  return {
    tours: picks.map((p) => p.tour),
    picks,
    settings,
    ...overrides,
  }
}

function pick(t: PublishedTourFact, departOn: string | null): ResolvedPick {
  const departure = departOn === null ? null : t.departures.find((d) => d.departOn === departOn) ?? null
  return { tour: t, departure }
}

describe('listPickOptions', () => {
  it('excludes sold-out and inactive tours', () => {
    const tours = [
      tour({ id: 'a' }),
      tour({ id: 'b', soldOut: true }),
      tour({ id: 'c', isActive: false }),
    ]
    const opts = listPickOptions(tours, {})
    expect(opts.map((o) => o.tourId)).toEqual(['a'])
  })

  it('month filter keeps only matching departures', () => {
    const opts = listPickOptions([tour()], { departureMonths: [3] })
    expect(opts).toHaveLength(1)
    expect(opts[0].departures.map((d) => d.departOn)).toEqual(['2027-03-11'])
  })

  it('destination and tier filters are case-insensitive', () => {
    const tours = [tour({ id: 'a' }), tour({ id: 'b', destination: 'japan', tier: 'signature' })]
    expect(listPickOptions(tours, { destinations: ['CHINA'] }).map((o) => o.tourId)).toEqual(['a'])
    expect(listPickOptions(tours, { tiers: ['Signature'] }).map((o) => o.tourId)).toEqual(['b'])
  })

  it('managing tour with no departure left is excluded', () => {
    const t = tour({ departures: [] })
    expect(listPickOptions([t], {})).toEqual([])
  })

  it('non-managing tour listed with no departures, excluded when months filter set', () => {
    const t = tour({ managesDepartures: false, departures: [] })
    const opts = listPickOptions([t], {})
    expect(opts).toHaveLength(1)
    expect(opts[0].departures).toEqual([])
    expect(opts[0].requiresDeparture).toBe(false)
    expect(listPickOptions([t], { departureMonths: [3] })).toEqual([])
  })
})

describe('resolvePicks', () => {
  const t = tour()

  it('mode none requires empty inputs', () => {
    expect(resolvePicks([t], [], {}, 'none')).toEqual({ ok: true, picks: [] })
    const r = resolvePicks([t], [{ tourId: 't1', departOn: null }], {}, 'none')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pick')
  })

  it('mode one requires exactly one input', () => {
    expect(resolvePicks([t], [], {}, 'one').ok).toBe(false)
    const r = resolvePicks([t], [{ tourId: 't1', departOn: '2027-03-11' }], {}, 'one')
    expect(r.ok).toBe(true)
  })

  it('mode many allows 1..3 and rejects 4', () => {
    const inputs = [
      { tourId: 't1', departOn: '2027-03-11' },
      { tourId: 't1', departOn: '2027-05-13' },
    ]
    expect(resolvePicks([t], inputs, {}, 'many').ok).toBe(true)
    const four = [
      { tourId: 't1', departOn: '2027-03-11' },
      { tourId: 't1', departOn: '2027-05-13' },
      { tourId: 't1', departOn: '2027-03-11' },
      { tourId: 't1', departOn: '2027-05-13' },
    ]
    expect(resolvePicks([t], four, {}, 'many').ok).toBe(false)
  })

  it('duplicate pairs are invalid', () => {
    const inputs = [
      { tourId: 't1', departOn: '2027-03-11' },
      { tourId: 't1', departOn: '2027-03-11' },
    ]
    const r = resolvePicks([t], inputs, {}, 'many')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pick')
  })

  it('unknown tour is invalid_pick', () => {
    const r = resolvePicks([t], [{ tourId: 'nope', departOn: null }], {}, 'one')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pick')
  })

  it('sold-out tour is tour_unavailable', () => {
    const sold = tour({ soldOut: true })
    const r = resolvePicks([sold], [{ tourId: 't1', departOn: '2027-03-11' }], {}, 'one')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('tour_unavailable')
  })

  it('departure not on sale is tour_unavailable', () => {
    const r = resolvePicks([t], [{ tourId: 't1', departOn: '2027-01-01' }], {}, 'one')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('tour_unavailable')
  })

  it('non-managing tour with departOn is invalid_pick', () => {
    const nm = tour({ managesDepartures: false, departures: [] })
    const r = resolvePicks([nm], [{ tourId: 't1', departOn: '2027-03-11' }], {}, 'one')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pick')
  })

  it('filter violation is invalid_pick', () => {
    const r = resolvePicks([t], [{ tourId: 't1', departOn: '2027-03-11' }], { destinations: ['japan'] }, 'one')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_pick')
  })
})

describe('buildTourUrl', () => {
  it('encodes path segments', () => {
    const t = tour({ destination: 'new zealand', slug: 'a/b' })
    expect(buildTourUrl(settings, t, null)).toBe(
      'https://www.example.com/tours/new%20zealand/discovery/a%2Fb',
    )
  })

  it('appends ?date= when no query present', () => {
    const t = tour()
    const dep = t.departures[0]
    expect(buildTourUrl(settings, t, dep)).toBe(
      'https://www.example.com/tours/china/discovery/essentials?date=2027-03-11',
    )
  })

  it('uses & when the pattern already has a query', () => {
    const s: PublishedToursProviderSettings = {
      urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}?ref=email',
      allToursUrl: 'https://www.example.com/tours',
    }
    const t = tour()
    expect(buildTourUrl(s, t, t.departures[0])).toBe(
      'https://www.example.com/tours/china/discovery/essentials?ref=email&date=2027-03-11',
    )
  })
})

describe('resolve', () => {
  const t = tour()
  const p11 = pick(t, '2027-03-11')
  const p13 = pick(t, '2027-05-13')

  it('tour_name', () => {
    expect(publishedToursProvider.resolve('tour_name', null, facts([p11]))).toEqual({
      ok: true,
      value: 'China Discovery — Best of China',
    })
  })

  it('tour_duration', () => {
    expect(publishedToursProvider.resolve('tour_duration', null, facts([p11]))).toEqual({
      ok: true,
      value: '15 Days',
    })
  })

  it('departure_date', () => {
    expect(publishedToursProvider.resolve('departure_date', null, facts([p11]))).toEqual({
      ok: true,
      value: '11 March 2027',
    })
  })

  it('tour_price without override', () => {
    expect(publishedToursProvider.resolve('tour_price', null, facts([p11]))).toEqual({
      ok: true,
      value: 'From NZD $4,080 per person',
    })
  })

  it('tour_price with differing override adds suffix', () => {
    expect(publishedToursProvider.resolve('tour_price', null, facts([p13]))).toEqual({
      ok: true,
      value: 'From NZD $4,080 per person (this departure: NZD $4,380)',
    })
  })

  it('tour_url', () => {
    expect(publishedToursProvider.resolve('tour_url', null, facts([p11]))).toEqual({
      ok: true,
      value: 'https://www.example.com/tours/china/discovery/essentials?date=2027-03-11',
    })
  })

  it('all_tours_url', () => {
    expect(publishedToursProvider.resolve('all_tours_url', null, facts([p11]))).toEqual({
      ok: true,
      value: 'https://www.example.com/tours',
    })
  })

  it('tour_highlights without count', () => {
    const r = publishedToursProvider.resolve('tour_highlights', null, facts([p11]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const lines = r.value.split('\n')
      expect(lines).toHaveLength(8)
      expect(lines[0]).toBe('• Great Wall')
    }
  })

  it('tour_highlights with count', () => {
    const r = publishedToursProvider.resolve('tour_highlights', 3, facts([p11]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.split('\n')).toHaveLength(3)
  })

  it('tour_inclusions', () => {
    const r = publishedToursProvider.resolve('tour_inclusions', null, facts([p11]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.split('\n')).toHaveLength(5)
  })

  it('missing when no picks', () => {
    expect(publishedToursProvider.resolve('tour_name', null, facts([]))).toEqual({
      ok: false,
      missing: 'tour',
    })
  })

  it('missing when no settings for tour_url', () => {
    expect(
      publishedToursProvider.resolve('tour_url', null, facts([p11], { settings: null })),
    ).toEqual({ ok: false, missing: 'tour_url' })
  })

  it('missing when price blank', () => {
    const blank = tour({ displayPriceText: null })
    const p = pick(blank, '2027-03-11')
    expect(publishedToursProvider.resolve('tour_price', null, facts([p]))).toEqual({
      ok: false,
      missing: 'tour_price',
    })
  })

  it('unknown variable', () => {
    expect(publishedToursProvider.resolve('nope', null, facts([p11]))).toEqual({
      ok: false,
      missing: 'nope',
    })
  })

  it('tour_cards exact 4-line format', () => {
    const r = publishedToursProvider.resolve('tour_cards', null, facts([p11]))
    expect(r).toEqual({
      ok: true,
      value: [
        'China Discovery — Best of China (15 Days)',
        'Departing 11 March 2027',
        'From NZD $4,080 per person',
        'https://www.example.com/tours/china/discovery/essentials?date=2027-03-11',
      ].join('\n'),
    })
  })

  it('tour_cards two picks separated by blank line', () => {
    const r = publishedToursProvider.resolve('tour_cards', null, facts([p11, p13]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const cards = r.value.split('\n\n')
      expect(cards).toHaveLength(2)
      expect(cards[1]).toContain('(this departure: NZD $4,380)')
    }
  })

  it('tour_cards omits departure line when no departure', () => {
    const nm = tour({ managesDepartures: false, departures: [] })
    const p = pick(nm, null)
    const r = publishedToursProvider.resolve('tour_cards', null, facts([p]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const lines = r.value.split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe('China Discovery — Best of China (15 Days)')
      expect(lines[1]).toBe('From NZD $4,080 per person')
    }
  })

  it('price with $1 $& $\' comes through untouched', () => {
    const weird = tour({ displayPriceText: 'Only $1 $& $\' per person' })
    const p = pick(weird, '2027-03-11')
    const r = publishedToursProvider.resolve('tour_price', null, facts([p]))
    expect(r).toEqual({ ok: true, value: 'Only $1 $& $\' per person' })
  })
})

describe('checkLinks', () => {
  const t = tour()
  const f = facts([pick(t, '2027-03-11')])

  it('a host that is neither the pattern host nor an allowed link host is not the provider\'s business (the shared host rule blocks it)', () => {
    expect(
      publishedToursProvider.checkLinks(['https://other.example.com/tours/china/discovery/gone'], f),
    ).toEqual([])
  })

  it('but a host the client allows links to IS held to the tour page rules, whichever way it is spelled', () => {
    const withHosts = { ...f, linkHosts: ['other.example.com'] }
    expect(
      publishedToursProvider.checkLinks(['https://other.example.com/tours/china/discovery/gone'], withHosts).map((v) => v.code),
    ).toEqual(['tour_page_not_on_sale'])
    expect(
      publishedToursProvider.checkLinks(['https://OTHER.example.com./tours/china/discovery/essentials'], withHosts),
    ).toEqual([])
  })

  it('generic page is ok', () => {
    expect(publishedToursProvider.checkLinks(['https://www.example.com/about'], f)).toEqual([])
  })

  it('on-sale tour page is ok', () => {
    expect(
      publishedToursProvider.checkLinks(['https://www.example.com/tours/china/discovery/essentials'], f),
    ).toEqual([])
  })

  it('sold-out tour page is a violation', () => {
    const sold = tour({ soldOut: true })
    const fs = facts([pick(t, '2027-03-11')], { tours: [sold] })
    const v = publishedToursProvider.checkLinks(
      ['https://www.example.com/tours/china/discovery/essentials'],
      fs,
    )
    expect(v).toHaveLength(1)
    expect(v[0].code).toBe('tour_page_not_on_sale')
  })

  it('unknown slug is a violation', () => {
    const v = publishedToursProvider.checkLinks(
      ['https://www.example.com/tours/china/discovery/unknown'],
      f,
    )
    expect(v).toHaveLength(1)
    expect(v[0].code).toBe('tour_page_not_on_sale')
  })

  it('date matching a departure is ok', () => {
    expect(
      publishedToursProvider.checkLinks(
        ['https://www.example.com/tours/china/discovery/essentials?date=2027-03-11'],
        f,
      ),
    ).toEqual([])
  })

  it('date not a departure is a violation', () => {
    const v = publishedToursProvider.checkLinks(
      ['https://www.example.com/tours/china/discovery/essentials?date=2027-01-01'],
      f,
    )
    expect(v).toHaveLength(1)
    expect(v[0].code).toBe('departure_not_on_sale')
  })

  it('settings null returns []', () => {
    expect(
      publishedToursProvider.checkLinks(
        ['https://www.example.com/tours/china/discovery/essentials'],
        facts([pick(t, '2027-03-11')], { settings: null }),
      ),
    ).toEqual([])
  })
})

describe('knownAmounts', () => {
  it('unions displayPriceText, override and singleSupplement', () => {
    const t = tour({ singleSupplement: 'NZD $1,200' })
    const p = pick(t, '2027-05-13')
    const amounts = publishedToursProvider.knownAmounts(facts([p]))
    expect(amounts).toContain('4080')
    expect(amounts).toContain('4380')
    expect(amounts).toContain('1200')
    expect(amounts).toEqual([...amounts].sort())
  })
})

describe('sellable', () => {
  it('ok for sellable pick with departure', () => {
    const t = tour()
    expect(publishedToursProvider.sellable([pick(t, '2027-03-11')])).toEqual({ ok: true })
  })

  it('fails for sold-out tour', () => {
    const t = tour({ soldOut: true })
    const r = publishedToursProvider.sellable([pick(t, '2027-03-11')])
    expect(r.ok).toBe(false)
  })

  it('fails for managing tour without departure', () => {
    const t = tour()
    const r = publishedToursProvider.sellable([{ tour: t, departure: null }])
    expect(r.ok).toBe(false)
  })
})

// Keep the type import used even if the test file evolves.
const _typeCheck: PublishedTourFactDeparture | null = null
void _typeCheck
const _filterCheck: PickFilter = {}
void _filterCheck

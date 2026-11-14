import { describe, expect, it } from 'vitest'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import {
  POSTER_RECIPES,
  buildTourPosterLines,
  buildTourPosterPrompt,
  isHexColor,
  nextDeparture,
  posterTextMatches,
  readPosterBrand,
  resolvePosterRecipe,
  websiteDomain,
} from '../poster-recipe'

const tour = (over: Partial<PublishedTourFact> = {}): PublishedTourFact => ({
  id: 't1',
  slug: 'china-panorama',
  destination: 'china',
  tier: 'signature',
  name: 'China Panorama',
  title: null,
  durationText: '14 Days',
  displayPriceText: 'From $6,999 pp twin share',
  highlights: [],
  inclusions: [],
  exclusions: [],
  singleSupplement: null,
  soldOut: false,
  managesDepartures: true,
  isActive: true,
  departures: [
    { departOn: '2027-05-01', displayDate: '1 May 2027', status: 'open', priceTextOverride: null },
    { departOn: '2027-03-15', displayDate: '15 March 2027', status: 'limited', priceTextOverride: null },
  ],
  ...over,
})

describe('recipe registry', () => {
  it('tour_poster_v1 is frozen and resolvable', () => {
    const r = resolvePosterRecipe('tour_poster_v1')
    expect(r).toEqual({ id: 'tour_poster_v1', version: 1, model: 'minimax-h3-image-edit', resolution: '2K' })
    expect(Object.isFrozen(POSTER_RECIPES)).toBe(true)
    expect(Object.isFrozen(POSTER_RECIPES.tour_poster_v1)).toBe(true)
  })

  it('unknown ids (incl. prototype keys) resolve to null', () => {
    for (const id of ['tour_poster_v2', 'toString', '__proto__', '', null, 1]) {
      expect(resolvePosterRecipe(id)).toBeNull()
    }
  })
})

describe('brand + website', () => {
  it('isHexColor accepts only #rrggbb', () => {
    expect(isHexColor('#C8102E')).toBe(true)
    for (const c of ['#fff', 'red', 'rgb(1,2,3)', '#12345g', '', null]) expect(isHexColor(c)).toBe(false)
  })

  it('readPosterBrand requires a valid primary; drops invalid extras', () => {
    expect(readPosterBrand({ primary: '#C8102E', secondary: '#D4AF37', accent: 'gold' })).toEqual({
      primary: '#C8102E',
      secondary: '#D4AF37',
      accent: null,
    })
    expect(readPosterBrand({ primary: 'red', secondary: '#D4AF37' })).toBeNull()
    expect(readPosterBrand(null)).toBeNull()
    expect(readPosterBrand({})).toBeNull()
  })

  it('websiteDomain returns the bare domain or null', () => {
    expect(websiteDomain('https://www.example.co.nz/tours')).toBe('example.co.nz')
    expect(websiteDomain('example.com')).toBe('example.com')
    for (const w of ['', '   ', null, 42, 'localhost', 'http://']) expect(websiteDomain(w)).toBeNull()
  })
})

describe('buildTourPosterLines — facts only', () => {
  it('earliest departure on/after the post date, display price, domain', () => {
    const { lines, hasPrice } = buildTourPosterLines(tour(), '2027-01-01', 'https://www.example.co.nz')
    expect(lines).toEqual([
      'China Panorama',
      '14 Days',
      'From $6,999 pp twin share',
      'Next departure 15 March 2027',
      'example.co.nz',
    ])
    expect(hasPrice).toBe(true)
  })

  it('departures before the post date are skipped', () => {
    expect(nextDeparture(tour(), '2027-04-01')?.departOn).toBe('2027-05-01')
    expect(nextDeparture(tour(), '2027-05-01')?.departOn).toBe('2027-05-01')
    expect(nextDeparture(tour(), '2027-06-01')).toBeNull()
  })

  it('a departure price override wins over the display price', () => {
    const t = tour({
      departures: [{ departOn: '2027-03-15', displayDate: '15 March 2027', status: 'open', priceTextOverride: 'From $5,999' }],
    })
    expect(buildTourPosterLines(t, '2027-01-01', null).lines).toContain('From $5,999')
  })

  it('missing facts drop their line; nothing is invented', () => {
    const t = tour({ durationText: null, displayPriceText: '  ', departures: [] })
    const { lines, hasPrice } = buildTourPosterLines(t, '2027-01-01', null)
    expect(lines).toEqual(['China Panorama'])
    expect(hasPrice).toBe(false)
  })
})

describe('buildTourPosterLines — price can be dropped (photo cannot back a real price)', () => {
  it('includePrice:false drops the price line, has_price false, poster still has the rest', () => {
    const r = buildTourPosterLines(tour(), '2027-01-01', 'example.com', { includePrice: false })
    expect(r.lines).toEqual(['China Panorama', '14 Days', 'Next departure 15 March 2027', 'example.com'])
    expect(r.hasPrice).toBe(false)
    expect(r.entries.map((e) => e.label)).toEqual(['Headline', 'Duration', 'Next departure', 'Website'])
  })

  it('records the ISO date of the departure it prints', () => {
    expect(buildTourPosterLines(tour(), '2027-01-01', null).nextDepartOn).toBe('2027-03-15')
    expect(buildTourPosterLines(tour({ departures: [] }), '2027-01-01', null).nextDepartOn).toBeNull()
  })
})

describe('buildTourPosterPrompt — labelled format (worked in the live trial)', () => {
  const brand = { primary: '#C8102E', secondary: '#D4AF37', accent: null }
  const lines = buildTourPosterLines(tour(), '2027-01-01', 'https://www.example.co.nz')

  it('one labelled line per entry + the label rule, brand and guard rails kept', () => {
    const p = buildTourPosterPrompt(lines, brand, 'portrait')
    const rows = p.split('\n')
    expect(rows).toEqual(expect.arrayContaining([
      'Headline: China Panorama',
      'Duration: 14 Days',
      'Price: From $6,999 pp twin share',
      'Next departure: 15 March 2027',
      'Website: example.co.nz',
    ]))
    expect(p).toContain("Write only the text after each label; do not write the labels themselves except 'Next departure'")
    expect(p).toContain('a portrait Facebook travel poster')
    expect(p).not.toMatch(/[「」"“”]/)
    expect(p).toContain('#C8102E as the main accent')
    expect(p).toContain('#D4AF37 sparingly for thin lines only')
    expect(p).toContain('do not change, add or remove any landmark')
    expect(p).toContain('Do not draw quotation marks or brackets')
  })

  it('omits orientation and secondary clause when unknown', () => {
    const p = buildTourPosterPrompt(lines, { primary: '#000000', secondary: null, accent: null })
    expect(p).toContain('Turn image 1 into a Facebook travel poster.')
    expect(p).not.toContain('sparingly')
  })

  it('no vendor or client names in the shared prompt', () => {
    expect(buildTourPosterPrompt(lines, brand).toLowerCase()).not.toMatch(/muapi|minimax|cts/)
  })
})

describe('posterTextMatches — pure judgement of the read-back', () => {
  const expected = ['A Tale of Two Cities', '10 Days', 'From $3,999', 'Next departure 15 March 2027', 'example.co.nz']

  it('exact transcript (any line breaks / case) matches', () => {
    const t = 'A TALE OF TWO\nCITIES\n10 days\nFrom $3,999\nNext departure: 15 March 2027\nexample.co.nz'
    expect(posterTextMatches(expected, t)).toEqual({ match: true })
  })

  it('curly quotes, & vs and, extra spaces are not differences', () => {
    expect(posterTextMatches(['Rock \'n\' Roll & Rice'], 'rock  ’n’ roll and rice')).toEqual({ match: true })
  })

  it('the live-trial misspellings are caught', () => {
    const t = 'A Tale of TwoCinCities\n10 Days\nFrom $3,999\nNext derparture 15 March 2027\nexample.co.nz'
    const r = posterTextMatches(expected, t)
    expect(r.match).toBe(false)
    if (!r.match) expect(r.missing).toEqual(['A Tale of Two Cities', 'Next departure 15 March 2027'])
  })

  it('an invented price or number is a mismatch even when every expected line is there', () => {
    const t = expected.join('\n') + '\nNow only $2,999!'
    const r = posterTextMatches(expected, t)
    expect(r.match).toBe(false)
    if (!r.match) expect(r.unexpected).toEqual(expect.arrayContaining(['$2,999']))
    const noPrice = posterTextMatches(['China Panorama'], 'China Panorama\nFrom $6,999')
    expect(noPrice.match).toBe(false)
  })

  it('a lone currency symbol not in the expected text is a mismatch', () => {
    expect(posterTextMatches(['China Panorama'], 'China Panorama €').match).toBe(false)
  })
})

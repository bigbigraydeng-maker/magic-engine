import { describe, expect, it } from 'vitest'
import { checkFacts } from '../fact-check'
import type { FactCheckInput, FactCheckResult } from '../fact-check'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

function tour(
  over: Partial<PublishedTourFact> & { id: string; slug: string; name: string },
): PublishedTourFact {
  return {
    destination: 'land',
    tier: 'classic',
    title: null,
    durationText: null,
    displayPriceText: null,
    highlights: [],
    inclusions: [],
    exclusions: [],
    singleSupplement: null,
    soldOut: false,
    managesDepartures: true,
    isActive: true,
    departures: [],
    ...over,
  }
}

const LOOP = tour({
  id: 'loop',
  slug: 'mountain-loop',
  name: 'Brand Line — Mountain Loop',
  durationText: '19 Days',
  displayPriceText: 'NZD $7,999',
  inclusions: [
    '5-star hotel accommodation',
    'Morning river cruise on the Silver Lantern',
  ],
  highlights: ['Glacier walk'],
  singleSupplement: 'NZD $1,895',
  departures: [
    {
      departOn: '2027-05-30',
      displayDate: '30 May 2027',
      status: 'open',
      priceTextOverride: null,
    },
    {
      departOn: '2027-06-13',
      displayDate: '13 June 2027',
      status: 'limited',
      priceTextOverride: 'NZD $8,299',
    },
  ],
})

const WALK = tour({
  id: 'walk',
  slug: 'harbour-walk',
  name: 'Brand Line — Harbour Walk',
  durationText: '10 Days',
  displayPriceText: 'From NZD $2,450 per person',
  inclusions: [],
  departures: [
    {
      departOn: '2027-03-25',
      displayDate: '25 March 2027',
      status: 'open',
      priceTextOverride: null,
    },
  ],
})

const SOLD = tour({
  id: 'sold',
  slug: 'sold-trail',
  name: 'Brand Line — Sold Trail',
  durationText: '8 Days',
  displayPriceText: 'NZD $3,000',
  soldOut: true,
  inclusions: ['4-star hotel accommodation'],
  departures: [],
})

const TWIN_A = tour({
  id: 'twa',
  slug: 'twin-a',
  name: 'Brand Line — Echo Valley',
})

const TWIN_B = tour({
  id: 'twb',
  slug: 'twin-b',
  name: 'Other Line — Echo Valley',
})

const DUP1 = tour({
  id: 'd1',
  slug: 'highlights',
  destination: 'alpha',
  tier: 'classic',
  name: 'Alpha Line — Highlights',
})

const DUP2 = tour({
  id: 'd2',
  slug: 'highlights',
  destination: 'beta',
  tier: 'classic',
  name: 'Beta Line — Highlights',
})

const TOURS: PublishedTourFact[] = [
  LOOP,
  WALK,
  SOLD,
  TWIN_A,
  TWIN_B,
  DUP1,
  DUP2,
]

interface RunOverrides {
  overlay?: string | null
  caption?: string
  firstComment?: string | null
  link?: string | null
  aliases?: Record<string, string[]>
  tours?: PublishedTourFact[]
}

function run(over: RunOverrides): FactCheckResult {
  const input: FactCheckInput = {
    texts: {
      overlay: over.overlay ?? null,
      caption: over.caption ?? '',
      firstComment: over.firstComment ?? null,
    },
    linkUrl: over.link ?? null,
    tours: over.tours ?? TOURS,
    aliasesByTourId: over.aliases ?? {},
    catalogVersion: 5,
    today: '2026-11-04',
  }
  return checkFacts(input)
}

function find(res: FactCheckResult, kind: string) {
  return res.items.filter((i) => i.kind === kind)
}

const LOOP_LINK =
  'https://www.example.com/tours/land/classic/mountain-loop?utm=1#x'

describe('checkFacts', () => {
  it('passes all-correct copy on the LOOP link and resolves the target', () => {
    const res = run({
      link: LOOP_LINK,
      caption:
        'Nineteen days. 5-star hotels. NZD $7,999 per person. Departs 30 May 2027.',
    })
    expect(res.verdict).toBe('pass')
    expect(res.targetTourId).toBe('loop')
    expect(res.catalogVersion).toBe(5)
    expect(res.items.length).toBeGreaterThan(0)
    for (const item of res.items) {
      expect(item.outcome).toBe('PASS')
    }

    const noWww = run({
      link: 'https://example.com/tours/land/classic/mountain-loop/',
      caption: 'Nineteen days.',
    })
    expect(noWww.targetTourId).toBe('loop')
  })

  it('fails on duration mismatches and passes on matching duration', () => {
    const overlay = run({ link: LOOP_LINK, overlay: '16 DAYS' })
    expect(overlay.verdict).toBe('fail')
    const overlayItems = find(overlay, 'duration_days')
    expect(overlayItems.length).toBeGreaterThan(0)
    const overlayFail = overlayItems.find((i) => i.outcome === 'FAIL')
    expect(overlayFail).toBeDefined()
    expect(overlayFail?.source).toBe('overlay')
    expect(overlayFail?.expected).toBe('19 Days')

    const spelled = run({ link: LOOP_LINK, caption: 'Sixteen days' })
    expect(spelled.verdict).toBe('fail')
    expect(
      find(spelled, 'duration_days').some((i) => i.outcome === 'FAIL'),
    ).toBe(true)

    const ok = run({ link: LOOP_LINK, caption: '19 days' })
    expect(
      find(ok, 'duration_days').every((i) => i.outcome === 'PASS'),
    ).toBe(true)
    expect(find(ok, 'duration_days').length).toBeGreaterThan(0)
  })

  it('fails on star mismatches and needs human when catalog has no star info', () => {
    const fourFive = run({ link: LOOP_LINK, caption: '4-5 star hotels' })
    expect(
      find(fourFive, 'hotel_stars').some((i) => i.outcome === 'FAIL'),
    ).toBe(true)

    const enDash = run({ link: LOOP_LINK, caption: '4–5 star' })
    expect(
      find(enDash, 'hotel_stars').some((i) => i.outcome === 'FAIL'),
    ).toBe(true)

    const five = run({ link: LOOP_LINK, caption: '5-star' })
    expect(
      find(five, 'hotel_stars').some((i) => i.outcome === 'PASS'),
    ).toBe(true)

    const walk = run({
      link: 'https://www.example.com/tours/land/classic/harbour-walk',
      caption: '4-star hotels',
    })
    const walkStars = find(walk, 'hotel_stars')
    expect(walkStars.length).toBeGreaterThan(0)
    expect(walkStars.every((i) => i.outcome === 'NEEDS_HUMAN')).toBe(true)
    expect(walk.verdict).toBe('needs_human')
  })

  it('checks money against display price, overrides, and single supplement', () => {
    const display = run({ link: LOOP_LINK, caption: 'NZD $7,999' })
    expect(
      find(display, 'money').some((i) => i.outcome === 'PASS'),
    ).toBe(true)

    const override = run({ link: LOOP_LINK, caption: 'NZD $8,299' })
    expect(
      find(override, 'money').some((i) => i.outcome === 'PASS'),
    ).toBe(true)

    const supplement = run({ link: LOOP_LINK, caption: 'NZD $1,895' })
    expect(
      find(supplement, 'money').some((i) => i.outcome === 'PASS'),
    ).toBe(true)

    const wrong = run({ link: LOOP_LINK, caption: 'NZD $7,349' })
    const wrongFail = find(wrong, 'money').find((i) => i.outcome === 'FAIL')
    expect(wrongFail).toBeDefined()
    expect(wrongFail?.expected).toBe('NZD $7,999')

    const masked = run({ link: LOOP_LINK, caption: 'NZ$7,3XX' })
    const maskedItems = find(masked, 'masked_price')
    expect(maskedItems.length).toBeGreaterThan(0)
    expect(maskedItems.every((i) => i.outcome === 'NEEDS_HUMAN')).toBe(true)
    expect(masked.verdict).toBe('needs_human')
  })

  it('checks dates against sellable departures', () => {
    const single = run({ link: LOOP_LINK, caption: '30 May 2027' })
    expect(
      find(single, 'date').some((i) => i.outcome === 'PASS'),
    ).toBe(true)

    const both = run({
      link: LOOP_LINK,
      caption: 'Departs 30 May and 13 June 2027',
    })
    const bothDates = find(both, 'date')
    expect(bothDates.length).toBeGreaterThanOrEqual(2)
    expect(bothDates.every((i) => i.outcome === 'PASS')).toBe(true)

    const notADeparture = run({ link: LOOP_LINK, caption: '26 March 2027' })
    expect(
      find(notADeparture, 'date').some((i) => i.outcome === 'FAIL'),
    ).toBe(true)

    const past = run({ link: LOOP_LINK, caption: '1 March 2026' })
    expect(find(past, 'date').some((i) => i.outcome === 'FAIL')).toBe(true)

    const pastDeparture = tour({
      id: 'past',
      slug: 'past-trail',
      name: 'Brand Line — Past Trail',
      durationText: '5 Days',
      displayPriceText: 'NZD $1,000',
      departures: [
        {
          departOn: '2026-01-01',
          displayDate: '1 January 2026',
          status: 'open',
          priceTextOverride: null,
        },
      ],
    })
    const pastRes = run({
      link: 'https://www.example.com/tours/land/classic/past-trail',
      caption: '1 January 2026',
      tours: [pastDeparture],
    })
    expect(find(pastRes, 'date').some((i) => i.outcome === 'FAIL')).toBe(true)
  })

  it('checks cruise names against inclusions', () => {
    const ok = run({ link: LOOP_LINK, caption: 'the Lantern Cruise' })
    expect(
      find(ok, 'cruise_name').some((i) => i.outcome === 'PASS'),
    ).toBe(true)

    const bad = run({ link: LOOP_LINK, caption: 'the Victoria Cruise' })
    expect(
      find(bad, 'cruise_name').some((i) => i.outcome === 'FAIL'),
    ).toBe(true)
  })

  it('flags old tour aliases as whole phrases', () => {
    const aliases = { loop: ['Brand Line — Summit Ring', 'Summit Ring'] }

    const overlay = run({
      link: LOOP_LINK,
      overlay: 'SUMMIT RING 19 DAYS',
      aliases,
    })
    expect(overlay.verdict).toBe('fail')
    const overlayOld = find(overlay, 'old_tour_name').find(
      (i) => i.outcome === 'FAIL',
    )
    expect(overlayOld).toBeDefined()
    expect(overlayOld?.source).toBe('overlay')
    expect(overlayOld?.expected).toBe('Brand Line — Mountain Loop')

    const comment = run({
      link: LOOP_LINK,
      firstComment: 'Summit Ring is back',
      aliases,
    })
    const commentOld = find(comment, 'old_tour_name').find(
      (i) => i.outcome === 'FAIL',
    )
    expect(commentOld).toBeDefined()
    expect(commentOld?.source).toBe('first_comment')

    const plural = run({
      link: LOOP_LINK,
      caption: 'Summit Rings',
      aliases,
    })
    expect(find(plural, 'old_tour_name').length).toBe(0)

    const selfAlias = run({
      link: LOOP_LINK,
      caption: 'Brand Line — Mountain Loop',
      aliases: { loop: ['Brand Line — Mountain Loop'] },
    })
    expect(find(selfAlias, 'old_tour_name').length).toBe(0)

    const currentName = run({
      link: LOOP_LINK,
      caption: 'Brand Line — Mountain Loop',
      aliases,
    })
    expect(find(currentName, 'old_tour_name').length).toBe(0)
  })

  it('needs human for general links with claims and passes without claims', () => {
    const general = run({
      link: 'https://www.example.com/guides/valley-guide',
      caption: 'Ten days of walking, NZD $2,450',
    })
    expect(general.targetTourId).toBeNull()
    expect(general.verdict).toBe('needs_human')
    const durations = find(general, 'duration_days')
    expect(durations.length).toBeGreaterThan(0)
    expect(durations.every((i) => i.outcome === 'NEEDS_HUMAN')).toBe(true)
    expect(durations.every((i) => i.expected === null)).toBe(true)
    const monies = find(general, 'money')
    expect(monies.length).toBeGreaterThan(0)
    expect(monies.every((i) => i.outcome === 'NEEDS_HUMAN')).toBe(true)
    expect(monies.every((i) => i.expected === null)).toBe(true)

    const noClaims = run({
      link: 'https://www.example.com/guides/valley-guide',
      caption: 'Walk with us. Tell us your budget.',
    })
    expect(noClaims.verdict).toBe('pass')

    const nullLink = run({
      link: null,
      caption: 'Ten days of walking, NZD $2,450',
    })
    expect(nullLink.targetTourId).toBeNull()
    expect(nullLink.verdict).toBe('needs_human')

    const unknown = run({
      link: 'https://www.example.com/tours/land/unknown-tour',
      caption: 'Walk with us.',
    })
    expect(unknown.targetTourId).toBeNull()
  })

  it('fails when the target tour is not sellable', () => {
    const sold = run({
      link: 'https://www.example.com/tours/land/classic/sold-trail',
      caption: 'Eight days',
    })
    const notSellable = find(sold, 'tour_not_sellable')
    expect(notSellable.length).toBeGreaterThan(0)
    expect(notSellable.every((i) => i.outcome === 'FAIL')).toBe(true)
    expect(sold.verdict).toBe('fail')

    const inactive = tour({
      id: 'inactive',
      slug: 'inactive-trail',
      name: 'Brand Line — Inactive Trail',
      durationText: '6 Days',
      displayPriceText: 'NZD $1,500',
      isActive: false,
    })
    const inactiveRes = run({
      link: 'https://www.example.com/tours/land/classic/inactive-trail',
      caption: 'Six days',
      tours: [inactive],
    })
    expect(find(inactiveRes, 'tour_not_sellable').length).toBeGreaterThan(0)
    expect(inactiveRes.verdict).toBe('fail')
  })

  it('needs human on ambiguous names and ambiguous links', () => {
    const ambiguousName = run({
      link: null,
      caption: 'Come to Echo Valley!',
    })
    const nameItems = find(ambiguousName, 'ambiguous_tour_name')
    expect(nameItems.length).toBeGreaterThan(0)
    expect(nameItems.every((i) => i.outcome === 'NEEDS_HUMAN')).toBe(true)
    expect(ambiguousName.verdict).toBe('needs_human')

    const resolved = run({
      link: 'https://www.example.com/tours/land/classic/twin-a',
      caption: 'Come to Echo Valley!',
    })
    expect(find(resolved, 'ambiguous_tour_name').length).toBe(0)

    const ambiguousLink = run({
      link: 'https://www.example.com/highlights',
      caption: 'Walk with us.',
    })
    const linkItems = find(ambiguousLink, 'ambiguous_tour_link')
    expect(linkItems.length).toBeGreaterThan(0)
    expect(linkItems.every((i) => i.outcome === 'NEEDS_HUMAN')).toBe(true)
    expect(ambiguousLink.targetTourId).toBeNull()

    const narrowed = run({
      link: 'https://www.example.com/alpha/highlights',
      caption: 'Walk with us.',
    })
    expect(narrowed.targetTourId).toBe('d1')
  })

  it('fails closed when a tour getter throws', () => {
    const bad: PublishedTourFact[] = [
      new Proxy(tour({ id: 'x', slug: 'x', name: 'X' }), {
        get() {
          throw new Error('boom')
        },
      }),
    ]
    const res = run({
      link: 'https://www.example.com/tours/land/classic/x',
      caption: 'Walk with us.',
      tours: bad,
    })
    expect(res.verdict).toBe('needs_human')
    expect(find(res, 'check_error').length).toBeGreaterThan(0)
  })

  it('prefers fail over needs_human in the verdict', () => {
    const res = run({
      link: LOOP_LINK,
      caption: '16 days. NZ$7,3XX',
    })
    expect(find(res, 'duration_days').some((i) => i.outcome === 'FAIL')).toBe(
      true,
    )
    expect(
      find(res, 'masked_price').some((i) => i.outcome === 'NEEDS_HUMAN'),
    ).toBe(true)
    expect(res.verdict).toBe('fail')
  })
})

describe('checkFacts banned phrases (client brand red lines)', () => {
  const base = (over: Partial<FactCheckInput>): FactCheckInput => ({
    texts: { overlay: null, caption: '', firstComment: null },
    linkUrl: null,
    tours: [LOOP],
    aliasesByTourId: {},
    catalogVersion: 1,
    today: '2026-11-05',
    ...over,
  })
  const bannedItems = (r: FactCheckResult) => r.items.filter((i) => i.kind === 'banned_phrase')

  it('fails when the caption holds a banned phrase written with a hyphen', () => {
    const r = checkFacts(
      base({
        texts: { overlay: null, caption: 'Four sides of China on small-group tours from Auckland', firstComment: null },
        bannedPhrases: ['small group'],
      }),
    )
    expect(r.verdict).toBe('fail')
    expect(bannedItems(r)).toEqual([
      { kind: 'banned_phrase', claim: 'small group', source: 'caption', outcome: 'FAIL', expected: null },
    ])
  })

  it('matches case-insensitively and reports which text it was in', () => {
    const r = checkFacts(
      base({
        texts: { overlay: 'LIMITED AVAILABILITY', caption: '', firstComment: 'Find your tour. Early Bird price' },
        bannedPhrases: ['limited availability', 'early bird'],
      }),
    )
    expect(bannedItems(r).map((i) => [i.source, i.claim])).toEqual([
      ['overlay', 'limited availability'],
      ['first_comment', 'early bird'],
    ])
  })

  it('passes clean text, an empty list, and no list', () => {
    const texts = { overlay: null, caption: 'Cruise the Li River', firstComment: null }
    expect(bannedItems(checkFacts(base({ texts, bannedPhrases: ['small group'] })))).toEqual([])
    expect(bannedItems(checkFacts(base({ texts, bannedPhrases: [] })))).toEqual([])
    expect(bannedItems(checkFacts(base({ texts })))).toEqual([])
  })

  it('ignores blank entries in the list', () => {
    const r = checkFacts(base({ texts: { overlay: null, caption: 'anything', firstComment: null }, bannedPhrases: ['', '  '] }))
    expect(bannedItems(r)).toEqual([])
  })

  it('reports a phrase once per text even when it repeats', () => {
    const r = checkFacts(
      base({
        texts: { overlay: null, caption: 'small group, small-group, SMALL GROUP', firstComment: null },
        bannedPhrases: ['small group', 'Small-Group'],
      }),
    )
    expect(bannedItems(r)).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import { parseFirstPartyTourFeed, type FirstPartyTour, type FirstPartyTourFeed } from '@/lib/web-intelligence/first-party-tours'
import { planSeed, type SeedPlan } from '../seed'
import { sanitizeSeedProduct } from '../seed-sanitize'

const SCRIPT = '</script><script>alert(1)</script>'

function product(overrides: Partial<FirstPartyTour> = {}): FirstPartyTour {
  return {
    id: 'p1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    title: 'Sample Tour Title',
    duration: '10 Days',
    price: 'From NZD $4,999 per person',
    is_active: true,
    updated_at: '2026-01-01',
    departure_dates: ['13 May 2027'],
    departure_pricing: {},
    tour_cities: ['Beijing', 'Xi\'an'],
    itinerary: [
      { day: 1, title: 'Arrive', description: 'Welcome.\nDinner together.', meals: ['Dinner'], accommodation: 'Hotel A' },
      { day: 2, title: 'Depart', description: '', meals: [], festiveLabel: 'Lantern Festival', operatorLogo: { src: 'https://cdn.example.org/logo.png', alt: 'Airline' } },
    ],
    inclusions: ['Meals'],
    exclusions: ['Flights'],
    single_supplement: 'NZD $900',
    max_group_size: 16,
    short_description: 'An introduction.',
    highlights: ['Great Wall'],
    hero_image: '/images/hero.jpg',
    gallery: ['/images/a.jpg', 'https://any-host.example/b.jpg?w=1600&q=80'],
    meta_title: 'Meta title',
    meta_description: 'Meta description',
    tags: ['culture', 'Great Wall'],
    faqs: [{ question: 'Visa?', answer: 'Yes.\nWe help.', link: { href: '/visa', label: 'Visa guide' } }],
    sold_out: false,
    single_supplement_note: 'Limited',
    rating: 4.8,
    review_count: 12,
    review_summary: 'Loved it',
    related_blog_slugs: ['a-post'],
    quick_answer: 'Ten days.',
    ...overrides,
  }
}

function feed(products: FirstPartyTour[]): FirstPartyTourFeed {
  return { source: 'example', source_version: '1', products }
}

function plan(overrides: Partial<FirstPartyTour>): SeedPlan {
  return planSeed(feed([product(overrides)]), new Set())
}

function noteCodes(p: SeedPlan): string[] {
  return p.notes.map((n) => n.note)
}

describe('read-in applies the save rules', () => {
  it('keeps a clean product exactly as sent, with no notes', () => {
    const notes: string[] = []
    const input = product()
    const frozen = JSON.stringify(input)
    expect(sanitizeSeedProduct(input, (n) => notes.push(n))).toEqual(input)
    expect(notes).toEqual([])
    expect(JSON.stringify(input)).toBe(frozen)
    expect(plan({}).notes).toEqual([])
  })

  it('keeps untrimmed but otherwise clean text as sent (no silent rewriting)', () => {
    const p = plan({ title: ' Padded title ', highlights: [' Great Wall '] })
    expect(p.tours[0].title).toBe(' Padded title ')
    expect(p.tours[0].highlights).toEqual([' Great Wall '])
    expect(p.notes).toEqual([])
  })

  it('drops unsafe gallery images one by one and keeps the rest in order', () => {
    const p = plan({
      gallery: [
        '/images/a.jpg',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'http://any-host.example/b.jpg',
        'https://any-host.example/c.svg',
        '//evil.example/d.jpg',
        'https://any-host.example/e.jpg"onerror="alert(1)',
        'https://any-host.example/f.jpg',
      ],
    })
    expect(p.tours[0].gallery).toEqual(['/images/a.jpg', 'https://any-host.example/f.jpg'])
    expect(noteCodes(p)).toEqual(Array(6).fill('gallery_item_rejected:Sample Tour'))
  })

  it('empties a gallery that is over the limit', () => {
    const many = Array.from({ length: 31 }, (_, i) => `/images/g${i}.jpg`)
    const p = plan({ gallery: many })
    expect(p.tours[0].gallery).toEqual([])
    expect(noteCodes(p)).toEqual(['gallery_rejected:Sample Tour'])
  })

  it('empties an unsafe main image and never echoes markup in the note', () => {
    for (const hero of ['javascript:alert(1)', '//evil.example/a.jpg', `https://x.example/${SCRIPT}.jpg`, 'https://x.example/a.svg']) {
      const p = plan({ hero_image: hero })
      expect(p.tours[0].hero_image, hero).toBeNull()
      expect(p.notes.length).toBe(1)
      expect(p.notes[0].note.startsWith('hero_image_rejected:')).toBe(true)
      expect(p.notes[0].note).not.toMatch(/[<>"']/)
    }
  })

  it('empties text fields that carry markup or invisible characters, naming the field', () => {
    const zeroWidth = 'Hidden' + String.fromCharCode(0x200b) + 'text'
    const lineSep = 'Line' + String.fromCharCode(0x2028) + 'separator'
    const p = plan({
      title: 'Title ' + SCRIPT,
      short_description: 'Intro <b>bold</b>',
      meta_title: zeroWidth,
      meta_description: 'Two\nlines',
      quick_answer: lineSep,
      review_summary: 'x'.repeat(301),
      single_supplement_note: 'ok' + String.fromCharCode(0xfeff),
      duration: '10 Days' + String.fromCharCode(7),
      single_supplement: 'see https://evil.example',
    })
    const row = p.tours[0]
    expect([row.title, row.short_description, row.meta_title, row.meta_description, row.quick_answer]).toEqual([null, null, null, null, null])
    expect([row.review_summary, row.single_supplement_note, row.duration_text, row.single_supplement]).toEqual([null, null, null, null])
    expect(noteCodes(p).sort()).toEqual([
      'text_rejected:Sample Tour:duration',
      'text_rejected:Sample Tour:meta_description',
      'text_rejected:Sample Tour:meta_title',
      'text_rejected:Sample Tour:quick_answer',
      'text_rejected:Sample Tour:review_summary',
      'text_rejected:Sample Tour:short_description',
      'text_rejected:Sample Tour:single_supplement',
      'text_rejected:Sample Tour:single_supplement_note',
      'text_rejected:Sample Tour:title',
    ])
  })

  it('skips a tour whose name is unusable, and reads the others in', () => {
    const p = planSeed(feed([product({ name: 'Bad ' + SCRIPT, slug: 'bad-tour' }), product()]), new Set())
    expect(p.tours.map((t) => t.slug)).toEqual(['sample-tour'])
    expect(p.departures.length).toBe(1)
    expect(noteCodes(p)).toEqual(['tour_skipped_invalid_name:bad-tour'])
  })

  it('skips a tour whose slug, destination or tier is unusable, without echoing markup', () => {
    const p = planSeed(feed([product({ slug: 'x' + SCRIPT }), product({ destination: 'a<b', slug: 's2' }), product({ tier: 'x'.repeat(201), slug: 's3' })]), new Set())
    expect(p.tours).toEqual([])
    expect(noteCodes(p).map((n) => n.split(':')[0])).toEqual(Array(3).fill('tour_skipped_invalid_key'))
    expect(JSON.stringify(p.notes)).not.toMatch(/[<>]/)
  })

  it('drops bad FAQs (unsafe link, markup, over-long) and keeps the good ones', () => {
    const good = { question: 'Visa?', answer: 'Yes.', link: null }
    const p = plan({
      faqs: [
        good,
        { question: 'Q', answer: 'A', link: { href: 'javascript:alert(1)', label: 'Click' } },
        { question: 'Q', answer: 'A', link: { href: '/api/secret', label: 'Click' } },
        { question: 'Q', answer: 'A', link: { href: '//evil.example', label: 'Click' } },
        { question: 'Q ' + SCRIPT, answer: 'A', link: null },
        { question: 'Q', answer: 'x'.repeat(1001), link: null },
        { question: 'Q', answer: 'A', link: { href: '/visa', label: 'Label">' } },
      ],
    })
    expect(p.tours[0].faqs).toEqual([good])
    expect(noteCodes(p)).toEqual(Array(6).fill('faq_item_rejected:Sample Tour'))
  })

  it('drops bad tags and empties a tag list with repeats', () => {
    const p = plan({ tags: ['culture', 'bad<tag', 'x'.repeat(61), '!!!'] })
    expect(p.tours[0].tags).toEqual(['culture'])
    expect(noteCodes(p)).toEqual(Array(3).fill('tags_item_rejected:Sample Tour'))
    const repeats = plan({ tags: ['Great Wall', 'great-wall'] })
    expect(repeats.tours[0].tags).toEqual([])
    expect(noteCodes(repeats)).toEqual(['tags_rejected:Sample Tour'])
  })

  it('empties an out-of-range rating and a bad review count', () => {
    const p = plan({ rating: 99, review_count: -5 })
    expect(p.tours[0].rating).toBeNull()
    expect(p.tours[0].review_count).toBeNull()
    expect(noteCodes(p)).toEqual(['rating_out_of_range:Sample Tour', 'review_count_invalid:Sample Tour'])
    expect(noteCodes(plan({ rating: 4.85 }))).toEqual(['rating_out_of_range:Sample Tour'])
    expect(noteCodes(plan({ review_count: 1.5 }))).toEqual(['review_count_invalid:Sample Tour'])
    expect(plan({ rating: null, review_count: null }).notes).toEqual([])
    expect(plan({ rating: 0, review_count: 0 }).notes).toEqual([])
  })

  it('cleans the per-day extras one by one and keeps the day', () => {
    const p = plan({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Welcome.', meals: ['Dinner', 'Lunch<b>'], accommodation: 'Hotel ' + SCRIPT },
        { day: 2, title: 'Depart', description: '', meals: [], festiveLabel: 'x'.repeat(61), operatorLogo: { src: '/images/logo.png', alt: 'Airline">' } },
        { day: 3, title: 'Home', description: '', meals: [], accommodation: 'Hotel C', operatorLogo: { src: 'javascript:alert(1)', alt: 'Airline' } },
      ],
    })
    expect(p.tours[0].itinerary).toEqual([
      { day: 1, title: 'Arrive', description: 'Welcome.', meals: ['Dinner'] },
      { day: 2, title: 'Depart', description: '', meals: [] },
      { day: 3, title: 'Home', description: '', meals: [], accommodation: 'Hotel C' },
    ])
    expect(noteCodes(p)).toEqual([
      'meals_item_rejected:Sample Tour:1',
      'text_rejected:Sample Tour:itinerary.1.accommodation',
      'text_rejected:Sample Tour:itinerary.2.festiveLabel',
      'operator_logo_rejected:Sample Tour:2',
      'operator_logo_rejected:Sample Tour:3',
    ])
  })

  it('empties the whole itinerary when a day title or description is unusable', () => {
    const p = plan({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Welcome.', meals: [] },
        { day: 2, title: 'Day ' + SCRIPT, description: '', meals: [] },
      ],
    })
    expect(p.tours[0].itinerary).toEqual([])
    expect(noteCodes(p)).toEqual(['itinerary_rejected:Sample Tour'])
    expect(noteCodes(plan({ itinerary: [{ day: 1, title: 'Arrive', description: 'x<y', meals: [] }] }))).toEqual(['itinerary_rejected:Sample Tour'])
  })

  it('does not judge day numbering at read-in', () => {
    const days = [{ day: 1, title: 'A', description: '', meals: [] }, { day: 3, title: 'C', description: '', meals: [] }]
    const p = plan({ itinerary: days })
    expect(p.tours[0].itinerary).toEqual(days)
    expect(p.notes).toEqual([])
  })

  it('drops bad items from the plain lists and from the pass-through blog slugs', () => {
    const p = plan({
      highlights: ['Great Wall', 'Bad ' + SCRIPT],
      inclusions: ['Meals', 'x'.repeat(501)],
      exclusions: ['Flights', 'Tips' + String.fromCharCode(0x202e)],
      tour_cities: ['Beijing', 'Xi<an'],
      related_blog_slugs: ['a-post', '"><script>'],
    })
    const row = p.tours[0]
    expect([row.highlights, row.inclusions, row.exclusions, row.tour_cities]).toEqual([['Great Wall'], ['Meals'], ['Flights'], ['Beijing']])
    expect(row.site_extras).toEqual({ related_blog_slugs: ['a-post'] })
    expect(noteCodes(p).sort()).toEqual([
      'exclusions_item_rejected:Sample Tour',
      'highlights_item_rejected:Sample Tour',
      'inclusions_item_rejected:Sample Tour',
      'related_blog_slugs_item_rejected:Sample Tour',
      'tour_cities_item_rejected:Sample Tour',
    ])
  })

  it('reads a thoroughly polluted website feed in without throwing, cleaning each item', () => {
    const raw = {
      source: 'example',
      source_version: '1',
      products: [
        {
          ...product(),
          name: 'Polluted Tour',
          slug: 'polluted-tour',
          title: 'Title ' + SCRIPT,
          gallery: ['/images/ok.jpg', 'javascript:alert(1)', 'data:text/html,x', 'http://x.example/a.jpg', 'https://x.example/a.svg'],
          faqs: [{ question: 'Q', answer: 'A', link: { href: 'javascript:alert(1)', label: 'Go' } }],
          itinerary: [{ day: 1, title: 'Arrive', description: 'Hi', meals: [], operatorLogo: { src: '/images/logo.png', alt: 'Air">' } }],
          rating: 99,
          review_count: -5,
        },
        { ...product(), name: 'Evil ' + SCRIPT, slug: 'evil-tour' },
        product(),
      ],
    }
    const parsed = parseFirstPartyTourFeed(JSON.parse(JSON.stringify(raw)) as unknown)
    if (parsed === null) throw new Error('feed unreadable')
    const p = planSeed(parsed, new Set())
    expect(p.tours.map((t) => t.slug)).toEqual(['polluted-tour', 'sample-tour'])
    const row = p.tours[0]
    expect(row.title).toBeNull()
    expect(row.gallery).toEqual(['/images/ok.jpg'])
    expect(row.faqs).toEqual([])
    expect(row.itinerary).toEqual([{ day: 1, title: 'Arrive', description: 'Hi', meals: [] }])
    expect(row.rating).toBeNull()
    expect(row.review_count).toBeNull()
    expect(noteCodes(p)).toEqual([
      'text_rejected:Polluted Tour:title',
      'rating_out_of_range:Polluted Tour',
      'review_count_invalid:Polluted Tour',
      'operator_logo_rejected:Polluted Tour:1',
      'faq_item_rejected:Polluted Tour',
      ...Array(4).fill('gallery_item_rejected:Polluted Tour'),
      'tour_skipped_invalid_name:evil-tour',
    ])
    expect(JSON.stringify(p.tours)).not.toMatch(/[<>]|javascript:|data:|http:\/\//)
  })

  it('carries the reader\'s own notes into the read-in notes', () => {
    const p = planSeed({ ...feed([product()]), parse_notes: ['unknown_field:sample-tour:video_url'] }, new Set())
    expect(p.notes).toEqual([{ tourKey: '(feed)', note: 'unknown_field:sample-tour:video_url' }])
  })
})

// Contract test: whatever buildMontageProps emits must pass the REAL engine's validation
// (the same loadTemplate the factory worker runs), so a server-built order is never refused at the worker.
import { describe, it, expect, beforeAll } from 'vitest'
import { loadRealEngine, type RealEngine } from './engine-loader'
import { buildMontageProps } from './montage-props'
import { travelProfile } from './profiles/travel'
import { loadCatalogTracks } from './catalog-fixture'
import type { AssetPoolClip, IndustryWordProfile, ProductFactInput } from './types'

const now = new Date('2026-10-06T00:00:00Z')
const brand = { brandColor: '#0B6E99', logoFile: 'logo.png' }
const kinds = ['aerial', 'street', 'person', 'detail'] as const

const pool: AssetPoolClip[] = Array.from({ length: 12 }, (_, i) => ({
  file: `clips/c${i + 1}.mp4`,
  tag: `tag-${(i % 4) + 1}`,
  kind: kinds[i % 4],
  source: i % 3 === 0 ? 'own' : 'stock',
  lenFrames: 300,
}))

const travelFact: ProductFactInput = {
  name: 'Example Tour',
  duration_days: 27,
  from_price: { amount: 10899, currency: 'NZD' },
  price_basis: 'per person twin share',
  departures: ['2027-05-08', '2027-10-16'],
  inclusions: [
    'Return international airfares from Auckland',
    'Domestic airfares within China',
    '4–5 star hotel accommodation',
    'Victoria Yangtze River Cruise (International 5-star)',
    'English-speaking tour guide',
  ],
  source_url: 'https://example.test/tour',
  verified_at: '2026-10-05T06:00:00.000Z',
  status: 'ok',
}

// A non-travel profile proves the builder + engine accept another industry's words unchanged.
const propertyProfile: IndustryWordProfile = {
  id: 'test-property',
  buildWords: () => ({
    ok: true,
    words: [
      { text: '3 BED', beats: 1, bg: 'brand' },
      { text: '2 BATH', beats: 1, bg: 'white' },
      { text: 'OPEN', beats: 1, bg: 'black' },
      { text: 'HOME', beats: 1, bg: 'white' },
      { text: 'POOL', beats: 1, bg: 'black' },
      { text: 'GARAGE', beats: 1, bg: 'white' },
      { text: 'NEAR', beats: 1, bg: 'black' },
      { text: 'SCHOOLS', beats: 1, bg: 'white' },
      { text: 'FROM', beats: 1, bg: 'black' },
      { text: 'A$1,200,000', beats: 2, bg: 'brand' },
      { text: 'OPEN 1 NOV', beats: 2, bg: 'brand' },
    ],
  }),
}
const propertyFact: ProductFactInput = {
  ...travelFact,
  duration_days: 3,
  from_price: { amount: 1200000, currency: 'AUD' },
  departures: ['2026-11-01'],
  inclusions: ['3 bed', '2 bath'],
}

describe('server-built montage props pass the real engine', () => {
  let engine: RealEngine
  beforeAll(async () => {
    engine = await loadRealEngine()
  })

  it('travel profile with the full real music catalog', () => {
    const r = buildMontageProps({ fact: travelFact, brand, pool, tracks: loadCatalogTracks(), profile: travelProfile, now })
    if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`)
    expect(() => engine.loadTemplate('montage', r.props)).not.toThrow()
  })

  it('non-travel profile passes the engine too', () => {
    const r = buildMontageProps({ fact: propertyFact, brand, pool, tracks: loadCatalogTracks(), profile: propertyProfile, now })
    if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`)
    expect(() => engine.loadTemplate('montage', r.props)).not.toThrow()
  })

  it('every catalog track that can be picked yields engine-valid props', () => {
    let built = 0
    for (const track of loadCatalogTracks()) {
      const r = buildMontageProps({ fact: travelFact, brand, pool, tracks: [track], profile: travelProfile, now })
      if (!r.ok) {
        expect(r.reason).toBe('no_usable_music')
        continue
      }
      built += 1
      expect(() => engine.loadTemplate('montage', r.props), `track ${track.id}`).not.toThrow()
    }
    expect(built).toBeGreaterThan(0)
  })
})

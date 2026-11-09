import { describe, it, expect } from 'vitest'
import type {
  AssetPoolClip,
  BlockReason,
  ClipKind,
  IndustryWordProfile,
  MontageBuildResult,
  MusicTrack,
  ProductFactInput,
  WordSpec,
} from './types'
import { buildMontageProps, type BuildMontageInput } from './montage-props'
import { travelProfile } from './profiles/travel'

/** Narrow a successful result, throwing on failure. */
function ok(result: MontageBuildResult): Extract<MontageBuildResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.reason}: ${result.detail}`)
  }
  return result
}

/** Extract the failure reason, throwing on success. */
function failReason(result: MontageBuildResult): BlockReason {
  if (result.ok) {
    throw new Error('expected failure, got ok')
  }
  return result.reason
}

const KINDS: readonly ClipKind[] = ['aerial', 'street', 'person', 'detail']

/** Nine stock clips cycling through all four kinds. */
const pool: AssetPoolClip[] = Array.from({ length: 9 }, (_, i) => ({
  file: `clips/c${i + 1}.mp4`,
  tag: `tag-${String.fromCharCode(97 + i)}`,
  kind: KINDS[i % KINDS.length],
  source: 'stock',
  lenFrames: 300,
}))

/** Three synthetic tracks with distinct ids, energies and tempos. */
const tracks: MusicTrack[] = [
  { id: 'trk-a', folder: 'Music', file: 'a.m4a', durationSec: 120, bpmDetected: 120, offsetSec: 0.2, barPhase: 0, status: 'beats_unverified', energy: 'high', style: 'x', mood: 'y' },
  { id: 'trk-b', folder: 'Music', file: 'b.m4a', durationSec: 120, bpmDetected: 110, offsetSec: 0.2, barPhase: 0, status: 'beats_unverified', energy: 'mid', style: 'x', mood: 'y' },
  { id: 'trk-c', folder: 'Music', file: 'c.m4a', durationSec: 120, bpmDetected: 128, offsetSec: 0.2, barPhase: 0, status: 'beats_unverified', energy: 'high', style: 'x', mood: 'y' },
]

/** Base product fact with optional overrides. */
function baseFact(overrides: Partial<ProductFactInput> = {}): ProductFactInput {
  return {
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
    ...overrides,
  }
}

/** Base builder input with optional overrides. */
function baseInput(overrides: Partial<BuildMontageInput> = {}): BuildMontageInput {
  return {
    fact: baseFact(),
    brand: { brandColor: '#0B6E99', logoFile: 'logo.png' },
    pool,
    tracks,
    profile: travelProfile,
    now: new Date('2026-10-06T00:00:00Z'),
    ...overrides,
  }
}

describe('buildMontageProps', () => {
  it('builds a happy-path montage', () => {
    const result = ok(buildMontageProps(baseInput()))
    const { props, receipt } = result

    expect(props.words[0].text).toBe('27 DAYS')

    let at = 0
    for (const w of props.words) {
      expect(w.at).toBe(at)
      at += w.beats
    }

    for (const w of props.words) {
      expect(w.text.length).toBeLessThanOrEqual(12)
    }

    expect(props.beats.length).toBe(props.totalBeats + 1)
    expect(props.musicFile.endsWith('.m4a')).toBe(true)
    expect(receipt.no_publish).toBe(true)

    const columns = receipt.recipe_gaps.map((g) => g.column)
    expect(columns).toContain('真实感')
    expect(columns).not.toContain('真人出镜/自拍感')
  })

  it('emits the expected travel words', () => {
    const texts = ok(buildMontageProps(baseInput())).props.words.map((w) => w.text)
    for (const expected of [
      'NZ$10,899',
      'FROM',
      'PER PERSON',
      'TWIN SHARE',
      'DEPARTS',
      '8 MAY 2027',
      '16 OCT 2027',
      '4-5 STAR',
      'FLIGHTS',
      'CRUISE',
    ]) {
      expect(texts).toContain(expected)
    }
  })

  it('alternates black and white backgrounds across non-brand words', () => {
    const words = ok(buildMontageProps(baseInput())).props.words.filter((w) => w.bg !== 'brand')
    expect(words.length).toBeGreaterThan(4)
    words.forEach((w, i) => expect(w.bg).toBe(i % 2 === 0 ? 'black' : 'white'))
  })

  it('rejects stale and non-ok facts', () => {
    expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ status: 'stale' }) })))).toBe('fact_stale')
    expect(
      failReason(
        buildMontageProps(
          baseInput({ fact: baseFact({ verified_at: '2026-09-16T00:00:00.000Z' }) }),
        ),
      ),
    ).toBe('fact_stale')
    expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ status: 'fetch_failed' }) })))).toBe('fact_not_ok')
  })

  it('rejects incomplete facts', () => {
    expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ from_price: null }) })))).toBe('fact_incomplete')
    expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ inclusions: [] }) })))).toBe('fact_incomplete')
  })

  it('handles past departures', () => {
    expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ departures: ['2026-01-01'] }) })))).toBe('departures_past')

    const texts = ok(
      buildMontageProps(baseInput({ fact: baseFact({ departures: ['2026-01-01', '2027-05-08'] }) })),
    ).props.words.map((w) => w.text)
    expect(texts).toContain('8 MAY 2027')
    expect(texts).not.toContain('1 JAN 2026')
  })

  it('rejects unknown currencies', () => {
    const fact = baseFact({ from_price: { amount: 10899, currency: 'JPY' } })
    expect(failReason(buildMontageProps(baseInput({ fact })))).toBe('price_currency_unknown')
  })

  it('rejects bad pools', () => {
    expect(failReason(buildMontageProps(baseInput({ pool: pool.slice(0, 7) })))).toBe('pool_too_small')

    const twoKinds = pool.map((c, i) => ({ ...c, kind: i % 2 === 0 ? 'aerial' : 'street' } as AssetPoolClip))
    expect(failReason(buildMontageProps(baseInput({ pool: twoKinds })))).toBe('pool_kinds_too_few')

    const dup = [...pool.slice(0, 8), pool[0]]
    expect(failReason(buildMontageProps(baseInput({ pool: dup })))).toBe('pool_duplicate_file')
  })

  it('rejects unusable music', () => {
    expect(failReason(buildMontageProps(baseInput({ tracks: [] })))).toBe('no_usable_music')
    const short = tracks.map((t) => ({ ...t, durationSec: 10 }))
    expect(failReason(buildMontageProps(baseInput({ tracks: short })))).toBe('no_usable_music')
  })

  it('rejects too few words', () => {
    // Minimal fact: no inclusions, no basis, one departure -> 7 words, below the floor.
    const fact = baseFact({
      inclusions: ['Meals'],
      price_basis: '',
      departures: ['2027-05-08'],
    })
    expect(failReason(buildMontageProps(baseInput({ fact })))).toBe('too_few_words')
  })

  it('rejects numbers not present in the fact', () => {
    const bonusProfile: IndustryWordProfile = {
      id: 'bonus',
      buildWords() {
        const texts = [
          '99 BONUS', '27 DAYS', '27 DAYS', '27 DAYS', '27 DAYS', '27 DAYS',
          '27 DAYS', '27 DAYS', '27 DAYS', '27 DAYS', '27 DAYS', '27 DAYS',
        ]
        return { ok: true, words: texts.map((text): WordSpec => ({ text, beats: 1, bg: 'black' })) }
      },
    }
    expect(failReason(buildMontageProps(baseInput({ profile: bonusProfile })))).toBe('number_not_in_fact')
  })

  it('is deterministic', () => {
    const a = buildMontageProps(baseInput())
    const b = buildMontageProps(baseInput())
    expect(a).toEqual(b)
  })

  it('has no travel assumptions for a non-travel profile', () => {
    const propertyProfile: IndustryWordProfile = {
      id: 'property',
      buildWords() {
        const texts = [
          '3 BED', '2 BATH', '3 BED', '2 BATH', '3 BED', '2 BATH',
          '3 BED', '2 BATH', '3 BED', '2 BATH', '3 BED', '2 BATH',
        ]
        return { ok: true, words: texts.map((text): WordSpec => ({ text, beats: 1, bg: 'black' })) }
      },
    }
    const fact: ProductFactInput = {
      name: 'Example Property',
      duration_days: 3,
      from_price: { amount: 1200000, currency: 'AUD' },
      price_basis: null,
      departures: ['2026-11-01'],
      inclusions: ['3 bed', '2 bath'],
      source_url: 'https://example.test/property',
      verified_at: '2026-10-05T06:00:00.000Z',
      status: 'ok',
    }
    const result = ok(buildMontageProps(baseInput({ fact, profile: propertyProfile })))
    expect(result.props.words.length).toBe(12)
    expect(result.receipt.profile).toBe('property')
  })
})

describe('review follow-ups (PR 2300 findings)', () => {
  /** Property-style profile whose words are chosen by the test. */
  function wordsProfile(words: WordSpec[]): IndustryWordProfile {
    return { id: 'test-words', buildWords: () => ({ ok: true, words }) }
  }
  const tenWords = (first = '3 BED'): WordSpec[] => [
    { text: first, beats: 1, bg: 'brand' },
    ...Array.from({ length: 9 }, (_, i): WordSpec => ({ text: i % 2 === 0 ? 'POOL' : 'HOME', beats: 1, bg: i % 2 === 0 ? 'black' : 'white' })),
  ]
  const propertyFact = baseFact({ inclusions: ['3 bed'], duration_days: 3 })

  it('checks kind diversity on the TRUNCATED pool (24), not the full one', () => {
    const long: AssetPoolClip[] = Array.from({ length: 25 }, (_, i) => ({
      file: `clips/l${i + 1}.mp4`, tag: `t${i}`, kind: i < 24 ? (i % 2 === 0 ? 'aerial' : 'street') : 'person', source: 'stock', lenFrames: 300,
    }))
    expect(failReason(buildMontageProps(baseInput({ pool: long })))).toBe('pool_kinds_too_few')
  })

  it('rejects pool clips the engine would refuse', () => {
    const bad = (patch: Partial<AssetPoolClip>): AssetPoolClip[] => [{ ...pool[0], ...patch }, ...pool.slice(1)]
    const cases: Array<Partial<AssetPoolClip>> = [
      { tag: 'Has Space' }, { tag: 'under_score' }, { file: '../x.mp4' }, { file: '/abs/x.mp4' },
      { file: 'https://x.test/a.mp4' }, { file: 'clips/a.gif' }, { lenFrames: 10 }, { lenFrames: 901 }, { lenFrames: 30.5 },
      { luma: 0 }, { kind: 'drone' as ClipKind },
    ]
    for (const patch of cases) {
      expect(failReason(buildMontageProps(baseInput({ pool: bad(patch) }))), JSON.stringify(patch)).toBe('pool_invalid_clip')
    }
  })

  it('rejects a brand colour or logo the engine would refuse', () => {
    for (const brand of [
      { brandColor: 'red', logoFile: 'logo.png' }, { brandColor: '#12345', logoFile: 'logo.png' },
      { brandColor: '#0B6E99', logoFile: 'https://x.test/logo.png' }, { brandColor: '#0B6E99', logoFile: '/abs/logo.png' },
      { brandColor: '#0B6E99', logoFile: 'logo.gif' }, { brandColor: '#0B6E99', logoFile: '../logo.png' },
    ]) {
      expect(failReason(buildMontageProps(baseInput({ brand }))), JSON.stringify(brand)).toBe('brand_invalid')
    }
  })

  it('validates words returned by ANY profile', () => {
    const run = (words: WordSpec[]) => failReason(buildMontageProps(baseInput({ fact: propertyFact, profile: wordsProfile(words) })))
    expect(run(tenWords('OPEN'))).toBe('word_invalid') // first word must be a number or a question
    const w = tenWords()
    expect(run([{ ...w[0], text: '3 BEDROOMS 13X' }, ...w.slice(1)])).toBe('word_invalid') // 13 chars
    expect(run([{ ...w[0], text: '3\u0007' }, ...w.slice(1)])).toBe('word_invalid') // control char
    expect(run([w[0], { ...w[1], text: '   ' }, ...w.slice(2)])).toBe('word_invalid') // blank
    expect(run([w[0], { ...w[1], beats: 4 as 1 }, ...w.slice(2)])).toBe('word_invalid') // beats out of range
  })

  it('rejects zero, negative and NaN prices', () => {
    for (const amount of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ from_price: { amount, currency: 'NZD' } }) })))).toBe('fact_incomplete')
    }
  })

  it('drops non-existent calendar dates such as 2027-02-31', () => {
    expect(failReason(buildMontageProps(baseInput({ fact: baseFact({ departures: ['2027-02-31'] }) })))).toBe('departures_past')
    const texts = ok(buildMontageProps(baseInput({ fact: baseFact({ departures: ['2027-02-31', '2027-05-08'] }) }))).props.words.map((w) => w.text)
    expect(texts).toContain('8 MAY 2027')
    expect(texts.some((t) => t.includes('FEB'))).toBe(false)
  })

  it("filters today's departure by the CLIENT's local date, not UTC", () => {
    // 2026-10-05 12:30 UTC is 2026-10-06 01:30 in Auckland: a 2026-10-06 departure is already today there.
    const now = new Date('2026-10-05T12:30:00Z')
    const fact = baseFact({ departures: ['2026-10-06', '2027-05-08'] })
    const nz = ok(buildMontageProps(baseInput({ now, fact }))).props.words.map((w) => w.text)
    expect(nz).not.toContain('6 OCT 2026')
    expect(nz).toContain('8 MAY 2027')
    const utc = ok(buildMontageProps(baseInput({ now, fact, timeZone: 'UTC' }))).props.words.map((w) => w.text)
    expect(utc).toContain('6 OCT 2026')
  })
})

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

  it('checks kind diversity on the truncated pool, not the full one', () => {
    const big: AssetPoolClip[] = Array.from({ length: 25 }, (_, i) => ({
      ...pool[0],
      file: `clip-${i}.mp4`,
      tag: `t${i}`,
      kind: i === 24 ? 'detail' : i % 2 === 0 ? 'aerial' : 'street',
    } as AssetPoolClip))
    expect(failReason(buildMontageProps(baseInput({ pool: big })))).toBe('pool_kinds_too_few')
  })

  it('rejects clips that violate the engine contract', () => {
    for (const bad of [{ tag: 'Bad_Tag' }, { file: '../x.mp4' }, { file: 'a b.mp4' }, { lenFrames: 10 }, { lenFrames: 1000 }]) {
      const broken = pool.map((c, i) => (i === 0 ? { ...c, ...bad } : c))
      expect(failReason(buildMontageProps(baseInput({ pool: broken })))).toBe('pool_clip_invalid')
    }
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
  it('rejects invalid brand colour and logo before building', () => {
    for (const brand of [
      { brandColor: 'blue', logoFile: 'logo.png' },
      { brandColor: '#0B6E99', logoFile: 'https://x.test/logo.png' },
      { brandColor: '#0B6E99', logoFile: '/abs/logo.png' },
      { brandColor: '#0B6E99', logoFile: 'logo.svg' },
    ]) {
      const r = buildMontageProps(baseInput({ brand }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('brand_invalid')
    }
  })

  it('rejects profile words that violate the engine word rules', () => {
    const make = (first: string, extra: string): IndustryWordProfile => ({
      id: 'x',
      buildWords() {
        const texts = [first, extra, ...Array.from({ length: 10 }, () => '2 BED')]
        return { ok: true, words: texts.map((text): WordSpec => ({ text, beats: 1, bg: 'black' })) }
      },
    })
    const cases: Array<[IndustryWordProfile, string]> = [
      [make('OPEN', '2 BED'), 'first_word_invalid'],
      [make('2 BED', 'WAY TOO LONG WORD'), 'word_too_long'],
      [make('2 BED', '   '), 'word_invalid'],
      [make('2 BED', 'A\tB'), 'word_invalid'],
    ]
    for (const [profile, reason] of cases) {
      const r = buildMontageProps(baseInput({ profile }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe(reason)
    }
  })
})

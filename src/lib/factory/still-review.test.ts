import { describe, expect, it } from 'vitest'

import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

import { judgeStillCopy, parseStillVisual, readStillReviews } from './still-review'

function tour(): PublishedTourFact {
  return {
    id: 't1', slug: 'harbour-walk', destination: 'harbour', tier: 'classic',
    name: 'Harbour Walk', title: null, durationText: '19 Days', displayPriceText: null,
    highlights: [], inclusions: [], exclusions: [], singleSupplement: null,
    soldOut: false, managesDepartures: false, isActive: true, departures: [],
  }
}

const source = { ok: true as const, catalogVersion: 1, tours: [tour()], aliasesByTourId: {} }

const quiet = {
  overlay: 'Harbour Walk',
  caption: 'Harbour Walk',
  linkUrl: 'https://example.com/harbour-walk',
  phrases: [] as string[],
  topics: [] as string[],
  source,
  today: '2026-11-12',
}

describe('judgeStillCopy', () => {
  it('passes copy that does not contradict the catalog', () => {
    expect(judgeStillCopy(quiet).pass).toBe(true)
  })

  it('does not pass a banned phrase', () => {
    const verdict = judgeStillCopy({ ...quiet, caption: 'Discover the harbour', phrases: ['Discover'] })
    expect(verdict.pass).toBe(false)
    expect(verdict.redlineHits).toEqual(['Discover'])
  })

  it('does not pass a duration that disagrees with the catalog', () => {
    const verdict = judgeStillCopy({ ...quiet, overlay: '16 DAYS' })
    expect(verdict.pass).toBe(false)
    expect(verdict.factVerdict).toBe('fail')
  })

  it('does not pass a fact result that needs a person', () => {
    const verdict = judgeStillCopy({
      ...quiet,
      overlay: 'Ten days of walking',
      linkUrl: 'https://example.com/guides/valley',
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.factVerdict).toBe('needs_human')
  })

  it('does not pass when the catalog cannot be read', () => {
    const verdict = judgeStillCopy({ ...quiet, source: null })
    expect(verdict.pass).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('团目录读不到')
  })
})

describe('parseStillVisual', () => {
  it('passes only when every flag is true', () => {
    const ok = '{"text_legible":true,"faces_ok":true,"place_ok":true,"brands_ok":true}'
    expect(parseStillVisual(ok).pass).toBe(true)
  })

  it('fails a false flag and an unreadable reply', () => {
    const cropped = '{"text_legible":false,"faces_ok":true,"place_ok":true,"brands_ok":true}'
    expect(parseStillVisual(cropped).reasons).toContain('画面文字看不清或被裁切')
    expect(parseStillVisual('not json').pass).toBe(false)
    expect(parseStillVisual('{"text_legible":true}').reasons).toEqual(['画面审读不出来'])
  })
})

describe('readStillReviews', () => {
  it('does not treat a missing verdict as a pass', () => {
    const rows = readStillReviews({
      stills: [{ role: 'story', slot_date: '2026-11-16', reviewer: 'system:still-review' }],
    })
    expect(rows[0]?.verdict).toBe('fail')
  })
})

import { describe, expect, it } from 'vitest'

import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

import { judgeStillCopy, loadStillRedlines, parseStillVisual, readStillReviews } from './still-review'

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

describe('loadStillRedlines', () => {
  it('asks for the newest brief that is actually in use', async () => {
    const seen: string[] = []
    const brief = {
      select: () => brief,
      eq: () => brief,
      or: (filter: string) => { seen.push(filter); return brief },
      order: (column: string, opts: { ascending: boolean }) => { seen.push(`${column}:${String(opts.ascending)}`); return brief },
      limit: () => Promise.resolve({ data: [{ excluded_topics: ['old offer'] }], error: null }),
    }
    const clients = {
      select: () => clients,
      eq: () => clients,
      limit: () => Promise.resolve({ data: [{ brand_redline_phrases: ['Discover'] }], error: null }),
    }
    const supabase = { from: (table: string) => (table === 'clients' ? clients : brief) }
    const redlines = await loadStillRedlines(supabase as never, 'c1')
    expect(redlines).toEqual({ phrases: ['Discover'], topics: ['old offer'] })
    expect(seen).toEqual(['status.eq.active,is_active.eq.true', 'version:false'])
  })

  it('does not treat a missing active brief as an empty red line', async () => {
    const brief = {
      select: () => brief,
      eq: () => brief,
      or: () => brief,
      order: () => brief,
      limit: () => Promise.resolve({ data: [], error: null }),
    }
    const clients = {
      select: () => clients,
      eq: () => clients,
      limit: () => Promise.resolve({ data: [{ brand_redline_phrases: [] }], error: null }),
    }
    const supabase = { from: (table: string) => (table === 'clients' ? clients : brief) }
    expect(await loadStillRedlines(supabase as never, 'c1')).toBeNull()
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

import { describe, expect, it } from 'vitest'

import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

import { judgeStillCopy, loadStillRedlines, parseStillVisual, readStillReviews, reviewStillImage, stillVisualPrompt } from './still-review'

function tour(over: Partial<PublishedTourFact> = {}): PublishedTourFact {
  return {
    id: 't1', slug: 'harbour-walk', destination: 'harbour', tier: 'classic',
    name: 'Harbour Walk', title: null, durationText: '19 Days', displayPriceText: 'NZD $2,450',
    highlights: [], inclusions: [], exclusions: [], singleSupplement: null,
    soldOut: false, managesDepartures: true, isActive: true,
    departures: [{ departOn: '2027-03-25', displayDate: '25 March 2027', status: 'open', priceTextOverride: null }],
    ...over,
  }
}

const bridge = tour({ id: 't2', slug: 'bridge-walk', name: 'Bridge Walk', displayPriceText: 'NZD $9,999', departures: [{ departOn: '2027-08-01', displayDate: '1 August 2027', status: 'open', priceTextOverride: null }] })

const source = { ok: true as const, catalogVersion: 1, tours: [tour(), bridge], aliasesByTourId: {} }

const quiet = {
  overlay: 'Harbour Walk',
  caption: 'Harbour Walk',
  linkUrl: 'https://example.com/harbour-walk',
  phrases: [] as string[],
  topics: [] as string[],
  source,
  today: '2026-11-12',
  imageTourId: 't1',
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
    const verdict = judgeStillCopy({ ...quiet, overlay: 'Harbour Walk NZ$2,4XX' })
    expect(verdict.pass).toBe(false)
    expect(verdict.factVerdict).toBe('needs_human')
  })

  it('fails when the picture names another on-sale tour with the same destination', () => {
    const verdict = judgeStillCopy({ ...quiet, overlay: 'Bridge Walk' })
    expect(verdict.pass).toBe(false)
    expect(verdict.factVerdict).toBe('fail')
    expect(verdict.reasons.join(' ')).toContain('Bridge Walk')
  })

  it('passes when the picture names the recorded tour', () => {
    const verdict = judgeStillCopy({ ...quiet, overlay: 'Harbour Walk NZD $2,450 departing 25 March 2027' })
    expect(verdict.pass).toBe(true)
    expect(verdict.factVerdict).toBe('pass')
  })

  it('does not pass when the recorded tour cannot be read', () => {
    const verdict = judgeStillCopy({ ...quiet, imageTourId: '' })
    expect(verdict.pass).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('线路读不到')
  })

  it('does not pass when the catalog cannot be read', () => {
    const verdict = judgeStillCopy({ ...quiet, source: null })
    expect(verdict.pass).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('团目录读不到')
  })
})

describe('stillVisualPrompt', () => {
  it('names only this tour and fails text that points at another tour', () => {
    const prompt = stillVisualPrompt({ tourName: 'Harbour Walk', place: 'harbour', overlay: 'Harbour Walk' })
    expect(prompt).toContain('Harbour Walk')
    expect(prompt).not.toContain('Bridge Walk')
    expect(prompt).toContain('If the on-image text names a different tour, the still fails.')
  })

  it('does not call the model when the tour name is missing', async () => {
    const verdict = await reviewStillImage({ imageUrl: 'https://cdn.example/a.jpg', place: 'harbour', overlay: 'Harbour Walk', tourName: '  ' })
    expect(verdict).toMatchObject({ pass: false, billed: false, costUsd: null })
    expect(verdict.reasons.join(' ')).toContain('线路读不到')
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

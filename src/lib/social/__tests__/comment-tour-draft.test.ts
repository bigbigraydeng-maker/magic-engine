/**
 * Catalog-grounded comment drafts: which tour a post names, which facts the
 * model may see, and which drafts are thrown away. No network — the model is
 * a plain function here.
 */

import { describe, expect, it } from 'vitest'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import {
  draftTourAnswer,
  parseModelDraft,
  resolvePostTour,
  tourFactLines,
  validateTourDraft,
  type DraftModel,
} from '../comment-tour-draft'

function tour(over: Partial<PublishedTourFact> & { id: string; slug: string; name: string }): PublishedTourFact {
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
  id: 't-loop',
  slug: 'harbour-loop',
  name: 'Land Classic — Harbour Loop',
  durationText: '10 Days',
  displayPriceText: 'NZD $2,000 per person',
  highlights: ['Old town walk and a lake boat ride'],
  inclusions: ['English-speaking tour guide', 'Return international flights from Auckland'],
  exclusions: ['Tips (suggested NZD $10 per day per person)', 'Travel insurance'],
  singleSupplement: 'NZD $400',
  departures: [{ departOn: '2027-03-25', displayDate: '25 March 2027', status: 'open', priceTextOverride: null }],
})
const HIGH_A = tour({ id: 't-a', slug: 'highlights', name: 'North Classic — Highlights' })
const HIGH_B = tour({ id: 't-b', slug: 'highlights-b', name: 'South Classic — Highlights' })
const TODAY = '2026-11-10'

describe('resolvePostTour', () => {
  it('finds the tour by the short name in the post text', () => {
    expect(resolvePostTour({ text: 'Harbour Loop. 10 days from Auckland.', title: null }, [LOOP, HIGH_A], {})?.id).toBe('t-loop')
  })

  it('finds the tour by the ad headline', () => {
    expect(resolvePostTour({ text: 'Ten days by the water.', title: 'Harbour Loop | 25 March' }, [LOOP], {})?.id).toBe('t-loop')
  })

  it('finds the tour by an old name', () => {
    const aliases = { 't-loop': ['Land Classic — Harbour & Surroundings'] }
    expect(resolvePostTour({ text: 'Harbour & Surroundings', title: null }, [LOOP], aliases)?.id).toBe('t-loop')
  })

  it('a one-word short name never identifies a tour', () => {
    expect(resolvePostTour({ text: 'The highlights of this trip are many.', title: null }, [HIGH_A], {})).toBeNull()
  })

  it('a post that names no tour resolves to nothing', () => {
    expect(resolvePostTour({ text: 'See the warriors on an escorted tour.', title: 'See the warriors' }, [LOOP], {})).toBeNull()
  })

  it('the longest matched name wins, and a tie is nobody', () => {
    const short = tour({ id: 't-short', slug: 'loop', name: 'Land Classic — Harbour Loop Express' })
    expect(resolvePostTour({ text: 'Harbour Loop Express this spring', title: null }, [LOOP, short], {})?.id).toBe('t-short')
    const twin = tour({ id: 't-twin', slug: 'twin', name: 'Sea Classic — Harbour Loop' })
    expect(resolvePostTour({ text: 'Harbour Loop', title: null }, [LOOP, twin], {})).toBeNull()
  })

  it('a tour that is not on sale is not answered for', () => {
    expect(resolvePostTour({ text: 'Harbour Loop', title: null }, [{ ...LOOP, isActive: false }], {})).toBeNull()
    expect(resolvePostTour({ text: 'Harbour Loop', title: null }, [{ ...LOOP, soldOut: true }], {})).toBeNull()
  })

  it('needs a whole-phrase match', () => {
    expect(resolvePostTour({ text: 'Harbour Looping around', title: null }, [LOOP], {})).toBeNull()
  })
})

describe('tourFactLines', () => {
  it('carries no price, no single supplement and no line that mentions money', () => {
    const lines = tourFactLines(LOOP)
    const joined = lines.join('\n')
    expect(joined).not.toMatch(/\$|NZD/)
    expect(joined).not.toContain('2,000')
    expect(joined).not.toContain('400')
    expect(lines).toContain('Included: English-speaking tour guide')
    expect(lines).toContain('Departure date: 25 March 2027')
    expect(lines).toContain('Not included: Travel insurance')
  })
})

describe('validateTourDraft', () => {
  const GUIDE = ['Included: English-speaking tour guide']

  it('accepts a reply that only restates the cited fact', () => {
    expect(validateTourDraft('Hi Sam, yes, an English-speaking tour guide is included.', GUIDE, LOOP, TODAY)).toEqual({ ok: true })
  })

  it.each([
    ['Yes, and it is only $2,000.', 'mentions_money'],
    ['Yes, from NZD 2000.', 'mentions_money'],
    ['Yes, see https://example.test/tour', 'link_or_handle'],
    ['Yes, see example.co.nz for more', 'link_or_handle'],
    ['Yes, message @someone', 'link_or_handle'],
    ['', 'empty'],
  ])('rejects %j (%s)', (reply, reason) => {
    expect(validateTourDraft(reply, GUIDE, LOOP, TODAY)).toEqual({ ok: false, reason })
  })

  it('rejects a reply with no cited facts', () => {
    expect(validateTourDraft('Yes, a guide is included.', [], LOOP, TODAY)).toEqual({ ok: false, reason: 'no_evidence' })
  })

  it('rejects a number the cited facts do not contain', () => {
    expect(validateTourDraft('Yes, with 13 meals.', GUIDE, LOOP, TODAY)).toEqual({ ok: false, reason: 'ungrounded_number:13' })
  })

  it('rejects a duration that contradicts the catalog even when a cited line has the digits', () => {
    const verdict = validateTourDraft('It is a 12-day tour.', ['Highlight: 12 gardens'], LOOP, TODAY)
    expect(verdict.ok).toBe(false)
  })

  it('rejects an over-long reply', () => {
    expect(validateTourDraft('a'.repeat(501), GUIDE, LOOP, TODAY)).toEqual({ ok: false, reason: 'too_long' })
  })
})

describe('parseModelDraft', () => {
  it('reads JSON with surrounding prose', () => {
    expect(parseModelDraft('Here you go: {"answerable":true,"reply":" Yes. ","evidence":[2,"x",3.5]} done')).toEqual({
      answerable: true, reply: 'Yes.', evidence: [2],
    })
  })
  it('returns null for anything else', () => {
    expect(parseModelDraft('no json')).toBeNull()
    expect(parseModelDraft('{"reply":"x"}')).toBeNull()
  })
})

describe('draftTourAnswer', () => {
  const POST = { text: 'Harbour Loop. 10 days.', title: null }
  const base = { commentText: 'Are they guided?', authorFirstName: 'Sam', post: POST, tours: [LOOP], aliasesByTourId: {}, today: TODAY }
  const guideLine = tourFactLines(LOOP).indexOf('Included: English-speaking tour guide') + 1
  const answering = (reply: string, evidence: number[]): DraftModel => async () => JSON.stringify({ answerable: true, reply, evidence })

  it('returns the draft with the fact lines it rests on', async () => {
    const res = await draftTourAnswer(base, answering('Hi Sam, yes, an English-speaking tour guide is included.', [guideLine]))
    expect(res).toEqual({
      ok: true,
      reply: 'Hi Sam, yes, an English-speaking tour guide is included.',
      tourId: 't-loop',
      tourName: LOOP.name,
      evidence: ['Included: English-speaking tour guide'],
    })
  })

  it('shows the model the comment and the facts, never a price', async () => {
    let seen = ''
    await draftTourAnswer(base, async (_system, user) => { seen = user; return '{"answerable":false,"reply":null,"evidence":[]}' })
    expect(seen).toContain('Are they guided?')
    expect(seen).toContain('English-speaking tour guide')
    expect(seen).not.toMatch(/\$|NZD|2,000/)
  })

  it('never asks the model when the post names no tour', async () => {
    let called = false
    const res = await draftTourAnswer({ ...base, post: { text: 'A lovely day out.', title: null } }, async () => { called = true; return '' })
    expect(res).toEqual({ ok: false, skip: 'no_tour_in_post' })
    expect(called).toBe(false)
  })

  it('declines when the model says the facts do not answer it', async () => {
    expect(await draftTourAnswer(base, async () => '{"answerable":false,"reply":null,"evidence":[]}')).toEqual({ ok: false, skip: 'not_answerable' })
  })

  it('throws away a draft that quotes a price', async () => {
    const res = await draftTourAnswer(base, answering('Yes, and it is $2,000.', [guideLine]))
    expect(res).toMatchObject({ ok: false, skip: 'draft_rejected', detail: 'mentions_money' })
  })

  it('ignores evidence numbers that point at no fact line', async () => {
    const res = await draftTourAnswer(base, answering('Yes, a guide is included.', [99, 0, -1]))
    expect(res).toMatchObject({ ok: false, skip: 'draft_rejected', detail: 'no_evidence' })
  })

  it('reports unparseable output and model errors without throwing', async () => {
    expect(await draftTourAnswer(base, async () => 'sorry')).toEqual({ ok: false, skip: 'model_unparseable' })
    expect(await draftTourAnswer(base, async () => { throw new Error('down') })).toEqual({ ok: false, skip: 'model_error', detail: 'down' })
  })
})

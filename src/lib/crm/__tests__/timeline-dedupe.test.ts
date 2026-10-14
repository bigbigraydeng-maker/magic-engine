import { describe, expect, it } from 'vitest'
import { dropEmailTouchesDuplicatedByMessage, type DedupeEntry } from '../timeline-dedupe'

const touch = (over: Partial<DedupeEntry>): DedupeEntry => ({ kind: 'touch', at: '2026-10-14T05:41:13Z', channel: 'email', direction: 'outbound', summary: 'x', ...over })
const message = (over: Partial<DedupeEntry>): DedupeEntry => ({ kind: 'message', at: '2026-10-14T05:41:13Z', channel: 'email', direction: 'outbound', body: 'x', ...over })

describe('dropEmailTouchesDuplicatedByMessage', () => {
  it('drops the outbound email card whose summary is the start of the message body (the PM screenshot case)', () => {
    const t = touch({ summary: 'Hi there, email received. Will forward to our team to review. Thanks' })
    const m = message({ body: 'Hi there, email received. Will forward to our team to review.\n\nThanks' })
    const out = dropEmailTouchesDuplicatedByMessage([t, m])
    expect(out).toEqual([m])
  })

  it('keeps an inbound email card whose summary is the subject (it differs from the body)', () => {
    const t = touch({ direction: 'inbound', summary: 'Exclusive Group Dining Partnership | Steak Meals from $39 PP' })
    const m = message({ direction: 'inbound', body: "Dear Travel Team,\n\nWarm greetings from Tony's Lord Nelson Steakhouse" })
    expect(dropEmailTouchesDuplicatedByMessage([t, m])).toEqual([t, m])
  })

  it('also drops when the card summary is a truncated start of a longer body', () => {
    const t = touch({ summary: 'Thank you for your enquiry about the Best of China tour' })
    const m = message({ body: 'Thank you for your enquiry about the Best of China tour departing on 11 March 2027.\nKind regards' })
    expect(dropEmailTouchesDuplicatedByMessage([t, m])).toEqual([m])
  })

  it('keeps the card when the message is far away in time (two different emails with similar words)', () => {
    const t = touch({ summary: 'Hi there, email received. Will forward to our team' })
    const m = message({ at: '2026-10-14T09:00:00Z', body: 'Hi there, email received. Will forward to our team' })
    expect(dropEmailTouchesDuplicatedByMessage([t, m])).toEqual([t, m])
  })

  it('keeps the card when the direction differs', () => {
    const t = touch({ direction: 'inbound', summary: 'Hello this is a longer text' })
    const m = message({ direction: 'outbound', body: 'Hello this is a longer text' })
    expect(dropEmailTouchesDuplicatedByMessage([t, m])).toEqual([t, m])
  })

  it('never drops non-email touches, short summaries, or touches that carry an outcome', () => {
    const phone = touch({ channel: 'phone', summary: 'Spoke to him about the March tour' })
    const short = touch({ summary: 'ok' })
    const withOutcome = touch({ summary: 'Spoke to him about March', outcome: 'spoke' })
    const m = message({ body: 'Spoke to him about the March tour' })
    expect(dropEmailTouchesDuplicatedByMessage([phone, short, withOutcome, m])).toEqual([phone, short, withOutcome, m])
  })

  it('is a no-op when there are no messages', () => {
    const t = touch({ summary: 'Some summary text here' })
    expect(dropEmailTouchesDuplicatedByMessage([t])).toEqual([t])
  })
})

import { describe, expect, it } from 'vitest'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import { customerCameBack, takeoverView, toReengageTouchRow } from '../came-back'
import { applyTakeoverToDayList, demoteForTakeover, TAKEOVER_REASON } from '../day-list-filter'
import { SEGMENT_META, type SegmentResult } from '@/lib/crm/segments'

const SINCE = '2026-11-08T00:00:00Z'
const NOW = new Date('2026-11-10T03:00:00Z')

function touch(over: Partial<ReengageTouch>): ReengageTouch {
  return { id: '', source: null, channel: 'email', direction: 'inbound', occurredAt: '2026-11-09T00:00:00Z', ...over }
}

describe('customerCameBack', () => {
  const counts: Array<[string, Partial<ReengageTouch>]> = [
    ['Facebook form', { channel: 'meta_lead_form', source: 'meta_lead_form' }],
    ['website form', { channel: 'web_form', source: 'web_form' }],
    ['answered inbound call', { channel: 'phone', source: 'twilio', talkSeconds: 40 }],
    ['real reply email', { channel: 'email', source: 'outlook', subject: 'Re: brochure', body: 'Is March still open?' }],
    ['Messenger message', { channel: 'messenger', source: 'messenger', body: 'hi, about the tour' }],
  ]
  for (const [label, over] of counts) {
    it(`${label} after takeover-on counts`, () => {
      expect(customerCameBack([touch(over)], SINCE, NOW)).not.toBeNull()
    })
  }

  const ignored: Array<[string, Partial<ReengageTouch>]> = [
    ['outbound mail (ours)', { direction: 'outbound', channel: 'email', body: 'hello' }],
    ['Mailchimp activity', { channel: 'email', source: 'mailchimp', body: 'x' }],
    ['auto-reply', { channel: 'email', source: 'outlook', subject: 'Automatic reply: out of office', body: 'away' }],
    ['missed / short call', { channel: 'phone', source: 'twilio', talkSeconds: 5 }],
    ['empty Messenger message', { channel: 'messenger', source: 'messenger', body: '  ' }],
  ]
  for (const [label, over] of ignored) {
    it(`${label} does not count`, () => {
      expect(customerCameBack([touch(over)], SINCE, NOW)).toBeNull()
    })
  }

  it('only after the takeover-on time; and not from the far future', () => {
    const form = { channel: 'meta_lead_form', source: 'meta_lead_form' }
    expect(customerCameBack([touch({ ...form, occurredAt: '2026-11-07T23:00:00Z' })], SINCE, NOW)).toBeNull()
    expect(customerCameBack([touch({ ...form, occurredAt: SINCE })], SINCE, NOW)).toBeNull()
    expect(customerCameBack([touch({ ...form, occurredAt: '2026-12-01T00:00:00Z' })], SINCE, NOW)).toBeNull()
  })

  it('maps a touchpoint row (metadata.talk_seconds, metadata.subject)', () => {
    const t = toReengageTouchRow({
      channel: 'phone', direction: 'inbound', occurred_at: '2026-11-09T00:00:00Z', raw: null,
      metadata: { talk_seconds: 60 }, source: 'twilio',
    })
    expect(customerCameBack([t], SINCE, NOW)).toEqual({ kind: 'inbound_call', at: '2026-11-09T00:00:00Z' })
  })

  it('takeoverView: no "came back" when not in takeover', () => {
    const reply = touch({ source: 'outlook', body: 'yes please' })
    expect(takeoverView([], [reply], NOW).cameBack).toBeNull()
    const v = takeoverView([{ kind: 'ai_takeover_on', createdAt: SINCE, actor: 'a' }], [reply], NOW)
    expect(v.cameBack).not.toBeNull()
  })
})

describe('applyTakeoverToDayList (today route)', () => {
  const rows = [{ id: 'plain' }, { id: 'quiet' }, { id: 'back' }, { id: 'today' }]
  const dayStartMs = Date.parse('2026-11-09T11:00:00Z') // 10 Nov 00:00 Auckland
  const touches: Record<string, ReengageTouch[]> = {
    back: [touch({ source: 'outlook', body: 'Still have March?', occurredAt: '2026-11-09T20:00:00Z' })],
  }
  const opts = {
    takeoverSince: new Map([['quiet', SINCE], ['back', SINCE], ['today', '2026-11-09T22:00:00Z']]),
    touchesOf: (id: string) => touches[id] ?? [],
    dayStartMs,
    now: NOW,
  }

  it('hides a guest in takeover who has not come back; keeps the order of the rest', () => {
    const out = applyTakeoverToDayList(rows, opts)
    expect(out.map((r) => r.id)).toEqual(['plain', 'back', 'today'])
  })

  it('a guest who came back is shown with the tag, and is still marked as in takeover', () => {
    const back = applyTakeoverToDayList(rows, opts).find((r) => r.id === 'back')
    expect(back?.takeover).toMatchObject({ aiTakeover: true, cameBack: { kind: 'email' } })
  })

  it('takeover switched on today stays on today\'s list (our action today never drops anyone)', () => {
    const today = applyTakeoverToDayList(rows, opts).find((r) => r.id === 'today')
    expect(today?.takeover).toEqual({ aiTakeover: true, cameBack: null })
  })

  it('not in takeover: untouched', () => {
    expect(applyTakeoverToDayList(rows, opts)[0].takeover).toEqual({ aiTakeover: false, cameBack: null })
  })
})

describe('demoteForTakeover (two-list page)', () => {
  const seg = (segment: SegmentResult['segment']): SegmentResult =>
    ({ segment, ...SEGMENT_META[segment], reason: 'x', suggestedChannel: 'phone', dueAt: null, lastTouchAt: null } as SegmentResult)

  it('moves a "today" guest to "先放着" with the takeover reason', () => {
    expect(demoteForTakeover(seg('new_untouched'))).toMatchObject({ segment: 'nurture_future', reason: TAKEOVER_REASON })
  })
  it('never moves anyone up', () => {
    expect(demoteForTakeover(seg('excluded')).segment).toBe('excluded')
  })
})

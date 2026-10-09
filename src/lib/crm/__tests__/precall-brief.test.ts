import { describe, expect, it } from 'vitest'

import { TripDetailsSchema } from '@/lib/messenger/brief-schema'
import type { LeadTouch } from '../lead-followup-due'
import {
  assessLeadPromise,
  buildPrecallBrief,
  hasGuestReplied,
  listMissingTripItems,
  pickFormSubmittedAt,
  pickLatestBriefRow,
  toStringList,
  type PrecallBriefRow,
  type PrecallMessage,
} from '../precall-brief'
import { TOURISM_PRECALL_ASK_ITEMS } from '../precall-profiles'

const NOW = new Date('2026-10-14T00:00:00Z')
const NO_HOLIDAYS = new Set<string>()

const FORM_LINE =
  'Hello! I filled out your form and would like to know more about your business.'

function message(
  direction: 'inbound' | 'outbound',
  body: string | null,
  sentAt: string,
): PrecallMessage {
  return { direction, body, sentAt }
}

function touch(
  channel: string,
  direction: string | null,
  occurredAt: string,
  source: string | null = null,
  metadata: Record<string, unknown> | null = null,
): LeadTouch {
  return { channel, direction, occurredAt, source, metadata }
}

describe('toStringList', () => {
  it('keeps only non-empty trimmed strings', () => {
    expect(toStringList(['a', '', '  ', 42, null, ' b ', undefined])).toEqual(['a', 'b'])
  })

  it('returns an empty list for a non-array', () => {
    expect(toStringList('nope')).toEqual([])
    expect(toStringList(null)).toEqual([])
    expect(toStringList({ a: 1 })).toEqual([])
  })
})

describe('listMissingTripItems', () => {
  it('lists only the empty facts, in ask-item order', () => {
    const trip = TripDetailsSchema.parse({
      travel_window: null,
      party_size: 2,
      departure_city: null,
      first_time_to_china: false,
    })
    expect(listMissingTripItems(trip, TOURISM_PRECALL_ASK_ITEMS)).toEqual([
      '想什么时候出行',
      '从哪个城市出发',
    ])
  })
})

describe('buildPrecallBrief', () => {
  it('returns null for a null row', () => {
    expect(buildPrecallBrief(null, { phone: null, email: null }, TOURISM_PRECALL_ASK_ITEMS)).toBeNull()
  })

  it('prefers the CRM contact record and falls back to the brief contact', () => {
    const row: PrecallBriefRow = {
      summary: 'Test summary',
      intent_level: 'high',
      next_action: 'Call back',
      customer_needs: ['needs'],
      promises_made: ['promise'],
      risk_flags: ['risk'],
      trip: { tour_interest: 'Test Tour', party_size: 2 },
      contact: { phone: null, email: 'brief@example.com' },
      generated_at: '2026-10-01T00:00:00Z',
    }
    const brief = buildPrecallBrief(
      row,
      { phone: '021 000 0000', email: null },
      TOURISM_PRECALL_ASK_ITEMS,
    )
    expect(brief).not.toBeNull()
    expect(brief?.phone).toBe('021 000 0000')
    expect(brief?.email).toBe('brief@example.com')
    expect(brief?.trip.tour_interest).toBe('Test Tour')
    expect(brief?.trip.party_size).toBe(2)
  })

  it('survives a garbage trip and reports every ask item as missing', () => {
    const row: PrecallBriefRow = {
      summary: null,
      intent_level: null,
      next_action: null,
      customer_needs: null,
      promises_made: null,
      risk_flags: null,
      trip: 'not an object',
      contact: null,
      generated_at: null,
    }
    const brief = buildPrecallBrief(row, { phone: null, email: null }, TOURISM_PRECALL_ASK_ITEMS)
    expect(brief).not.toBeNull()
    expect(brief?.askMissing).toHaveLength(4)
    expect(brief?.phone).toBeNull()
    expect(brief?.email).toBeNull()
  })

  it('maps an unknown intent level to null', () => {
    const row: PrecallBriefRow = {
      summary: null,
      intent_level: 'weird',
      next_action: null,
      customer_needs: null,
      promises_made: null,
      risk_flags: null,
      trip: null,
      contact: null,
      generated_at: null,
    }
    const brief = buildPrecallBrief(row, { phone: null, email: null }, TOURISM_PRECALL_ASK_ITEMS)
    expect(brief?.intentLevel).toBeNull()
  })
})

describe('pickLatestBriefRow', () => {
  it('picks the newest generated_at', () => {
    const rows = [
      { generated_at: '2026-10-01T00:00:00Z', id: 'old' },
      { generated_at: '2026-10-09T00:00:00Z', id: 'new' },
      { generated_at: '2026-10-05T00:00:00Z', id: 'mid' },
    ]
    expect(pickLatestBriefRow(rows)?.id).toBe('new')
  })

  it('returns null for an empty list', () => {
    expect(pickLatestBriefRow([])).toBeNull()
  })
})

describe('pickFormSubmittedAt', () => {
  it('takes the latest inbound form opening line', () => {
    const messages = [
      message('inbound', FORM_LINE, '2026-10-05T01:00:00Z'),
      message('inbound', FORM_LINE, '2026-10-08T01:00:00Z'),
    ]
    expect(pickFormSubmittedAt(messages, [])?.toISOString()).toBe('2026-10-08T01:00:00.000Z')
  })

  it('ignores an outbound message with the same text', () => {
    const messages = [message('outbound', FORM_LINE, '2026-10-08T01:00:00Z')]
    expect(pickFormSubmittedAt(messages, [])).toBeNull()
  })

  it('lets a later meta_lead_form touch win', () => {
    const messages = [message('inbound', FORM_LINE, '2026-10-08T01:00:00Z')]
    const touches = [touch('meta_lead_form', 'inbound', '2026-10-09T00:00:00Z')]
    expect(pickFormSubmittedAt(messages, touches)?.toISOString()).toBe('2026-10-09T00:00:00.000Z')
  })

  it('returns null when there is no form', () => {
    expect(pickFormSubmittedAt([], [])).toBeNull()
  })
})

describe('hasGuestReplied', () => {
  const formAt = new Date('2026-10-05T01:00:00Z')

  it('is false when only the form line exists', () => {
    const messages = [message('inbound', FORM_LINE, '2026-10-05T01:00:00Z')]
    expect(hasGuestReplied(messages, formAt)).toBe(false)
  })

  it('is true when the guest wrote a real message later', () => {
    const messages = [
      message('inbound', FORM_LINE, '2026-10-05T01:00:00Z'),
      message('inbound', 'Hi, tell me more', '2026-10-05T02:00:00Z'),
    ]
    expect(hasGuestReplied(messages, formAt)).toBe(true)
  })

  it('is false when only an outbound message follows', () => {
    const messages = [
      message('inbound', FORM_LINE, '2026-10-05T01:00:00Z'),
      message('outbound', 'Hi, tell me more', '2026-10-05T02:00:00Z'),
    ]
    expect(hasGuestReplied(messages, formAt)).toBe(false)
  })

  it('is false for an empty or whitespace inbound body', () => {
    const messages = [
      message('inbound', FORM_LINE, '2026-10-05T01:00:00Z'),
      message('inbound', '   ', '2026-10-05T02:00:00Z'),
    ]
    expect(hasGuestReplied(messages, formAt)).toBe(false)
  })

  it('is false for an inbound message before the form', () => {
    const messages = [message('inbound', 'Hi, tell me more', '2026-10-05T00:00:00Z')]
    expect(hasGuestReplied(messages, formAt)).toBe(false)
  })
})

describe('assessLeadPromise', () => {
  const formMessages = [message('inbound', FORM_LINE, '2026-10-05T01:00:00Z')]

  it('reports a non-form lead', () => {
    const status = assessLeadPromise({
      messages: [],
      touches: [],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.isFormLead).toBe(false)
    expect(status.overdue).toBe(false)
    expect(status.guestReplied).toBeNull()
  })

  it('flags a form lead with no touches as overdue', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(true)
    expect(status.dueAt).toBe('2026-10-06T11:00:00.000Z')
    expect(status.guestReplied).toBe(false)
  })

  it('clears overdue after a human phone touch', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [touch('phone', 'outbound', '2026-10-05T03:00:00Z')],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(false)
  })

  it('stays overdue after a Messenger outbound touch', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [touch('messenger', 'outbound', '2026-10-05T03:00:00Z')],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(true)
  })

  it('stays overdue after an automated phone touch', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [touch('phone', 'outbound', '2026-10-05T03:00:00Z', null, { automated: true })],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(true)
  })

  it('stays overdue when the human touch predates the form', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [touch('phone', 'outbound', '2026-10-05T00:00:00Z')],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(true)
  })

  it('never flags a do-not-contact lead', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: true,
    })
    expect(status.overdue).toBe(false)
  })

  it('is not overdue one second before the due instant', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [],
      now: new Date('2026-10-06T10:59:59Z'),
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(false)
  })

  it('is overdue exactly at the due instant', () => {
    const status = assessLeadPromise({
      messages: formMessages,
      touches: [],
      now: new Date('2026-10-06T11:00:00Z'),
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(true)
  })

  it('reports a guest reply independently of overdue', () => {
    const status = assessLeadPromise({
      messages: [
        message('inbound', FORM_LINE, '2026-10-05T01:00:00Z'),
        message('inbound', 'Hi, tell me more', '2026-10-05T02:00:00Z'),
      ],
      touches: [],
      now: NOW,
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.guestReplied).toBe(true)
    expect(status.overdue).toBe(true)
  })

  it('is not overdue over a weekend', () => {
    const status = assessLeadPromise({
      messages: [message('inbound', FORM_LINE, '2026-10-09T01:00:00Z')],
      touches: [],
      now: new Date('2026-10-11T00:00:00Z'),
      holidays: NO_HOLIDAYS,
      doNotContact: false,
    })
    expect(status.overdue).toBe(false)
  })

  it('is not overdue when the next business day is a holiday', () => {
    const status = assessLeadPromise({
      messages: [message('inbound', FORM_LINE, '2026-10-09T01:00:00Z')],
      touches: [],
      now: new Date('2026-10-13T00:00:00Z'),
      holidays: new Set(['2026-10-12']),
      doNotContact: false,
    })
    expect(status.overdue).toBe(false)
    expect(status.dueAt).toBe('2026-10-13T11:00:00.000Z')
  })
})

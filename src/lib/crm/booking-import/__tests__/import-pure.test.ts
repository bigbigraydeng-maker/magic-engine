// Vitest coverage for the pure booking import preview helpers.
// Exercises parsing, planning, summarising, hashing, masking, and rendering.
// No IO, no network, no supabase; everything is in-memory.

import { describe, expect, it } from 'vitest'

import { guestLabel, maskEmail, maskPhone, renderPreview } from '../mask'
import { normaliseInvoice, parseRows } from '../parse'
import { buildPlan, planHash, summarise } from '../plan'
import type {
  ImportRow,
  PlanItem,
  RowFacts,
} from '../types'

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invoice: '84030',
    originKind: 'company_confirmed',
    partySize: 2,
    tourKey: 'essentials',
    departOn: '2025-06-01',
    bookedOn: '2025-05-01',
    phone: '13800000000',
    email: 'Guest@Example.COM',
    depositPaid: false,
    paidOn: null,
    ...overrides,
  }
}

function makeRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    index: 0,
    invoice: '84030',
    originKind: 'company_confirmed',
    partySize: 2,
    tourKey: 'essentials',
    departOn: '2025-06-01',
    bookedOn: '2025-05-01',
    phone: '13800000000',
    email: 'guest@example.com',
    depositPaid: false,
    paidOn: null,
    ...overrides,
  }
}

function makeFacts(overrides: Partial<RowFacts> = {}): RowFacts {
  return {
    contact: { kind: 'one', contactId: 'c1' },
    departure: { departureId: 'd1', tourId: 't1', status: 'open' },
    departureAmbiguous: false,
    orderWithInvoice: null,
    orderForGuestAndDeparture: null,
    ...overrides,
  }
}

describe('normaliseInvoice', () => {
  it('trims, upper-cases, and strips whitespace and hyphens', () => {
    expect(normaliseInvoice(' 84-030 ')).toBe('84030')
    expect(normaliseInvoice('ab-12 3')).toBe('AB123')
  })
})

describe('parseRows', () => {
  it('rejects a non-array input', () => {
    expect(parseRows({})).toEqual([{ ok: false, index: -1, code: 'not_an_array' }])
  })

  it('accepts a valid row and lower-cases the email', () => {
    const out = parseRows([validRaw()])
    expect(out).toHaveLength(1)
    const first = out[0]
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.row.invoice).toBe('84030')
      expect(first.row.email).toBe('guest@example.com')
    }
  })

  it('reports bad_invoice', () => {
    expect(parseRows([validRaw({ invoice: 'abc' })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'bad_invoice',
    })
  })

  it('reports bad_origin', () => {
    expect(parseRows([validRaw({ originKind: 'nope' })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'bad_origin',
    })
  })

  it('reports bad_party_size', () => {
    expect(parseRows([validRaw({ partySize: 0 })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'bad_party_size',
    })
  })

  it('reports bad_tour', () => {
    expect(parseRows([validRaw({ tourKey: '  ' })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'bad_tour',
    })
  })

  it('reports bad_date', () => {
    expect(parseRows([validRaw({ departOn: '2025-13-01' })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'bad_date',
    })
  })

  it('reports missing_contact', () => {
    expect(parseRows([validRaw({ phone: null, email: null })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'missing_contact',
    })
  })

  it('requires paidOn when depositPaid is true', () => {
    expect(parseRows([validRaw({ depositPaid: true, paidOn: null })])[0]).toEqual({
      ok: false,
      index: 0,
      code: 'missing_paid_on',
    })
    const ok = parseRows([validRaw({ depositPaid: true, paidOn: '2025-05-02' })])[0]
    expect(ok.ok).toBe(true)
  })
})

describe('buildPlan', () => {
  it('marks a clean row as ready', () => {
    const items = buildPlan([makeRow()], [makeFacts()])
    expect(items[0].status).toBe('ready')
    expect(items[0].reasons).toEqual([])
    expect(items[0].contactId).toBe('c1')
    expect(items[0].departureId).toBe('d1')
  })

  it('flags duplicate_in_input', () => {
    const rows = [makeRow({ index: 0 }), makeRow({ index: 1 })]
    const items = buildPlan(rows, [makeFacts(), makeFacts()])
    expect(items[1].reasons).toContain('duplicate_in_input')
    expect(items[1].status).toBe('needs_human')
  })

  it('flags contact_not_found and contact_ambiguous', () => {
    const none = buildPlan([makeRow()], [makeFacts({ contact: { kind: 'none' } })])
    expect(none[0].reasons).toContain('contact_not_found')
    const many = buildPlan(
      [makeRow()],
      [makeFacts({ contact: { kind: 'many', contactIds: ['a', 'b'] } })],
    )
    expect(many[0].reasons).toContain('contact_ambiguous')
  })

  it('flags departure_not_found', () => {
    const items = buildPlan([makeRow()], [makeFacts({ departure: null })])
    expect(items[0].reasons).toContain('departure_not_found')
    expect(items[0].departureId).toBeNull()
  })

  it('skips already imported when same contact and departure', () => {
    const facts = makeFacts({
      orderWithInvoice: {
        bookingId: 'b1',
        contactId: 'c1',
        departureId: 'd1',
        status: 'active',
        evidenceRef: null,
        tourId: 't1',
        partySize: 2,
        originKind: 'company_confirmed',
      },
    })
    const items = buildPlan([makeRow()], [facts])
    expect(items[0].status).toBe('skip_already_imported')
    expect(items[0].reasons).toEqual(['already_imported'])
  })

  it('flags invoice_used_elsewhere when contact differs', () => {
    const facts = makeFacts({
      orderWithInvoice: {
        bookingId: 'b1',
        contactId: 'other',
        departureId: 'd1',
        status: 'active',
        evidenceRef: null,
        tourId: 't1',
        partySize: 2,
        originKind: 'company_confirmed',
      },
    })
    const items = buildPlan([makeRow()], [facts])
    expect(items[0].reasons).toContain('invoice_used_elsewhere')
    expect(items[0].status).toBe('needs_human')
  })

  it('flags order_exists_for_guest', () => {
    const facts = makeFacts({
      orderForGuestAndDeparture: {
        bookingId: 'b2',
        contactId: 'c1',
        departureId: 'd1',
        status: 'active',
        evidenceRef: null,
        tourId: 't1',
        partySize: 2,
        originKind: 'company_confirmed',
      },
    })
    const items = buildPlan([makeRow()], [facts])
    expect(items[0].reasons).toContain('order_exists_for_guest')
  })

  it('collects combined reasons', () => {
    const facts = makeFacts({
      contact: { kind: 'none' },
      departure: null,
      orderWithInvoice: {
        bookingId: 'b1',
        contactId: 'c1',
        departureId: 'd1',
        status: 'active',
        evidenceRef: null,
        tourId: 't1',
        partySize: 2,
        originKind: 'company_confirmed',
      },
    })
    const items = buildPlan([makeRow()], [facts])
    expect(items[0].reasons).toContain('contact_not_found')
    expect(items[0].reasons).toContain('departure_not_found')
    expect(items[0].reasons).toContain('invoice_used_elsewhere')
    expect(items[0].status).toBe('needs_human')
  })

  it('throws on length mismatch', () => {
    expect(() => buildPlan([makeRow()], [])).toThrow('rows and facts length mismatch')
  })

  it('does not mutate frozen inputs', () => {
    const row = Object.freeze(makeRow())
    const facts = Object.freeze(makeFacts())
    const items = buildPlan([row], [facts])
    expect(items[0].invoice).toBe('84030')
    expect(row.invoice).toBe('84030')
  })
})

describe('summarise', () => {
  it('counts statuses, people, deposits, reasons, and departures', () => {
    const items: PlanItem[] = [
      {
        index: 0,
        invoice: '84030',
        tourKey: 'essentials',
        departOn: '2025-06-01',
        status: 'ready',
        reasons: [],
        contactId: 'c1',
        tourId: 't1',
        departureId: 'd1',
        partySize: 3,
        originKind: 'company_confirmed',
        bookedOn: '2025-05-01',
        depositPaid: true,
        paidOn: '2025-05-02',
      },
      {
        index: 1,
        invoice: '84031',
        tourKey: 'essentials',
        departOn: '2025-06-01',
        status: 'skip_already_imported',
        reasons: ['already_imported'],
        contactId: 'c1',
        tourId: 't1',
        departureId: 'd1',
        partySize: 2,
        originKind: 'company_confirmed',
        bookedOn: '2025-05-01',
        depositPaid: false,
        paidOn: null,
      },
      {
        index: 2,
        invoice: '84032',
        tourKey: 'essentials',
        departOn: '2025-06-01',
        status: 'needs_human',
        reasons: ['contact_not_found'],
        contactId: null,
        tourId: null,
        departureId: null,
        partySize: 1,
        originKind: 'staff_entered',
        bookedOn: '2025-05-01',
        depositPaid: false,
        paidOn: null,
      },
    ]
    const summary = summarise(items)
    expect(summary.total).toBe(3)
    expect(summary.ready).toBe(1)
    expect(summary.skipAlreadyImported).toBe(1)
    expect(summary.needsHuman).toBe(1)
    expect(summary.readyPeople).toBe(3)
    expect(summary.depositsToMarkPaid).toBe(1)
    expect(summary.reasonCounts.already_imported).toBe(1)
    expect(summary.reasonCounts.contact_not_found).toBe(1)
    expect(summary.peopleByDeparture.d1).toBe(3)
  })
})

describe('planHash', () => {
  it('is stable for equal input and changes when an item changes', async () => {
    const items = buildPlan([makeRow()], [makeFacts()])
    const a = await planHash(items)
    const b = await planHash(items)
    expect(a).toBe(b)
    const changed = buildPlan([makeRow({ partySize: 5 })], [makeFacts()])
    const c = await planHash(changed)
    expect(c).not.toBe(a)
  })
})

describe('guestLabel', () => {
  it('produces spreadsheet-style labels', () => {
    expect(guestLabel(0)).toBe('客人 A')
    expect(guestLabel(25)).toBe('客人 Z')
    expect(guestLabel(26)).toBe('客人 AA')
    expect(guestLabel(27)).toBe('客人 AB')
  })
})

describe('maskPhone', () => {
  it('masks digits and handles edge cases', () => {
    expect(maskPhone(null)).toBe('-')
    expect(maskPhone('')).toBe('-')
    expect(maskPhone('12345')).toBe('***')
    expect(maskPhone('13800000000')).toBe('138***00')
  })
})

describe('maskEmail', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmail(null)).toBe('-')
    expect(maskEmail('guest@example.com')).toBe('g***@example.com')
  })
})

describe('renderPreview', () => {
  it('never leaks phone digits or emails and contains the header', () => {
    const items = buildPlan([makeRow()], [makeFacts()])
    const summary = summarise(items)
    const lines = renderPreview(items, summary)
    const joined = lines.join('\n')
    expect(joined).toContain('预览（只读，没有写入任何东西）')
    expect(joined).not.toContain('13800000000')
    expect(joined).not.toContain('guest@example.com')
    expect(joined).toContain('客人 A')
  })
})

describe('buildPlan: the guest order is the invoice order (two separate objects, same booking id)', () => {
  it('is already_imported, not order_exists_for_guest', () => {
    const row = {
      index: 0, invoice: '84030', originKind: 'company_confirmed' as const, partySize: 2, tourKey: 'essentials',
      departOn: '2029-03-11', bookedOn: '2029-01-05', phone: '+6421111111', email: null, depositPaid: false, paidOn: null,
    }
    const existing = { bookingId: 'b1', contactId: 'c1', departureId: 'd1', tourId: 't1', status: 'active' as const, evidenceRef: '84030', partySize: 2, originKind: 'company_confirmed' }
    const facts = {
      contact: { kind: 'one' as const, contactId: 'c1' },
      departure: { departureId: 'd1', tourId: 't1', status: 'open' },
      departureAmbiguous: false,
      orderWithInvoice: existing,
      orderForGuestAndDeparture: { ...existing },
    }
    const [item] = buildPlan([row], [facts])
    expect(item.status).toBe('skip_already_imported')
    expect(item.reasons).toEqual(['already_imported'])
  })
})

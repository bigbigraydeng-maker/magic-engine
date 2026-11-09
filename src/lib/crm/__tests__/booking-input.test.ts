/**
 * Tests for the pure CRM booking request-body parsers.
 *
 * These cover the security contract (forbidden field detection) and the
 * field-level validation of every route body shape.
 */

import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_BODY_FIELDS,
  findForbiddenField,
  normaliseBookingMemberEmail,
  parseCancelBody,
  parseCreateBody,
  parseExpectedOnly,
  parseKind,
  parseLimitParam,
  parseNudgeBody,
  parseOverrideBody,
  parsePaidBody,
  parsePatchBody,
} from '../booking-input'
import { CONTACT_A1, DEP_A1, TOUR_A1 } from './booking-fixtures'

const TOKEN = '2026-10-01T00:00:00.000000+00:00'

describe('findForbiddenField', () => {
  const names = [
    'paid_source',
    'source',
    'actor',
    'actor_email',
    'p_server_detector',
    'client_id',
    'paid_evidence_ref',
  ] as const

  it.each(names)('finds %s at the top level', (name) => {
    expect(findForbiddenField({ expectedUpdatedAt: TOKEN, [name]: 'x' })).toBe(name)
  })

  it.each(names)('finds %s nested inside patch', (name) => {
    expect(findForbiddenField({ patch: { [name]: 1 } })).toBe(name)
  })

  it.each(names)('finds %s nested inside an array', (name) => {
    expect(findForbiddenField({ items: [{ [name]: 1 }] })).toBe(name)
  })

  it.each(['paidSource', 'actorEmail', 'clientId', 'serverDetector', 'paidEvidenceRef', 'SOURCE'])(
    'finds the normalised variant %s',
    (name) => {
      expect(findForbiddenField({ [name]: 'x' })).toBe(name)
    },
  )

  it('returns null for a clean body whose value contains the word source', () => {
    expect(findForbiddenField({ note: 'source of the problem', contactId: 'x' })).toBeNull()
  })

  it('returns null for a clean body with paidOn', () => {
    expect(findForbiddenField({ paidOn: '2026-10-01' })).toBeNull()
  })

  it.each(['text', null, 42])('returns null for a non-object %s', (value) => {
    expect(findForbiddenField(value)).toBeNull()
  })
})

describe('FORBIDDEN_BODY_FIELDS', () => {
  it('equals exactly the seven forbidden names in order', () => {
    expect(FORBIDDEN_BODY_FIELDS).toEqual([
      'paid_source',
      'source',
      'actor',
      'actor_email',
      'p_server_detector',
      'client_id',
      'paid_evidence_ref',
    ])
  })
})

describe('parseExpectedOnly', () => {
  it('passes a valid token through unchanged', () => {
    const token = '2026-10-01T00:00:00.123456+00:00'
    const result = parseExpectedOnly({ expectedUpdatedAt: token })
    expect(result).toEqual({ ok: true, value: { expectedUpdatedAt: token } })
  })

  it.each([
    {},
    { expectedUpdatedAt: '' },
    { expectedUpdatedAt: 'not-a-date' },
    { expectedUpdatedAt: 'x'.repeat(100) },
    { expectedUpdatedAt: 42 },
  ])('rejects an invalid token %o', (body) => {
    expect(parseExpectedOnly(body)).toEqual({ ok: false, error: 'invalid_expected_updated_at' })
  })

  it('rejects an extra key', () => {
    expect(parseExpectedOnly({ expectedUpdatedAt: TOKEN, foo: 1 })).toEqual({
      ok: false,
      error: 'unknown_field:foo',
    })
  })
})

describe('expectedUpdatedAt strict ISO-8601 validation', () => {
  // Tokens Date.parse accepts but which are not ISO-8601 with a timezone.
  const NON_ISO_TOKENS = [
    'Oct 1 2026',
    '2026-10-01',
    '2026-10-01T00:00:00',
    '10/01/2026',
    '2026-10-01 00:00:00+00:00',
    'Thu, 01 Oct 2026 00:00:00 GMT',
    '1759276800000',
  ] as const

  const ISO_TOKENS = [
    '2026-10-01T00:00:00Z',
    '2026-10-01T00:00:00.123456+00:00',
    '2026-10-01T12:00:00+13:00',
    '2026-10-01T00:00:00.5-05:30',
  ] as const

  it.each(NON_ISO_TOKENS)('parseExpectedOnly rejects %s', (token) => {
    expect(parseExpectedOnly({ expectedUpdatedAt: token })).toEqual({
      ok: false,
      error: 'invalid_expected_updated_at',
    })
  })

  it.each(ISO_TOKENS)('parseExpectedOnly accepts %s unchanged', (token) => {
    expect(parseExpectedOnly({ expectedUpdatedAt: token })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: token },
    })
  })

  it.each(NON_ISO_TOKENS)('parsePaidBody rejects %s', (token) => {
    expect(parsePaidBody({ expectedUpdatedAt: token })).toEqual({
      ok: false,
      error: 'invalid_expected_updated_at',
    })
  })

  it.each(ISO_TOKENS)('parsePaidBody accepts %s unchanged', (token) => {
    expect(parsePaidBody({ expectedUpdatedAt: token })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: token, paidOn: null },
    })
  })

  it.each(NON_ISO_TOKENS)('parsePatchBody rejects %s', (token) => {
    expect(parsePatchBody({ expectedUpdatedAt: token, patch: { note: 'x' } })).toEqual({
      ok: false,
      error: 'invalid_expected_updated_at',
    })
  })

  it.each(NON_ISO_TOKENS)('parseOverrideBody rejects %s', (token) => {
    expect(parseOverrideBody({ expectedUpdatedAt: token, dueOn: null })).toEqual({
      ok: false,
      error: 'invalid_expected_updated_at',
    })
  })

  it.each(NON_ISO_TOKENS)('parseNudgeBody rejects %s', (token) => {
    expect(parseNudgeBody({ expectedUpdatedAt: token, mode: 'quiet' })).toEqual({
      ok: false,
      error: 'invalid_expected_updated_at',
    })
  })

  it.each(NON_ISO_TOKENS)('parseCancelBody rejects %s', (token) => {
    expect(parseCancelBody({ expectedUpdatedAt: token, cancelNote: 'gone' })).toEqual({
      ok: false,
      error: 'invalid_expected_updated_at',
    })
  })
})

describe('parseCreateBody', () => {
  it('parses a full valid body and trims the note', () => {
    const result = parseCreateBody({
      contactId: CONTACT_A1,
      tourId: TOUR_A1,
      departureId: DEP_A1,
      bookedOn: '2026-10-12',
      partySize: 2,
      isCruise: true,
      note: '  Li couple  ',
    })
    expect(result).toEqual({
      ok: true,
      value: {
        contactId: CONTACT_A1,
        tourId: TOUR_A1,
        departureId: DEP_A1,
        bookedOn: '2026-10-12',
        partySize: 2,
        isCruise: true,
        note: 'Li couple',
      },
    })
  })

  it('parses a minimal body with defaults', () => {
    const result = parseCreateBody({ contactId: CONTACT_A1, tourId: TOUR_A1 })
    expect(result).toEqual({
      ok: true,
      value: {
        contactId: CONTACT_A1,
        tourId: TOUR_A1,
        departureId: null,
        bookedOn: null,
        partySize: null,
        isCruise: false,
        note: null,
      },
    })
  })

  it('rejects a note containing NUL', () => {
    expect(parseCreateBody({ contactId: CONTACT_A1, tourId: TOUR_A1, note: 'a\u0000b' })).toEqual({
      ok: false,
      error: 'invalid_note',
    })
  })

  it('rejects a note containing a bell character', () => {
    expect(parseCreateBody({ contactId: CONTACT_A1, tourId: TOUR_A1, note: 'a\u0007b' })).toEqual({
      ok: false,
      error: 'invalid_note',
    })
  })

  it('rejects a note containing a carriage return', () => {
    expect(parseCreateBody({ contactId: CONTACT_A1, tourId: TOUR_A1, note: 'a\rb' })).toEqual({
      ok: false,
      error: 'invalid_note',
    })
  })

  it('accepts a note with a tab and a newline, kept verbatim apart from trim', () => {
    expect(
      parseCreateBody({ contactId: CONTACT_A1, tourId: TOUR_A1, note: '  line1\n\tline2  ' }),
    ).toEqual({
      ok: true,
      value: {
        contactId: CONTACT_A1,
        tourId: TOUR_A1,
        departureId: null,
        bookedOn: null,
        partySize: null,
        isCruise: false,
        note: 'line1\n\tline2',
      },
    })
  })

  it.each([
    [{ contactId: 'x', tourId: TOUR_A1 }, 'invalid_contact_id'],
    [{ contactId: CONTACT_A1, tourId: 'x' }, 'invalid_tour_id'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, departureId: 'x' }, 'invalid_departure_id'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, bookedOn: '2026-02-30' }, 'invalid_booked_on'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, partySize: 0 }, 'invalid_party_size'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, partySize: 61 }, 'invalid_party_size'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, partySize: 1.5 }, 'invalid_party_size'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, isCruise: 'yes' }, 'invalid_is_cruise'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, note: 'x'.repeat(501) }, 'invalid_note'],
    [{ contactId: CONTACT_A1, tourId: TOUR_A1, foo: 1 }, 'unknown_field:foo'],
  ])('rejects %o with %s', (body, error) => {
    expect(parseCreateBody(body)).toEqual({ ok: false, error })
  })
})

describe('parsePatchBody', () => {
  it('maps every patch field to its database column', () => {
    const result = parsePatchBody({
      expectedUpdatedAt: TOKEN,
      patch: {
        tourId: TOUR_A1,
        departureId: null,
        bookedOn: '2026-10-13',
        partySize: 3,
        isCruise: false,
        note: '',
      },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        expectedUpdatedAt: TOKEN,
        patch: {
          tour_id: TOUR_A1,
          departure_id: null,
          booked_on: '2026-10-13',
          party_size: 3,
          is_cruise: false,
          note: null,
        },
      },
    })
  })

  it.each([{ expectedUpdatedAt: TOKEN, patch: {} }, { expectedUpdatedAt: TOKEN }])(
    'rejects an empty patch %o',
    (body) => {
      expect(parsePatchBody(body)).toEqual({ ok: false, error: 'empty_patch' })
    },
  )

  it.each([{ clientId: 'x' }, { status: 'cancelled' }])('rejects unknown patch key %o', (patch) => {
    const key = Object.keys(patch)[0]
    expect(parsePatchBody({ expectedUpdatedAt: TOKEN, patch })).toEqual({
      ok: false,
      error: `unknown_field:${key}`,
    })
  })

  it('rejects a null tourId', () => {
    expect(parsePatchBody({ expectedUpdatedAt: TOKEN, patch: { tourId: null } })).toEqual({
      ok: false,
      error: 'invalid_tour_id',
    })
  })

  it('rejects a null bookedOn', () => {
    expect(parsePatchBody({ expectedUpdatedAt: TOKEN, patch: { bookedOn: null } })).toEqual({
      ok: false,
      error: 'invalid_booked_on',
    })
  })

  it('rejects a note containing NUL', () => {
    expect(parsePatchBody({ expectedUpdatedAt: TOKEN, patch: { note: 'a\u0000b' } })).toEqual({
      ok: false,
      error: 'invalid_note',
    })
  })

  it('accepts a note with a tab and a newline, kept verbatim apart from trim', () => {
    expect(parsePatchBody({ expectedUpdatedAt: TOKEN, patch: { note: '  line1\n\tline2  ' } })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, patch: { note: 'line1\n\tline2' } },
    })
  })
})

describe('parsePaidBody', () => {
  it('accepts an omitted paidOn as null', () => {
    expect(parsePaidBody({ expectedUpdatedAt: TOKEN })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, paidOn: null },
    })
  })

  it('accepts an ISO paidOn', () => {
    expect(parsePaidBody({ expectedUpdatedAt: TOKEN, paidOn: '2026-10-08' })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, paidOn: '2026-10-08' },
    })
  })

  it('rejects a non-ISO paidOn', () => {
    expect(parsePaidBody({ expectedUpdatedAt: TOKEN, paidOn: '08/10/2026' })).toEqual({
      ok: false,
      error: 'invalid_paid_on',
    })
  })
})

describe('parseOverrideBody', () => {
  it('rejects a missing dueOn', () => {
    expect(parseOverrideBody({ expectedUpdatedAt: TOKEN })).toEqual({
      ok: false,
      error: 'invalid_due_on',
    })
  })

  it('accepts an explicit null dueOn to clear', () => {
    expect(parseOverrideBody({ expectedUpdatedAt: TOKEN, dueOn: null })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, dueOn: null },
    })
  })

  it('accepts an ISO dueOn', () => {
    expect(parseOverrideBody({ expectedUpdatedAt: TOKEN, dueOn: '2026-12-20' })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, dueOn: '2026-12-20' },
    })
  })

  it('rejects a non-ISO dueOn', () => {
    expect(parseOverrideBody({ expectedUpdatedAt: TOKEN, dueOn: 'tomorrow' })).toEqual({
      ok: false,
      error: 'invalid_due_on',
    })
  })
})

describe('parseNudgeBody', () => {
  it.each([3, 7, 14])('accepts snooze with %i days', (days) => {
    expect(parseNudgeBody({ expectedUpdatedAt: TOKEN, mode: 'snooze', days })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, mode: 'snooze', days },
    })
  })

  it.each([{ mode: 'snooze', days: 5 }, { mode: 'snooze' }])(
    'rejects snooze with invalid days %o',
    (body) => {
      expect(parseNudgeBody({ expectedUpdatedAt: TOKEN, ...body })).toEqual({
        ok: false,
        error: 'invalid_days',
      })
    },
  )

  it.each(['nudged_today', 'quiet'] as const)('accepts %s with null days', (mode) => {
    expect(parseNudgeBody({ expectedUpdatedAt: TOKEN, mode })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, mode, days: null },
    })
  })

  it.each(['nudged_today', 'quiet'] as const)('rejects %s with numeric days', (mode) => {
    expect(parseNudgeBody({ expectedUpdatedAt: TOKEN, mode, days: 3 })).toEqual({
      ok: false,
      error: 'invalid_days',
    })
  })

  it('rejects an unknown mode', () => {
    expect(parseNudgeBody({ expectedUpdatedAt: TOKEN, mode: 'sleep' })).toEqual({
      ok: false,
      error: 'invalid_mode',
    })
  })
})

describe('parseCancelBody', () => {
  it('trims the cancel note', () => {
    expect(parseCancelBody({ expectedUpdatedAt: TOKEN, cancelNote: '  gone  ' })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, cancelNote: 'gone' },
    })
  })

  it.each(['', '   ', 'x'.repeat(201), 42])('rejects an invalid cancel note %o', (cancelNote) => {
    expect(parseCancelBody({ expectedUpdatedAt: TOKEN, cancelNote })).toEqual({
      ok: false,
      error: 'invalid_cancel_note',
    })
  })

  it('rejects a cancel note containing NUL', () => {
    expect(parseCancelBody({ expectedUpdatedAt: TOKEN, cancelNote: 'a\u0000b' })).toEqual({
      ok: false,
      error: 'invalid_cancel_note',
    })
  })

  it('accepts a cancel note containing a newline', () => {
    expect(parseCancelBody({ expectedUpdatedAt: TOKEN, cancelNote: 'line1\nline2' })).toEqual({
      ok: true,
      value: { expectedUpdatedAt: TOKEN, cancelNote: 'line1\nline2' },
    })
  })
})

describe('parseKind', () => {
  it.each(['deposit', 'balance'] as const)('accepts %s', (kind) => {
    expect(parseKind(kind)).toBe(kind)
  })

  it.each(['Deposit', '', null, 3])('rejects %o', (value) => {
    expect(parseKind(value)).toBeNull()
  })
})

describe('parseLimitParam', () => {
  it('parses a numeric string', () => {
    expect(parseLimitParam('10')).toBe(10)
  })

  it.each([null, 'abc', '-1', '12345', '1.5'])('rejects %o', (value) => {
    expect(parseLimitParam(value)).toBeNull()
  })
})

describe('normaliseBookingMemberEmail', () => {
  it('trims and lower-cases a valid email', () => {
    expect(normaliseBookingMemberEmail('  INFO@CTS.test  ')).toBe('info@cts.test')
  })

  it.each(['nope', '', 'a@b', `${'a'.repeat(195)}@b.test`, 5, null])(
    'rejects %o',
    (value) => {
      expect(normaliseBookingMemberEmail(value)).toBeNull()
    },
  )

  it.each(['a\u0000@x.test', 'a@x.test\u0000', 'a\t@x.test', 'a@x.\ntest', '\u007fa@x.test'])(
    'rejects the control-character email %o',
    (value) => {
      expect(normaliseBookingMemberEmail(value)).toBeNull()
    },
  )
})

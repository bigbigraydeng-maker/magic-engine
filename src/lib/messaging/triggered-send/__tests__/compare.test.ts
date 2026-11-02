import { describe, it, expect } from 'vitest'
import {
  judgeLead,
  compareShadowRows,
  isConsistentDay,
  consecutiveConsistentDays,
  type CompareDay,
  type ShadowRowForCompare,
} from '../compare'

function row(
  contactId: string,
  reasonCode: string | null,
  annotations: Record<string, unknown>,
): ShadowRowForCompare {
  return { contactId, status: 'shadow', reasonCode, annotations }
}

function day(overrides: Partial<CompareDay> & { leadLocalDay: string }): CompareDay {
  return {
    total: 1,
    wouldSend: 0,
    salesSkipped: 0,
    legacyWelcomed: 0,
    agree: 1,
    explained: 0,
    unexplained: 0,
    unavailable: 0,
    unexplainedContactIds: [],
    ...overrides,
  }
}

describe('judgeLead', () => {
  it('returns agree when legacy_welcomed matches would_send true', () => {
    expect(
      judgeLead(row('c1', null, { would_send: true, legacy_welcomed: true })),
    ).toBe('agree')
  })

  it('returns agree when both are false', () => {
    expect(
      judgeLead(row('c1', null, { would_send: false, legacy_welcomed: false })),
    ).toBe('agree')
  })

  it('returns agree when sales_email_exists and legacy_welcomed true', () => {
    expect(
      judgeLead(row('c1', 'sales_email_exists', { would_send: false, legacy_welcomed: true })),
    ).toBe('agree')
  })

  it('returns agree when both false with reason dnc', () => {
    expect(
      judgeLead(row('c1', 'dnc', { would_send: false, legacy_welcomed: false })),
    ).toBe('agree')
  })

  it('returns unexplained when sales_email_exists and legacy_welcomed false', () => {
    expect(
      judgeLead(row('c1', 'sales_email_exists', { would_send: false, legacy_welcomed: false })),
    ).toBe('unexplained')
  })

  it('returns unexplained when would_send true and legacy_welcomed false', () => {
    expect(
      judgeLead(row('c1', null, { would_send: true, legacy_welcomed: false })),
    ).toBe('unexplained')
  })

  it('returns unexplained for an unknown reason with legacy true and covers false', () => {
    expect(
      judgeLead(row('c1', 'some_unknown_reason', { would_send: false, legacy_welcomed: true })),
    ).toBe('unexplained')
  })

  it('returns unexplained for a null reason with legacy true and covers false', () => {
    expect(
      judgeLead(row('c1', null, { would_send: false, legacy_welcomed: true })),
    ).toBe('unexplained')
  })

  it.each([
    'bad_email',
    'system_address',
    'not_in_allowlist',
    'dnc',
    'mailchimp_suppressed',
    'no_consent_basis',
    'frequency_full',
  ])('returns explained for reason %s when legacy true and covers false', (reason) => {
    expect(
      judgeLead(row('c1', reason, { would_send: false, legacy_welcomed: true })),
    ).toBe('explained')
  })

  it('returns unavailable for stale reason even when other fields look fine', () => {
    expect(
      judgeLead(row('c1', 'stale', { would_send: true, legacy_welcomed: true })),
    ).toBe('unavailable')
  })

  it('returns unavailable when legacy_welcomed is null', () => {
    expect(
      judgeLead(row('c1', null, { would_send: true, legacy_welcomed: null })),
    ).toBe('unavailable')
  })

  it('returns unavailable when legacy_welcomed is missing', () => {
    expect(judgeLead(row('c1', null, { would_send: true }))).toBe('unavailable')
  })

  it('returns unavailable when would_send is missing', () => {
    expect(
      judgeLead(row('c1', null, { legacy_welcomed: true })),
    ).toBe('unavailable')
  })

  it('returns unavailable when would_send is not a boolean', () => {
    expect(
      judgeLead(row('c1', null, { would_send: 'yes', legacy_welcomed: true })),
    ).toBe('unavailable')
  })
})

describe('compareShadowRows', () => {
  it('returns [] for empty input', () => {
    expect(compareShadowRows([])).toEqual([])
  })

  it('groups by day and sorts ascending', () => {
    const rows: ShadowRowForCompare[] = [
      row('c3', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-03-03' }),
      row('c1', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-03-01' }),
      row('c2', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-03-02' }),
    ]
    const days = compareShadowRows(rows)
    expect(days.map((d) => d.leadLocalDay)).toEqual(['2024-03-01', '2024-03-02', '2024-03-03'])
  })

  it('computes exact counters on a mixed fixture', () => {
    const rows: ShadowRowForCompare[] = [
      // day 1: 4 rows
      row('a1', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-01' }), // agree
      row('a2', 'sales_email_exists', { would_send: false, legacy_welcomed: true, lead_local_day: '2024-04-01' }), // agree
      row('a3', 'dnc', { would_send: false, legacy_welcomed: true, lead_local_day: '2024-04-01' }), // explained
      row('a4', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-04-01' }), // unexplained
      // day 2: 3 rows
      row('b1', null, { would_send: false, legacy_welcomed: false, lead_local_day: '2024-04-02' }), // agree
      row('b2', 'stale', { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-02' }), // unavailable
      row('b3', 'bad_email', { would_send: false, legacy_welcomed: true, lead_local_day: '2024-04-02' }), // explained
      // day 3: 3 rows
      row('c1', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-03' }), // agree
      row('c2', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-03' }), // agree
      row('c3', 'sales_email_exists', { would_send: false, legacy_welcomed: false, lead_local_day: '2024-04-03' }), // unexplained
    ]

    const days = compareShadowRows(rows)
    expect(days).toHaveLength(3)

    expect(days[0]).toEqual({
      leadLocalDay: '2024-04-01',
      total: 4,
      wouldSend: 2,
      salesSkipped: 1,
      legacyWelcomed: 3,
      agree: 2,
      explained: 1,
      unexplained: 1,
      unavailable: 0,
      unexplainedContactIds: ['a4'],
    })

    expect(days[1]).toEqual({
      leadLocalDay: '2024-04-02',
      total: 3,
      wouldSend: 1,
      salesSkipped: 0,
      legacyWelcomed: 2,
      agree: 1,
      explained: 1,
      unexplained: 0,
      unavailable: 1,
      unexplainedContactIds: [],
    })

    expect(days[2]).toEqual({
      leadLocalDay: '2024-04-03',
      total: 3,
      wouldSend: 2,
      salesSkipped: 1,
      legacyWelcomed: 2,
      agree: 2,
      explained: 0,
      unexplained: 1,
      unavailable: 0,
      unexplainedContactIds: ['c3'],
    })
  })

  it('sorts unexplainedContactIds ascending', () => {
    const rows: ShadowRowForCompare[] = [
      row('zeta', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-05-01' }),
      row('alpha', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-05-01' }),
      row('mike', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-05-01' }),
    ]
    const [d] = compareShadowRows(rows)
    expect(d.unexplainedContactIds).toEqual(['alpha', 'mike', 'zeta'])
  })

  it('places rows with missing or invalid lead_local_day under 0000-00-00', () => {
    const rows: ShadowRowForCompare[] = [
      row('x1', null, { would_send: true, legacy_welcomed: true }),
      row('x2', null, { would_send: true, legacy_welcomed: true, lead_local_day: 'not-a-day' }),
      row('x3', null, { would_send: true, legacy_welcomed: true, lead_local_day: 20240301 }),
      row('x4', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-06-01' }),
    ]
    const days = compareShadowRows(rows)
    expect(days.map((d) => d.leadLocalDay)).toEqual(['0000-00-00', '2024-06-01'])
    expect(days[0].total).toBe(3)
    expect(days[1].total).toBe(1)
  })
})

describe('isConsistentDay', () => {
  it('is not consistent when total is 0', () => {
    expect(isConsistentDay(day({ leadLocalDay: '2024-01-01', total: 0, agree: 0 }))).toBe(false)
  })

  it('is consistent when there are no unexplained or unavailable', () => {
    expect(isConsistentDay(day({ leadLocalDay: '2024-01-01' }))).toBe(true)
  })

  it('is inconsistent when there is an unexplained lead', () => {
    expect(
      isConsistentDay(day({ leadLocalDay: '2024-01-01', unexplained: 1 })),
    ).toBe(false)
  })

  it('is inconsistent when there is an unavailable lead', () => {
    expect(
      isConsistentDay(day({ leadLocalDay: '2024-01-01', unavailable: 1 })),
    ).toBe(false)
  })
})

describe('consecutiveConsistentDays', () => {
  it('returns 0 for empty input', () => {
    expect(consecutiveConsistentDays([])).toBe(0)
  })

  it('counts 5 consistent days', () => {
    const days = [
      day({ leadLocalDay: '2024-01-01' }),
      day({ leadLocalDay: '2024-01-02' }),
      day({ leadLocalDay: '2024-01-03' }),
      day({ leadLocalDay: '2024-01-04' }),
      day({ leadLocalDay: '2024-01-05' }),
    ]
    expect(consecutiveConsistentDays(days)).toBe(5)
  })

  it('resets the streak at an inconsistent day in the middle', () => {
    const days = [
      day({ leadLocalDay: '2024-01-01' }),
      day({ leadLocalDay: '2024-01-02' }),
      day({ leadLocalDay: '2024-01-03', unexplained: 1 }),
      day({ leadLocalDay: '2024-01-04' }),
      day({ leadLocalDay: '2024-01-05' }),
    ]
    expect(consecutiveConsistentDays(days)).toBe(2)
  })

  it('returns 0 when the last day is inconsistent', () => {
    const days = [
      day({ leadLocalDay: '2024-01-01' }),
      day({ leadLocalDay: '2024-01-02' }),
      day({ leadLocalDay: '2024-01-03', unavailable: 1 }),
    ]
    expect(consecutiveConsistentDays(days)).toBe(0)
  })

  it('ignores days with total 0 without breaking the streak', () => {
    const days = [
      day({ leadLocalDay: '2024-01-01' }),
      day({ leadLocalDay: '2024-01-02' }),
      day({ leadLocalDay: '2024-01-03', total: 0, agree: 0 }),
      day({ leadLocalDay: '2024-01-04' }),
      day({ leadLocalDay: '2024-01-05' }),
      day({ leadLocalDay: '2024-01-06', total: 0, agree: 0 }),
    ]
    expect(consecutiveConsistentDays(days)).toBe(4)
  })

  it('gives the same answer for unsorted input as for sorted input', () => {
    const sorted = [
      day({ leadLocalDay: '2024-01-01' }),
      day({ leadLocalDay: '2024-01-02' }),
      day({ leadLocalDay: '2024-01-03' }),
    ]
    const unsorted = [sorted[2], sorted[0], sorted[1]]
    expect(consecutiveConsistentDays(unsorted)).toBe(consecutiveConsistentDays(sorted))
    expect(consecutiveConsistentDays(unsorted)).toBe(3)
  })
})

import { describe, it, expect } from 'vitest'
import {
  judgeLead,
  compareShadowRows,
  isConsistentDay,
  consecutiveConsistentDays,
  reconcileBatches,
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

const SEEN = { legacy_batch_seen: true }

describe('judgeLead', () => {
  it('returns agree when the batch welcomed and ME would send', () => {
    expect(judgeLead(row('c1', null, { would_send: true, legacy_welcomed: true }))).toBe('agree')
  })

  it('returns agree when neither welcomed (and the batch had run)', () => {
    expect(judgeLead(row('c1', null, { would_send: false, legacy_welcomed: false, ...SEEN }))).toBe('agree')
  })

  it('returns agree when both did not, with a reason such as dnc', () => {
    expect(judgeLead(row('c1', 'dnc', { would_send: false, legacy_welcomed: false, ...SEEN }))).toBe('agree')
  })

  // The old batch skips members tagged as having a sales conversation, so a salesperson who wrote first
  // means NEITHER side sends the welcome.
  it('returns agree when a sales e-mail exists and the batch did not welcome either', () => {
    expect(
      judgeLead(row('c1', 'sales_email_exists', { would_send: false, legacy_welcomed: false, ...SEEN })),
    ).toBe('agree')
  })

  it('returns explained when a sales e-mail exists but the batch had already welcomed (it ran first)', () => {
    expect(
      judgeLead(row('c1', 'sales_email_exists', { would_send: false, legacy_welcomed: true })),
    ).toBe('explained')
  })

  it('returns unexplained when ME would send and the batch did not welcome', () => {
    expect(judgeLead(row('c1', null, { would_send: true, legacy_welcomed: false, ...SEEN }))).toBe('unexplained')
  })

  it('returns unexplained for an unknown reason with legacy true and ME not sending', () => {
    expect(judgeLead(row('c1', 'some_unknown_reason', { would_send: false, legacy_welcomed: true }))).toBe(
      'unexplained',
    )
  })

  it('returns unexplained for a null reason with legacy true and ME not sending', () => {
    expect(judgeLead(row('c1', null, { would_send: false, legacy_welcomed: true }))).toBe('unexplained')
  })

  it.each(['sales_email_exists', 'dnc', 'mailchimp_suppressed', 'excluded_tag'])(
    'returns explained for the state-dependent reason %s when the batch welcomed and ME would not',
    (reason) => {
      expect(judgeLead(row('c1', reason, { would_send: false, legacy_welcomed: true }))).toBe('explained')
    },
  )

  // These come from ME's rule or from the data, so a difference they cause is one the PM has to see.
  it.each(['bad_email', 'system_address', 'not_in_allowlist', 'no_consent_basis', 'frequency_full'])(
    'returns unexplained for the rule/data reason %s when the batch welcomed and ME would not',
    (reason) => {
      expect(judgeLead(row('c1', reason, { would_send: false, legacy_welcomed: true }))).toBe('unexplained')
    },
  )

  it('returns unavailable for stale even when other fields look fine', () => {
    expect(judgeLead(row('c1', 'stale', { would_send: true, legacy_welcomed: true }))).toBe('unavailable')
  })

  it('returns unavailable when legacy_welcomed is null', () => {
    expect(judgeLead(row('c1', null, { would_send: true, legacy_welcomed: null }))).toBe('unavailable')
  })

  it('returns unavailable when legacy_welcomed is missing', () => {
    expect(judgeLead(row('c1', null, { would_send: true }))).toBe('unavailable')
  })

  it('returns unavailable when would_send is missing', () => {
    expect(judgeLead(row('c1', null, { legacy_welcomed: true }))).toBe('unavailable')
  })

  it('returns unavailable when would_send is not a boolean', () => {
    expect(judgeLead(row('c1', null, { would_send: 'yes', legacy_welcomed: true }))).toBe('unavailable')
  })

  // "Not welcomed" proves nothing when the old batch had not run (late, or skipped that day).
  it.each([
    ['false', { legacy_batch_seen: false }],
    ['missing', {}],
    ['null', { legacy_batch_seen: null }],
    ['not a boolean', { legacy_batch_seen: 'yes' }],
  ])('returns unavailable for "not welcomed" when the batch-seen flag is %s', (_label, extra) => {
    expect(judgeLead(row('c1', null, { would_send: false, legacy_welcomed: false, ...extra }))).toBe('unavailable')
    expect(judgeLead(row('c1', null, { would_send: true, legacy_welcomed: false, ...extra }))).toBe('unavailable')
    expect(
      judgeLead(row('c1', 'sales_email_exists', { would_send: false, legacy_welcomed: false, ...extra })),
    ).toBe('unavailable')
  })

  it('does not need the batch-seen flag when the batch DID welcome the lead (it obviously ran)', () => {
    expect(judgeLead(row('c1', null, { would_send: true, legacy_welcomed: true, legacy_batch_seen: false }))).toBe(
      'agree',
    )
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
      row('a2', 'sales_email_exists', { would_send: false, legacy_welcomed: true, lead_local_day: '2024-04-01' }), // explained
      row('a3', 'dnc', { would_send: false, legacy_welcomed: true, lead_local_day: '2024-04-01' }), // explained
      row('a4', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-04-01', ...SEEN }), // unexplained
      // day 2: 3 rows
      row('b1', null, { would_send: false, legacy_welcomed: false, lead_local_day: '2024-04-02', ...SEEN }), // agree
      row('b2', 'stale', { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-02' }), // unavailable
      row('b3', 'bad_email', { would_send: false, legacy_welcomed: true, lead_local_day: '2024-04-02' }), // unexplained
      // day 3: 3 rows
      row('c1', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-03' }), // agree
      row('c2', null, { would_send: true, legacy_welcomed: true, lead_local_day: '2024-04-03' }), // agree
      row('c3', 'sales_email_exists', { would_send: false, legacy_welcomed: false, lead_local_day: '2024-04-03', ...SEEN }), // agree
    ]

    const days = compareShadowRows(rows)
    expect(days).toHaveLength(3)

    expect(days[0]).toEqual({
      leadLocalDay: '2024-04-01',
      total: 4,
      wouldSend: 2,
      salesSkipped: 1,
      legacyWelcomed: 3,
      agree: 1,
      explained: 2,
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
      explained: 0,
      unexplained: 1,
      unavailable: 1,
      unexplainedContactIds: ['b3'],
    })

    expect(days[2]).toEqual({
      leadLocalDay: '2024-04-03',
      total: 3,
      wouldSend: 2,
      salesSkipped: 1,
      legacyWelcomed: 2,
      agree: 3,
      explained: 0,
      unexplained: 0,
      unavailable: 0,
      unexplainedContactIds: [],
    })
  })

  it('sorts unexplainedContactIds ascending', () => {
    const rows: ShadowRowForCompare[] = [
      row('zeta', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-05-01', ...SEEN }),
      row('alpha', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-05-01', ...SEEN }),
      row('mike', null, { would_send: true, legacy_welcomed: false, lead_local_day: '2024-05-01', ...SEEN }),
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

describe('reconcileBatches', () => {
  const batch = (campaignId: string, emailsSent: number, extra: Record<string, unknown> = {}) => ({
    campaignId,
    title: `Batch ${campaignId}`,
    sentAt: '2024-07-01T06:00:00.000Z',
    emailsSent,
    ...extra,
  })

  it('returns [] when there are no batches', () => {
    expect(reconcileBatches([], [row('c1', null, { legacy_campaign_ids: ['k1'] })])).toEqual([])
  })

  it('counts the leads each campaign welcomed and reports the gap to its own total', () => {
    const rows = [
      row('c1', null, { legacy_campaign_ids: ['k1'] }),
      row('c2', null, { legacy_campaign_ids: ['k1'] }),
      row('c3', null, { legacy_campaign_ids: ['k2'] }),
      row('c4', null, { legacy_campaign_ids: [] }),
    ]
    expect(reconcileBatches([batch('k1', 5), batch('k2', 1)], rows)).toEqual([
      { ...batch('k1', 5), matchedContacts: 2, gap: 3 },
      { ...batch('k2', 1), matchedContacts: 1, gap: 0 },
    ])
  })

  it('a campaign no row names has every recipient in the gap', () => {
    expect(reconcileBatches([batch('k9', 7)], [])).toEqual([{ ...batch('k9', 7), matchedContacts: 0, gap: 7 }])
  })

  it('counts a row once even if it names the campaign twice', () => {
    const rows = [row('c1', null, { legacy_campaign_ids: ['k1', 'k1'] })]
    expect(reconcileBatches([batch('k1', 1)], rows)[0]).toMatchObject({ matchedContacts: 1, gap: 0 })
  })

  it('ignores rows without a usable list of campaign ids', () => {
    const rows = [
      row('c1', null, {}),
      row('c2', null, { legacy_campaign_ids: null }),
      row('c3', null, { legacy_campaign_ids: 'k1' }),
      row('c4', null, { legacy_campaign_ids: [1, null, { id: 'k1' }] }),
    ]
    expect(reconcileBatches([batch('k1', 2)], rows)[0]).toMatchObject({ matchedContacts: 0, gap: 2 })
  })

  it('lets a later entry replace an earlier one with the same campaign id', () => {
    const rows = [row('c1', null, { legacy_campaign_ids: ['k1'] })]
    const result = reconcileBatches([batch('k1', 3), batch('k1', 4)], rows)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ emailsSent: 4, matchedContacts: 1, gap: 3 })
  })

  it('keeps the gap signed: more matched leads than the campaign says it sent is also a mismatch', () => {
    const rows = [
      row('c1', null, { legacy_campaign_ids: ['k1'] }),
      row('c2', null, { legacy_campaign_ids: ['k1'] }),
    ]
    expect(reconcileBatches([batch('k1', 1)], rows)[0]).toMatchObject({ matchedContacts: 2, gap: -1 })
  })
})

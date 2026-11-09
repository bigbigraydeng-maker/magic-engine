import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, backfillSegments, backfillWindowStart, coveredThrough, isIsoDay, isSegmentCovered,
  lastDispatchDay, monthEnd, monthHistory, pacificDay, parsePullDue, planPageDailyPulls, pullEventId, stoppedOnFor,
  BACKFILL_MONTHS, BACKFILL_STOP_AFTER_FAILURES, DAILY_WINDOW_DAYS, MAX_BACKFILL_SEGMENTS_PER_DISPATCH,
  type PlanReceipt,
} from '../page-daily-plan'

const A = 'c0000000-0000-0000-0000-000000000000'
const B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SITE_A = 'https://a.example.com/'
const TODAY = '2026-09-26'

function receipt(over: Partial<PlanReceipt> & Pick<PlanReceipt, 'request_start_day' | 'request_end_day'>): PlanReceipt {
  return {
    client_id: A,
    site_url: SITE_A,
    kind: 'backfill',
    status: 'complete',
    failure_kind: null,
    data_through_day: null,
    started_at: '2026-09-25T18:31:00Z',
    ...over,
  }
}
/** A failed backfill receipt for July 2026 pulled at `startedAt`. */
function julyFailed(startedAt: string, failure_kind: PlanReceipt['failure_kind'] = 'other'): PlanReceipt {
  return receipt({ request_start_day: '2026-07-01', request_end_day: '2026-07-31', status: 'failed', failure_kind, started_at: startedAt })
}
/** Receipts that fully cover September (up to the 20th) and August, so July is the newest uncovered month on TODAY. */
const SEPT_AUG_COVERED: PlanReceipt[] = [
  receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-20', data_through_day: '2026-09-20' }),
  receipt({ request_start_day: '2026-08-01', request_end_day: '2026-08-31', data_through_day: '2026-08-31' }),
]

describe('page-daily-plan', () => {
  it('day helpers', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(monthEnd('2026-02-10')).toBe('2026-02-28')
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
    expect(pacificDay(new Date('2026-09-26T18:30:00Z'))).toBe('2026-09-26')
    expect(pacificDay(new Date('2026-09-26T05:00:00Z'))).toBe('2026-09-25')
    expect(isIsoDay('2026-02-30')).toBe(false)
    expect(isIsoDay('2026-02-28')).toBe(true)
    expect(isIsoDay(20260228)).toBe(false)
  })

  it('backfill covers 16 calendar months, newest first, clipped before the daily window', () => {
    const segs = backfillSegments(TODAY)
    expect(segs).toHaveLength(BACKFILL_MONTHS)
    expect(segs[0]).toEqual({ start_day: '2026-09-01', end_day: '2026-09-20' })
    expect(segs[1]).toEqual({ start_day: '2026-08-01', end_day: '2026-08-31' })
    expect(segs[15]).toEqual({ start_day: '2025-06-01', end_day: '2025-06-30' })
    expect(backfillWindowStart(TODAY)).toBe('2025-06-01')
  })

  it('early in a month the current month has no settled days yet and is dropped', () => {
    const segs = backfillSegments('2026-10-03')
    expect(segs).toHaveLength(15)
    expect(segs[0]).toEqual({ start_day: '2026-09-01', end_day: '2026-09-27' })
    expect(segs[14]).toEqual({ start_day: '2025-07-01', end_day: '2025-07-31' })
  })

  it('no receipts → one daily order + the 3 newest months', () => {
    expect(planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], [], TODAY).orders).toEqual([
      { client_id: A, kind: 'daily', start_day: '2026-09-21', end_day: '2026-09-25' },
      { client_id: A, kind: 'backfill', start_day: '2026-09-01', end_day: '2026-09-20' },
      { client_id: A, kind: 'backfill', start_day: '2026-08-01', end_day: '2026-08-31' },
      { client_id: A, kind: 'backfill', start_day: '2026-07-01', end_day: '2026-07-31' },
    ])
    expect(DAILY_WINDOW_DAYS).toBe(5)
    expect(MAX_BACKFILL_SEGMENTS_PER_DISPATCH).toBe(3)
  })

  it('🔴 months already covered by complete receipts are skipped', () => {
    const receipts = [
      receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-20', data_through_day: '2026-09-20' }),
      receipt({ request_start_day: '2026-08-01', request_end_day: '2026-08-31', data_through_day: '2026-08-31' }),
    ]
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY).orders
    const backfill = orders.filter((o) => o.kind === 'backfill')
    expect(backfill).toEqual([
      { client_id: A, kind: 'backfill', start_day: '2026-07-01', end_day: '2026-07-31' },
      { client_id: A, kind: 'backfill', start_day: '2026-06-01', end_day: '2026-06-30' },
      { client_id: A, kind: 'backfill', start_day: '2026-05-01', end_day: '2026-05-31' },
    ])
  })

  it('a receipt for another GSC property of the same client does not count', () => {
    const receipts = [
      receipt({
        request_start_day: '2026-09-01',
        request_end_day: '2026-09-20',
        data_through_day: '2026-09-20',
        site_url: 'sc-domain:a.example.com',
      }),
    ]
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY).orders
    const backfill = orders.filter((o) => o.kind === 'backfill')
    expect(backfill[0]).toEqual({ client_id: A, kind: 'backfill', start_day: '2026-09-01', end_day: '2026-09-20' })
  })

  it("another client's receipts do not count", () => {
    const receipts = [
      receipt({ client_id: B, request_start_day: '2026-09-01', request_end_day: '2026-09-20', data_through_day: '2026-09-20' }),
      receipt({ client_id: B, request_start_day: '2026-08-01', request_end_day: '2026-08-31', data_through_day: '2026-08-31' }),
    ]
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY).orders
    const backfill = orders.filter((o) => o.kind === 'backfill')
    expect(backfill).toEqual([
      { client_id: A, kind: 'backfill', start_day: '2026-09-01', end_day: '2026-09-20' },
      { client_id: A, kind: 'backfill', start_day: '2026-08-01', end_day: '2026-08-31' },
      { client_id: A, kind: 'backfill', start_day: '2026-07-01', end_day: '2026-07-31' },
    ])
  })

  it('coveredThrough', () => {
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2025-06-01',
          request_end_day: '2025-06-30',
          data_through_day: null,
          started_at: '2026-09-25T18:30:00Z',
        }),
      ),
    ).toBe('2025-06-30')
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-09-20',
          request_end_day: '2026-09-24',
          data_through_day: '2026-09-22',
          started_at: '2026-09-25T18:30:00Z',
        }),
      ),
    ).toBe('2026-09-22')
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-09-20',
          request_end_day: '2026-09-24',
          data_through_day: null,
          started_at: '2026-09-25T18:30:00Z',
        }),
      ),
    ).toBe('2026-09-20')
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-09-22',
          request_end_day: '2026-09-25',
          data_through_day: null,
          started_at: '2026-09-26T18:30:00Z',
        }),
      ),
    ).toBeNull()
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-09-01',
          request_end_day: '2026-09-12',
          data_through_day: '2026-09-10',
          started_at: 'not-a-date',
        }),
      ),
    ).toBe('2026-09-10')
  })

  it("🔴 steady state: yesterday's daily receipt covers the moving end of the current month", () => {
    const receipts = [
      receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-19', data_through_day: '2026-09-19' }),
      receipt({
        request_start_day: '2026-09-20',
        request_end_day: '2026-09-24',
        data_through_day: '2026-09-22',
        started_at: '2026-09-25T18:30:00Z',
      }),
    ]
    expect(isSegmentCovered({ start_day: '2026-09-01', end_day: '2026-09-20' }, receipts)).toBe(true)
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY).orders
    expect(orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-09-01')).toBe(false)
  })

  it('🔴 a missed day re-opens its month', () => {
    const only = receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-19', data_through_day: '2026-09-19' })
    expect(isSegmentCovered({ start_day: '2026-09-01', end_day: '2026-09-20' }, [only])).toBe(false)
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], [only], TODAY).orders
    const backfill = orders.filter((o) => o.kind === 'backfill')
    expect(backfill[0]?.start_day).toBe('2026-09-01')
  })

  it('pullEventId is deterministic', () => {
    expect(pullEventId({ client_id: A, kind: 'backfill', start_day: '2026-08-01', end_day: '2026-08-31' })).toBe(
      'gsc-page-daily:' + A + ':backfill:2026-08-01:2026-08-31',
    )
  })

  it('parsePullDue is fail-closed', () => {
    const valid = { client_id: A, kind: 'daily', start_day: '2026-09-21', end_day: '2026-09-25' }
    expect(parsePullDue(valid)).toEqual({ ok: true, value: valid })
    expect(parsePullDue({ ...valid, client_id: 'nope' })).toEqual({ ok: false, reason: 'invalid_client_id' })
    expect(parsePullDue({ ...valid, kind: 'weekly' })).toEqual({ ok: false, reason: 'invalid_kind' })
    expect(parsePullDue({ ...valid, start_day: '2026-02-30' })).toEqual({ ok: false, reason: 'invalid_day' })
    expect(parsePullDue({ ...valid, start_day: '2026-09-25', end_day: '2026-09-21' })).toEqual({
      ok: false,
      reason: 'invalid_range',
    })
    expect(parsePullDue({ ...valid, start_day: '2026-08-01', end_day: '2026-09-15' })).toEqual({
      ok: false,
      reason: 'range_too_long',
    })
    expect(parsePullDue(null)).toEqual({ ok: false, reason: 'payload_not_object' })
    expect(parsePullDue('x')).toEqual({ ok: false, reason: 'payload_not_object' })
  })

  it('coveredThrough: only complete and truncated receipts vouch for coverage', () => {
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-08-01',
          request_end_day: '2026-08-31',
          data_through_day: '2026-08-31',
          status: 'failed',
          failure_kind: 'other',
        }),
      ),
    ).toBeNull()
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-08-01',
          request_end_day: '2026-08-31',
          data_through_day: '2026-08-31',
          status: 'running',
        }),
      ),
    ).toBeNull()
    expect(
      coveredThrough(
        receipt({
          request_start_day: '2026-08-01',
          request_end_day: '2026-08-31',
          data_through_day: '2026-08-31',
          status: 'truncated',
        }),
      ),
    ).toBe('2026-08-31')
  })

  it('🔴 a truncated month is covered and never dispatched again', () => {
    const receipts = [
      SEPT_AUG_COVERED[0],
      receipt({
        request_start_day: '2026-08-01',
        request_end_day: '2026-08-31',
        data_through_day: '2026-08-31',
        status: 'truncated',
      }),
    ]
    const backfill = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY).orders.filter(
      (o) => o.kind === 'backfill',
    )
    expect(backfill[0]?.start_day).toBe('2026-07-01')
    expect(backfill.some((o) => o.start_day === '2026-08-01')).toBe(false)
  })

  it('🔴 three consecutive non-auth failures stop a month: not dispatched, listed, and the next older month moves up', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-22T18:31:00Z'),
      julyFailed('2026-09-23T18:31:00Z', 'quota'),
      julyFailed('2026-09-24T18:31:00Z'),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    const backfill = plan.orders.filter((o) => o.kind === 'backfill')
    expect(backfill.map((o) => o.start_day)).toEqual(['2026-06-01', '2026-05-01', '2026-04-01'])
    expect(plan.stopped).toEqual([{ client_id: A, month: '2026-07', stopped_on: '2026-09-24' }])
    expect(BACKFILL_STOP_AFTER_FAILURES).toBe(3)
  })

  it('two failures are not enough', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-22T18:31:00Z'),
      julyFailed('2026-09-23T18:31:00Z', 'quota'),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    const backfill = plan.orders.filter((o) => o.kind === 'backfill')
    expect(backfill[0]?.start_day).toBe('2026-07-01')
    expect(plan.stopped).toEqual([])
  })

  it('🔴 first dispatch after the third failure reports it as new (red once)', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-23T18:31:00Z'),
      julyFailed('2026-09-24T18:31:00Z'),
      julyFailed('2026-09-25T18:31:00Z'),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    expect(plan.newlyStopped).toEqual([{ client_id: A, month: '2026-07', stopped_on: '2026-09-25' }])
    expect(plan.stopped).toEqual([{ client_id: A, month: '2026-07', stopped_on: '2026-09-25' }])
  })

  it('🔴 the day after, it is still listed but no longer new', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-23T18:31:00Z'),
      julyFailed('2026-09-24T18:31:00Z'),
      julyFailed('2026-09-25T18:31:00Z'),
      receipt({
        kind: 'daily',
        request_start_day: '2026-09-21',
        request_end_day: '2026-09-25',
        data_through_day: '2026-09-23',
        started_at: '2026-09-26T18:31:00Z',
      }),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, '2026-09-27')
    expect(plan.stopped).toEqual([{ client_id: A, month: '2026-07', stopped_on: '2026-09-25' }])
    expect(plan.newlyStopped).toEqual([])
  })

  it('a skipped dispatch day does not lose the red', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-23T18:31:00Z'),
      julyFailed('2026-09-24T18:31:00Z'),
      julyFailed('2026-09-25T18:31:00Z'),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, '2026-09-27')
    expect(plan.newlyStopped).toHaveLength(1)
  })

  it('🔴 auth failures do not count and break the streak', () => {
    const first = planPageDailyPulls(
      [{ clientId: A, siteUrl: SITE_A }],
      [
        ...SEPT_AUG_COVERED,
        julyFailed('2026-09-22T18:31:00Z'),
        julyFailed('2026-09-23T18:31:00Z'),
        julyFailed('2026-09-24T18:31:00Z', 'auth'),
      ],
      TODAY,
    )
    expect(first.stopped).toEqual([])
    expect(first.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-07-01')).toBe(true)

    const second = planPageDailyPulls(
      [{ clientId: A, siteUrl: SITE_A }],
      [
        ...SEPT_AUG_COVERED,
        julyFailed('2026-09-21T18:31:00Z'),
        julyFailed('2026-09-22T18:31:00Z', 'auth'),
        julyFailed('2026-09-23T18:31:00Z'),
        julyFailed('2026-09-24T18:31:00Z'),
      ],
      TODAY,
    )
    expect(second.stopped).toEqual([])
  })

  it('🔴 a complete receipt after the failures ends the stop', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-21T18:31:00Z'),
      julyFailed('2026-09-22T18:31:00Z'),
      julyFailed('2026-09-23T18:31:00Z'),
      receipt({
        request_start_day: '2026-07-01',
        request_end_day: '2026-07-15',
        data_through_day: '2026-07-15',
        started_at: '2026-09-24T18:31:00Z',
      }),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    expect(plan.stopped).toEqual([])
    const backfill = plan.orders.filter((o) => o.kind === 'backfill')
    expect(backfill[0]?.start_day).toBe('2026-07-01')
  })

  it('🔴 a truncated receipt after the failures ends the stop', () => {
    const receipts = [
      ...SEPT_AUG_COVERED,
      julyFailed('2026-09-21T18:31:00Z'),
      julyFailed('2026-09-22T18:31:00Z'),
      julyFailed('2026-09-23T18:31:00Z'),
      receipt({
        request_start_day: '2026-07-01',
        request_end_day: '2026-07-31',
        data_through_day: '2026-07-31',
        status: 'truncated',
        started_at: '2026-09-24T18:31:00Z',
      }),
    ]
    const plan = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    expect(plan.stopped).toEqual([])
    expect(plan.orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-07-01')).toBe(false)
  })

  it('stoppedOnFor: a longer streak keeps the date of the failure that first reached three', () => {
    expect(
      stoppedOnFor(
        monthHistory(
          [
            julyFailed('2026-09-20T18:31:00Z'),
            julyFailed('2026-09-21T18:31:00Z'),
            julyFailed('2026-09-22T18:31:00Z'),
            julyFailed('2026-09-23T18:31:00Z'),
          ],
          A,
          SITE_A,
          '2026-07-01',
        ),
      ),
    ).toBe('2026-09-22')
  })

  it('monthHistory ignores other months, daily receipts, running ones and other properties', () => {
    const history = monthHistory(
      [
        julyFailed('2026-09-20T18:31:00Z'),
        receipt({ kind: 'daily', request_start_day: '2026-07-01', request_end_day: '2026-07-05' }),
        receipt({ request_start_day: '2026-07-01', request_end_day: '2026-07-31', status: 'running' }),
        receipt({ request_start_day: '2026-07-01', request_end_day: '2026-07-31', site_url: 'sc-domain:a.example.com' }),
        receipt({ request_start_day: '2026-06-01', request_end_day: '2026-06-30' }),
      ],
      A,
      SITE_A,
      '2026-07-01',
    )
    expect(history).toHaveLength(1)
  })

  it('lastDispatchDay', () => {
    expect(lastDispatchDay([])).toBeNull()
    expect(
      lastDispatchDay([
        receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-02', started_at: '2026-09-24T18:31:00Z' }),
        receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-02', started_at: '2026-09-26T05:00:00Z' }),
      ]),
    ).toBe('2026-09-25')
  })
})

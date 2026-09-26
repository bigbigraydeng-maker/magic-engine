import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, backfillSegments, backfillWindowStart, coveredThrough, isIsoDay, isSegmentCovered,
  monthEnd, pacificDay, parsePullDue, planPageDailyPulls, pullEventId,
  BACKFILL_MONTHS, DAILY_WINDOW_DAYS, MAX_BACKFILL_SEGMENTS_PER_DISPATCH,
  type CoverageReceipt,
} from '../page-daily-plan'

const A = 'c0000000-0000-0000-0000-000000000000'
const B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SITE_A = 'https://a.example.com/'
const TODAY = '2026-09-26'

function receipt(over: Partial<CoverageReceipt> & Pick<CoverageReceipt, 'request_start_day' | 'request_end_day'>): CoverageReceipt {
  return { client_id: A, site_url: SITE_A, data_through_day: null, started_at: '2026-09-25T18:31:00Z', ...over }
}

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
    expect(planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], [], TODAY)).toEqual([
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
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
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
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    const backfill = orders.filter((o) => o.kind === 'backfill')
    expect(backfill[0]).toEqual({ client_id: A, kind: 'backfill', start_day: '2026-09-01', end_day: '2026-09-20' })
  })

  it("another client's receipts do not count", () => {
    const receipts = [
      receipt({ client_id: B, request_start_day: '2026-09-01', request_end_day: '2026-09-20', data_through_day: '2026-09-20' }),
      receipt({ client_id: B, request_start_day: '2026-08-01', request_end_day: '2026-08-31', data_through_day: '2026-08-31' }),
    ]
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
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
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], receipts, TODAY)
    expect(orders.some((o) => o.kind === 'backfill' && o.start_day === '2026-09-01')).toBe(false)
  })

  it('🔴 a missed day re-opens its month', () => {
    const only = receipt({ request_start_day: '2026-09-01', request_end_day: '2026-09-19', data_through_day: '2026-09-19' })
    expect(isSegmentCovered({ start_day: '2026-09-01', end_day: '2026-09-20' }, [only])).toBe(false)
    const orders = planPageDailyPulls([{ clientId: A, siteUrl: SITE_A }], [only], TODAY)
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
})

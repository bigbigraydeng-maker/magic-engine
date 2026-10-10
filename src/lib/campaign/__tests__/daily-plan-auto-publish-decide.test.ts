/**
 * Tests for the pure auto-publish decision module.
 *
 * Every case here runs without a database, a network, or `process.env` — the
 * module's whole point is that its rules are decidable from plain values.
 */
import { describe, expect, it } from 'vitest'
import {
  AUTO_PUBLISH_MAX_ATTEMPTS,
  AUTO_PUBLISH_RETRY_BACKOFF_MINUTES,
  AUTO_PUBLISH_STALE_CLAIM_MINUTES,
  addDaysToDateString,
  classifyRunResult,
  decideClaim,
  dueWindowDates,
  isLiveFor,
  isRecallBlocked,
  isStaleClaim,
  nzDateString,
  readAutoPublishSwitches,
  type AttemptRow,
  type RecallEvidence,
} from '../daily-plan-auto-publish-decide'
import { MISSED_WINDOW_ERROR } from '../daily-plan-publish'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('exposes the documented attempt ceiling and backoff schedule', () => {
    expect(AUTO_PUBLISH_MAX_ATTEMPTS).toBe(3)
    expect(AUTO_PUBLISH_RETRY_BACKOFF_MINUTES).toEqual([10, 20, 40])
    expect(AUTO_PUBLISH_STALE_CLAIM_MINUTES).toBe(15)
  })
})

// ─── Dates ────────────────────────────────────────────────────────────────────

describe('nzDateString', () => {
  it('returns the NZ calendar date for a UTC instant', () => {
    // 2026-09-26T20:00Z is 2026-09-27 08:00 NZST (UTC+12).
    expect(nzDateString(new Date('2026-09-26T20:00:00.000Z'))).toBe('2026-09-27')
  })

  it('is correct across the NZ daylight-saving start (2026-09-27)', () => {
    // Just before the switch: 2026-09-26T11:59Z is 2026-09-26 23:59 NZST.
    expect(nzDateString(new Date('2026-09-26T11:59:00.000Z'))).toBe('2026-09-26')
    // Just after: 2026-09-26T12:00Z is 2026-09-27 01:00 NZDT (UTC+13).
    expect(nzDateString(new Date('2026-09-26T12:00:00.000Z'))).toBe('2026-09-27')
  })

  it('is correct across the NZ daylight-saving end (2027-04-04)', () => {
    // 2027-04-03T11:59Z is 2027-04-04 00:59 NZDT (UTC+13).
    expect(nzDateString(new Date('2027-04-03T11:59:00.000Z'))).toBe('2027-04-04')
    // 2027-04-03T12:00Z is 2027-04-04 00:00 NZST (UTC+12) — same date.
    expect(nzDateString(new Date('2027-04-03T12:00:00.000Z'))).toBe('2027-04-04')
  })
})

describe('addDaysToDateString', () => {
  it('adds days within a month', () => {
    expect(addDaysToDateString('2026-09-04', 1)).toBe('2026-09-05')
    expect(addDaysToDateString('2026-09-04', 0)).toBe('2026-09-04')
  })

  it('rolls over a month end', () => {
    expect(addDaysToDateString('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDaysToDateString('2026-10-01', -1)).toBe('2026-09-30')
  })

  it('rolls over a year end', () => {
    expect(addDaysToDateString('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateString('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('handles a leap day', () => {
    expect(addDaysToDateString('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysToDateString('2028-02-29', 1)).toBe('2028-03-01')
  })
})

describe('dueWindowDates', () => {
  it('returns today and tomorrow in NZ', () => {
    expect(dueWindowDates(new Date('2026-09-26T20:00:00.000Z'))).toEqual(['2026-09-27', '2026-09-28'])
  })

  it('rolls the window across a month end', () => {
    expect(dueWindowDates(new Date('2026-09-30T20:00:00.000Z'))).toEqual(['2026-10-01', '2026-10-02'])
  })
})

// ─── Switches ─────────────────────────────────────────────────────────────────

describe('readAutoPublishSwitches', () => {
  it('treats only the exact string "true" as live', () => {
    expect(readAutoPublishSwitches({ DAILY_PLAN_AUTO_PUBLISH_LIVE: 'true' }).live).toBe(true)
    expect(readAutoPublishSwitches({ DAILY_PLAN_AUTO_PUBLISH_LIVE: 'TRUE' }).live).toBe(false)
    expect(readAutoPublishSwitches({ DAILY_PLAN_AUTO_PUBLISH_LIVE: '1' }).live).toBe(false)
    expect(readAutoPublishSwitches({ DAILY_PLAN_AUTO_PUBLISH_LIVE: ' true' }).live).toBe(false)
    expect(readAutoPublishSwitches({ DAILY_PLAN_AUTO_PUBLISH_LIVE: 'yes' }).live).toBe(false)
    expect(readAutoPublishSwitches({}).live).toBe(false)
  })

  it('parses the client list, trimming, lowercasing and dropping empties', () => {
    const switches = readAutoPublishSwitches({
      DAILY_PLAN_AUTO_PUBLISH_CLIENTS: ' C0000000-0000-0000-0000-000000000001 , ,c0000000-0000-0000-0000-000000000002,',
    })
    expect(switches.clientIds).toEqual([
      'c0000000-0000-0000-0000-000000000001',
      'c0000000-0000-0000-0000-000000000002',
    ])
  })

  it('returns an empty list when the env var is absent', () => {
    expect(readAutoPublishSwitches({}).clientIds).toEqual([])
  })
})

describe('isLiveFor', () => {
  const switches = { live: true, clientIds: ['c0000000-0000-0000-0000-000000000001'] }

  it('is true only when live and the client is listed', () => {
    expect(isLiveFor(switches, 'c0000000-0000-0000-0000-000000000001')).toBe(true)
    expect(isLiveFor(switches, 'C0000000-0000-0000-0000-000000000001')).toBe(true)
    expect(isLiveFor(switches, 'c0000000-0000-0000-0000-000000000002')).toBe(false)
  })

  it('is false when the feature is not live', () => {
    expect(isLiveFor({ live: false, clientIds: ['c0000000-0000-0000-0000-000000000001'] }, 'c0000000-0000-0000-0000-000000000001')).toBe(false)
  })

  it('is false when the allow-list is empty', () => {
    expect(isLiveFor({ live: true, clientIds: [] }, 'c0000000-0000-0000-0000-000000000001')).toBe(false)
  })
})

// ─── Recall evidence ──────────────────────────────────────────────────────────

describe('isRecallBlocked', () => {
  const empty: RecallEvidence = { tombstoneDates: [], receiptRecalledDates: [], liftedDates: [] }

  it('does not block a date with no evidence', () => {
    expect(isRecallBlocked('2026-09-04', empty)).toBe(false)
  })

  it('blocks a date with a tombstone', () => {
    expect(isRecallBlocked('2026-09-04', { ...empty, tombstoneDates: ['2026-09-04'] })).toBe(true)
  })

  it('blocks a receipt-recalled date', () => {
    expect(isRecallBlocked('2026-09-04', { ...empty, receiptRecalledDates: ['2026-09-04'] })).toBe(true)
  })

  it('unblocks a receipt-recalled date that was lifted', () => {
    expect(
      isRecallBlocked('2026-09-04', {
        ...empty,
        receiptRecalledDates: ['2026-09-04'],
        liftedDates: ['2026-09-04'],
      }),
    ).toBe(false)
  })

  it('keeps a tombstoned date blocked even when it is also lifted', () => {
    expect(
      isRecallBlocked('2026-09-04', {
        ...empty,
        tombstoneDates: ['2026-09-04'],
        receiptRecalledDates: ['2026-09-04'],
        liftedDates: ['2026-09-04'],
      }),
    ).toBe(true)
  })

  it('does not block a lifted date that was never recalled', () => {
    expect(isRecallBlocked('2026-09-04', { ...empty, liftedDates: ['2026-09-04'] })).toBe(false)
  })
})

// ─── decideClaim ──────────────────────────────────────────────────────────────

function row(overrides: Partial<AttemptRow>): AttemptRow {
  return {
    status: 'claimed',
    reason_code: null,
    attempt_no: 1,
    next_retry_at: null,
    updated_at: '2026-09-04T00:00:00.000Z',
    request_id: 'r1',
    ...overrides,
  }
}

describe('decideClaim', () => {
  const now = new Date('2026-09-04T08:00:00.000Z')

  it('claims a new date when there is no row', () => {
    expect(decideClaim(null, now)).toEqual({ action: 'claim_new' })
  })

  it('skips a RECALLED block', () => {
    expect(decideClaim(row({ status: 'blocked', reason_code: 'RECALLED' }), now)).toEqual({
      action: 'skip',
      reason: 'RECALLED',
    })
  })

  it('reclaims any other block', () => {
    expect(decideClaim(row({ status: 'blocked', reason_code: 'NO_TOKEN' }), now)).toEqual({
      action: 'reclaim',
      fromStatus: 'blocked',
    })
    expect(decideClaim(row({ status: 'blocked', reason_code: null }), now)).toEqual({
      action: 'reclaim',
      fromStatus: 'blocked',
    })
  })

  it('reclaims a failed_retryable row once its backoff has elapsed', () => {
    expect(
      decideClaim(row({ status: 'failed_retryable', next_retry_at: '2026-09-04T07:59:00.000Z' }), now),
    ).toEqual({ action: 'reclaim', fromStatus: 'failed_retryable' })
    expect(
      decideClaim(row({ status: 'failed_retryable', next_retry_at: '2026-09-04T08:00:00.000Z' }), now),
    ).toEqual({ action: 'reclaim', fromStatus: 'failed_retryable' })
  })

  it('skips a failed_retryable row whose backoff has not elapsed', () => {
    expect(
      decideClaim(row({ status: 'failed_retryable', next_retry_at: '2026-09-04T08:01:00.000Z' }), now),
    ).toEqual({ action: 'skip', reason: 'WAITING_RETRY' })
  })

  it('skips a failed_retryable row with a null or unparseable next_retry_at', () => {
    expect(decideClaim(row({ status: 'failed_retryable', next_retry_at: null }), now)).toEqual({
      action: 'skip',
      reason: 'WAITING_RETRY',
    })
    expect(decideClaim(row({ status: 'failed_retryable', next_retry_at: 'not-a-date' }), now)).toEqual({
      action: 'skip',
      reason: 'WAITING_RETRY',
    })
  })

  it('reclaims a dry_run row', () => {
    expect(decideClaim(row({ status: 'dry_run' }), now)).toEqual({ action: 'reclaim', fromStatus: 'dry_run' })
  })

  it('skips a claimed row', () => {
    expect(decideClaim(row({ status: 'claimed' }), now)).toEqual({ action: 'skip', reason: 'CLAIMED_IN_PROGRESS' })
  })

  it('skips terminal statuses', () => {
    expect(decideClaim(row({ status: 'published' }), now)).toEqual({ action: 'skip', reason: 'ALREADY_PUBLISHED' })
    expect(decideClaim(row({ status: 'failed_final' }), now)).toEqual({ action: 'skip', reason: 'FAILED_FINAL' })
    expect(decideClaim(row({ status: 'unknown_outcome' }), now)).toEqual({ action: 'skip', reason: 'UNKNOWN_OUTCOME' })
    expect(decideClaim(row({ status: 'missed_window' }), now)).toEqual({ action: 'skip', reason: 'MISSED_WINDOW' })
  })
})

// ─── isStaleClaim ─────────────────────────────────────────────────────────────

describe('isStaleClaim', () => {
  const now = new Date('2026-09-04T08:00:00.000Z')

  it('is false for a non-claimed row', () => {
    expect(isStaleClaim(row({ status: 'published', updated_at: '2020-01-01T00:00:00.000Z' }), now)).toBe(false)
  })

  it('is false for a fresh claim', () => {
    expect(isStaleClaim(row({ status: 'claimed', updated_at: '2026-09-04T07:50:00.000Z' }), now)).toBe(false)
  })

  it('is false exactly at the boundary', () => {
    expect(isStaleClaim(row({ status: 'claimed', updated_at: '2026-09-04T07:45:00.000Z' }), now)).toBe(false)
  })

  it('is true just past the boundary', () => {
    expect(isStaleClaim(row({ status: 'claimed', updated_at: '2026-09-04T07:44:59.000Z' }), now)).toBe(true)
  })

  it('treats an unparseable updated_at as stale', () => {
    expect(isStaleClaim(row({ status: 'claimed', updated_at: 'garbage' }), now)).toBe(true)
  })
})

// ─── classifyRunResult ────────────────────────────────────────────────────────

describe('classifyRunResult', () => {
  const now = new Date('2026-09-04T08:00:00.000Z')
  const date = '2026-09-04'

  it('classifies a published entry', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: {
        receipt: {
          published: [{ date, post_id: '12345_67890', scheduled_publish_time: '2026-09-05T08:00:00.000Z' }],
          failed: [],
        },
      },
    })
    expect(outcome).toEqual({
      status: 'published',
      postId: '12345_67890',
      scheduledPublishTime: '2026-09-05T08:00:00.000Z',
      reasonCode: null,
    })
  })

  it('classifies a published entry with no scheduled time', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [{ date, post_id: '12345_67890' }], failed: [] } },
    })
    expect(outcome).toEqual({
      status: 'published',
      postId: '12345_67890',
      scheduledPublishTime: null,
      reasonCode: null,
    })
  })

  it('classifies a duplicate as published with ALREADY_ON_RECEIPT', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { skipped_as_duplicate: [{ date }] },
    })
    expect(outcome).toEqual({
      status: 'published',
      postId: null,
      scheduledPublishTime: null,
      reasonCode: 'ALREADY_ON_RECEIPT',
    })
  })

  it('prefers a real published entry over a duplicate marker', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: {
        receipt: { published: [{ date, post_id: '12345_67890' }], failed: [] },
        skipped_as_duplicate: [{ date }],
      },
    })
    expect(outcome.status).toBe('published')
    expect(outcome).toMatchObject({ postId: '12345_67890', reasonCode: null })
  })

  it('classifies a missed window', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [], failed: [{ date, error: MISSED_WINDOW_ERROR }] } },
    })
    expect(outcome).toEqual({ status: 'missed_window', reasonCode: 'MISSED_WINDOW' })
  })

  it('classifies a rejected failure as retryable with the first backoff', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'boom', certainty: 'rejected' }] } },
    })
    expect(outcome).toEqual({
      status: 'failed_retryable',
      reasonCode: 'PROVIDER_REJECTED',
      nextRetryAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    })
  })

  it('uses the second backoff on attempt 2', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 2,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'boom', certainty: 'rejected' }] } },
    })
    expect(outcome).toEqual({
      status: 'failed_retryable',
      reasonCode: 'PROVIDER_REJECTED',
      nextRetryAt: new Date(now.getTime() + 20 * 60_000).toISOString(),
    })
  })

  it('becomes failed_final on the third attempt', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 3,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'boom', certainty: 'rejected' }] } },
    })
    expect(outcome).toEqual({ status: 'failed_final', reasonCode: 'PROVIDER_REJECTED' })
  })

  it('classifies a rate-limited failure with its own reason code', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'slow down', certainty: 'rate_limited' }] } },
    })
    expect(outcome).toEqual({
      status: 'failed_retryable',
      reasonCode: 'PROVIDER_RATE_LIMITED',
      nextRetryAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    })
  })

  it('treats a missing certainty as unknown_outcome', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'boom' }] } },
    })
    expect(outcome).toEqual({ status: 'unknown_outcome', reasonCode: 'PROVIDER_OUTCOME_UNKNOWN' })
  })

  it('treats an unrecognised certainty as unknown_outcome', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'boom', certainty: 'maybe' }] } },
    })
    expect(outcome).toEqual({ status: 'unknown_outcome', reasonCode: 'PROVIDER_OUTCOME_UNKNOWN' })
  })

  it('classifies a 500 receipt-not-persisted with a published entry as published', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 500,
      attemptNo: 1,
      now,
      body: {
        error: 'PUBLISH_RECEIPT_NOT_PERSISTED',
        receipt: { published: [{ date, post_id: '12345_67890' }], failed: [] },
      },
    })
    expect(outcome).toEqual({
      status: 'published',
      postId: '12345_67890',
      scheduledPublishTime: null,
      reasonCode: 'RECEIPT_NOT_PERSISTED',
    })
  })

  it('classifies a 500 receipt-not-persisted without a published entry as unknown', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 500,
      attemptNo: 1,
      now,
      body: { error: 'PUBLISH_RECEIPT_NOT_PERSISTED', receipt: { published: [], failed: [] } },
    })
    expect(outcome).toEqual({ status: 'unknown_outcome', reasonCode: 'RECEIPT_NOT_PERSISTED' })
  })

  it('classifies a 409 as blocked with the body error code', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 409,
      attemptNo: 1,
      now,
      body: { error: 'PLAN_CHANGED' },
    })
    expect(outcome).toEqual({ status: 'blocked', reasonCode: 'PLAN_CHANGED' })
  })

  it('falls back to HTTP_<status> when the error is missing or empty', () => {
    expect(classifyRunResult({ date, httpStatus: 409, attemptNo: 1, now, body: {} })).toEqual({
      status: 'blocked',
      reasonCode: 'HTTP_409',
    })
    expect(classifyRunResult({ date, httpStatus: 503, attemptNo: 1, now, body: { error: '' } })).toEqual({
      status: 'blocked',
      reasonCode: 'HTTP_503',
    })
    expect(classifyRunResult({ date, httpStatus: 503, attemptNo: 1, now, body: { error: 42 } })).toEqual({
      status: 'blocked',
      reasonCode: 'HTTP_503',
    })
  })

  it('classifies a 200 with nothing about this date as unknown', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 1,
      now,
      body: { receipt: { published: [{ date: '2026-09-05', post_id: 'x' }], failed: [] } },
    })
    expect(outcome).toEqual({ status: 'unknown_outcome', reasonCode: 'NO_RESULT_FOR_DATE' })
  })

  it('never throws on a garbage body', () => {
    const garbage: Record<string, unknown>[] = [
      {},
      { receipt: null },
      { receipt: 'nope' },
      { receipt: { published: 'nope', failed: 42 } },
      { receipt: { published: [null, 7, 'x'], failed: [{}] } },
      { skipped_as_duplicate: 'nope' },
      { skipped_as_duplicate: [null, { date: 7 }] },
      { error: null },
    ]
    for (const body of garbage) {
      expect(() => classifyRunResult({ date, httpStatus: 200, attemptNo: 1, now, body })).not.toThrow()
      expect(() => classifyRunResult({ date, httpStatus: 500, attemptNo: 1, now, body })).not.toThrow()
      expect(() => classifyRunResult({ date, httpStatus: 409, attemptNo: 1, now, body })).not.toThrow()
    }
  })

  it('uses the first backoff when attemptNo is below 1', () => {
    const outcome = classifyRunResult({
      date,
      httpStatus: 200,
      attemptNo: 0,
      now,
      body: { receipt: { published: [], failed: [{ date, error: 'boom', certainty: 'rejected' }] } },
    })
    expect(outcome).toEqual({
      status: 'failed_retryable',
      reasonCode: 'PROVIDER_REJECTED',
      nextRetryAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    })
  })
})

describe('classifyRunResult — aborted before send', () => {
  it('🔴 a last-moment refusal is a block (nothing was sent), not a failure to retry or an unknown outcome', () => {
    const outcome = classifyRunResult({
      date: '2026-10-13',
      httpStatus: 200,
      body: { receipt: { published: [], failed: [{ date: '2026-10-13', error: 'ABORTED_BEFORE_SEND', certainty: 'rejected' }] } },
      attemptNo: 1,
      now: new Date('2026-10-12T00:00:00Z'),
    })
    expect(outcome).toEqual({ status: 'blocked', reasonCode: 'ABORTED_BEFORE_SEND' })
  })
})

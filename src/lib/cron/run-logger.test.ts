/**
 * Tests for resolveCronStatus — "did this run actually accomplish anything?"
 *
 * These exist because three cron jobs sat `completed` for weeks while doing
 * nothing. anomaly-detector-daily is the worst case: 30 consecutive runs from
 * 2026-07-03 to 2026-07-31, every one status='completed', every one
 * processed=0 / failed_count=1, with "column clients.status does not exist"
 * buried inside the summary JSON. The watchdog digest reports failures, so it
 * reported nothing, for a month.
 *
 * The regression these tests lock down is therefore not "does the happy path
 * work" but "can that exact shape ever be recorded as success again".
 */

import { describe, it, expect } from 'vitest'
import { resolveCronStatus } from './run-logger'

describe('resolveCronStatus', () => {
  describe('the shape that hid a month-long outage', () => {
    it('fails the exact anomaly-detector-daily row: processed=0, failed=1, no error string', () => {
      // Reproduced verbatim from cron_run_logs on 2026-07-31.
      const verdict = resolveCronStatus({ processed: 0, failed: 1, error: undefined })

      expect(verdict.status).toBe('failed')
      expect(verdict.errorMessage).toBeDefined()
    })

    it('fails that same row even when the job forgot to declare expectsWork', () => {
      // Belt and braces: the failed>0 && processed===0 rule is independent of
      // the declaration, so a job that never opts in is still caught.
      const verdict = resolveCronStatus({
        processed: 0,
        failed: 1,
        expectsWork: undefined,
      })

      expect(verdict.status).toBe('failed')
    })

    it('fails a declared job that processed nothing and recorded no failure either', () => {
      // The subtler variant: the query returns an empty list rather than an
      // error, so nothing is counted as failed. Silent blindness.
      const verdict = resolveCronStatus({ processed: 0, failed: 0, expectsWork: true })

      expect(verdict.status).toBe('failed')
      expect(verdict.errorMessage).toContain('expectsWork')
    })
  })

  describe('sweepers legitimately idle at zero', () => {
    it('passes processed=0 when the job did not declare expectsWork', () => {
      const verdict = resolveCronStatus({ processed: 0, failed: 0, expectsWork: false })

      expect(verdict.status).toBe('completed')
      expect(verdict.errorMessage).toBeUndefined()
    })

    it('passes processed=0 for a legacy job with no declaration at all', () => {
      // Not a blanket rule — this is why the fix is opt-in per job rather than
      // "zero is always failure", which would have turned every sweeper red.
      const verdict = resolveCronStatus({ processed: 0, failed: 0 })

      expect(verdict.status).toBe('completed')
    })
  })

  describe('normal operation', () => {
    it('passes a declared job that did work', () => {
      const verdict = resolveCronStatus({ processed: 8, failed: 0, expectsWork: true })

      expect(verdict.status).toBe('completed')
    })

    it('passes partial success: some work done, some failures', () => {
      // 7 of 8 clients scanned is a real run with a real problem, not a blind
      // one. It stays `completed` and surfaces via failed_count.
      const verdict = resolveCronStatus({ processed: 7, failed: 1, expectsWork: true })

      expect(verdict.status).toBe('completed')
    })

    it('always fails when an explicit error was thrown, work or not', () => {
      const verdict = resolveCronStatus({ processed: 8, failed: 0, error: 'boom' })

      expect(verdict.status).toBe('failed')
      expect(verdict.errorMessage).toBe('boom')
    })

    it('keeps the original error text rather than replacing it', () => {
      const verdict = resolveCronStatus({
        processed: 0,
        failed: 1,
        error: 'Step 1 failed: connection reset',
        expectsWork: true,
      })

      expect(verdict.errorMessage).toBe('Step 1 failed: connection reset')
    })
  })

  /**
   * MUTATION TESTS
   *
   * Each case below states the mutation it kills. If you weaken the guard in
   * the way described, the paired assertion must go red — that is the evidence
   * these tests are load-bearing rather than decorative.
   */
  describe('mutation guards', () => {
    it('kills "drop the expectsWork branch": declared + zero must not be completed', () => {
      // Deleting rule 2 in resolveCronStatus makes this return 'completed'.
      expect(resolveCronStatus({ processed: 0, failed: 0, expectsWork: true }).status).toBe(
        'failed'
      )
    })

    it('kills "drop the failed>0 && processed===0 branch"', () => {
      // Deleting rule 3 makes this return 'completed' — the exact regression.
      expect(resolveCronStatus({ processed: 0, failed: 3 }).status).toBe('failed')
    })

    it('kills "make zero always fail": an undeclared idle sweeper must stay green', () => {
      // Replacing the rules with a blanket `processed === 0 → failed` makes
      // this return 'failed' and turns every sweeper red.
      expect(resolveCronStatus({ processed: 0, failed: 0 }).status).toBe('completed')
    })

    it('kills "expectsWork also fails when work was done"', () => {
      // Inverting the condition to `processed > 0` makes this return 'failed'.
      expect(resolveCronStatus({ processed: 1, failed: 0, expectsWork: true }).status).toBe(
        'completed'
      )
    })

    it('kills "swallow the error string": an error must never be reported completed', () => {
      expect(resolveCronStatus({ processed: 99, failed: 0, error: 'x' }).status).toBe('failed')
    })
  })
})

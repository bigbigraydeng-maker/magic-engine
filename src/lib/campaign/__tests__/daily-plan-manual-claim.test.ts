import { describe, expect, it } from 'vitest'

import { manualAttemptPatch } from '../daily-plan-manual-claim'

const DATE = '2026-11-09'
const plain = { restoreRecalled: false }

describe('manualAttemptPatch', () => {
  it('a post on the receipt closes the claim as published, with its post id', () => {
    const patch = manualAttemptPatch(DATE, { published: [{ date: DATE, post_id: '123_456', scheduled_publish_time: '2026-11-09T05:00:00.000Z' }], failed: [] }, plain)
    expect(patch).toEqual({
      status: 'published',
      reason_code: 'MANUAL_PUBLISH',
      post_id: '123_456',
      scheduled_publish_time: '2026-11-09T05:00:00.000Z',
      provider_impact: 'FB_SCHEDULED',
      next_retry_at: null,
    })
  })

  it('a refusal that proves nothing went out closes as failed_final', () => {
    for (const certainty of ['rejected', 'rate_limited']) {
      expect(manualAttemptPatch(DATE, { published: [], failed: [{ date: DATE, certainty }] }, plain)).toEqual({
        status: 'failed_final',
        reason_code: 'MANUAL_REJECTED',
        next_retry_at: null,
      })
    }
  })

  it('a recalled date that did not go out goes back to being recalled, so the sweep never republishes it', () => {
    expect(manualAttemptPatch(DATE, { published: [], failed: [{ date: DATE, certainty: 'rejected' }] }, { restoreRecalled: true })).toEqual({
      status: 'blocked',
      reason_code: 'RECALLED',
      next_retry_at: null,
    })
  })

  it('a recalled date that did go out is published, not put back', () => {
    const patch = manualAttemptPatch(DATE, { published: [{ date: DATE, post_id: '1_2' }] }, { restoreRecalled: true })
    expect(patch.status).toBe('published')
  })

  it('anything it cannot prove is unknown_outcome', () => {
    const unknown = { status: 'unknown_outcome', reason_code: 'MANUAL_UNKNOWN', next_retry_at: null }
    expect(manualAttemptPatch(DATE, null, plain)).toEqual(unknown)
    expect(manualAttemptPatch(DATE, undefined, plain)).toEqual(unknown)
    expect(manualAttemptPatch(DATE, { published: [], failed: [] }, plain)).toEqual(unknown)
    expect(manualAttemptPatch(DATE, { published: [], failed: [{ date: DATE, certainty: 'unknown' }] }, plain)).toEqual(unknown)
    expect(manualAttemptPatch(DATE, { published: [], failed: [{ date: DATE }] }, plain)).toEqual(unknown)
    expect(manualAttemptPatch(DATE, { published: [{ date: DATE }], failed: [] }, plain)).toEqual(unknown)
    expect(manualAttemptPatch(DATE, { published: [{ date: '2026-11-10', post_id: '9_9' }] }, plain)).toEqual(unknown)
  })
})

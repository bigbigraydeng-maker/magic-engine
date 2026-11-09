import { describe, expect, it } from 'vitest'
import { detectSocialCircuitBreaker, type SocialCircuitBreakerFailure } from './circuit-breaker'
import { REEL_AUTO_CHECK_KEYS } from './content-review'

const now = '2026-09-29T00:00:00.000Z'
const fail: SocialCircuitBreakerFailure = {
  sourceKey: 'producer:job-1',
  occurredAt: '2026-09-28T00:00:00.000Z',
  checks: [{
    key: REEL_AUTO_CHECK_KEYS[0],
    judge: 'AUTO',
    outcome: 'FAIL',
    detail: 'audio missing',
    source_ref: null,
  }],
}

describe('detectSocialCircuitBreaker', () => {
  it('trips after two measured A-class failures for the same source in the configured window', () => {
    expect(detectSocialCircuitBreaker({
      sourceKey: 'producer:job-1',
      failures: [fail, { ...fail, occurredAt: '2026-09-27T00:00:00.000Z' }],
      windowDays: 7,
      now,
    })).toMatchObject({ tripped: true, rule: 'repeat_a_class_failure' })
  })

  it('does not trip on one failure, another source, stale events, or NOT_MEASURED checks', () => {
    expect(detectSocialCircuitBreaker({ sourceKey: 'producer:job-1', failures: [fail], windowDays: 7, now }))
      .toEqual({ tripped: false })
    expect(detectSocialCircuitBreaker({ sourceKey: 'producer:job-1', failures: [
      { ...fail, sourceKey: 'producer:job-2' },
      { ...fail, occurredAt: '2026-09-10T00:00:00.000Z' },
      { ...fail, checks: [{ ...fail.checks[0], outcome: 'NOT_MEASURED' }] },
    ], windowDays: 7, now })).toEqual({ tripped: false })
  })
})

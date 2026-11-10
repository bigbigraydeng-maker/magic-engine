import { describe, expect, it } from 'vitest'
import { jobById, staleThresholdHours } from '../agent-jobs'
import {
  evaluateIntradaySpendSampleStall,
  intradaySpendSampleStallShouldAlert,
  intradaySpendSampleStallWhat,
  lastSuccessfulIntradaySpendSampleAt,
} from '../intraday-spend-sample-stall'

const NOW = new Date('2026-11-10T12:00:00.000Z')

describe('intraday spend sample stall threshold', () => {
  it('defaults to 60 minutes', () => {
    const job = jobById('intraday_spend_sample')
    expect(staleThresholdHours(job)).toBe(1)
  })
})

describe('evaluateIntradaySpendSampleStall', () => {
  it('recent success → no alert', () => {
    const recent = new Date(NOW.getTime() - 20 * 60_000).toISOString()
    const finding = evaluateIntradaySpendSampleStall(
      [{ status: 'completed', finished_at: recent, started_at: recent }],
      NOW,
    )
    expect(finding).toBeNull()
    expect(intradaySpendSampleStallShouldAlert(finding)).toBe(false)
  })

  it('no success in lookback → finding', () => {
    const finding = evaluateIntradaySpendSampleStall([], NOW)
    expect(finding?.jobId).toBe('intraday_spend_sample')
    expect(intradaySpendSampleStallShouldAlert(finding)).toBe(true)
    expect(intradaySpendSampleStallWhat(finding!).length).toBeGreaterThan(10)
  })

  it('stalled when last success older than threshold', () => {
    const old = new Date(NOW.getTime() - 90 * 60_000).toISOString()
    const finding = evaluateIntradaySpendSampleStall(
      [
        { status: 'failed', finished_at: NOW.toISOString(), started_at: NOW.toISOString() },
        { status: 'completed', finished_at: old, started_at: old },
      ],
      NOW,
    )
    expect(finding?.hoursSince).toBeGreaterThan(1)
    expect(intradaySpendSampleStallShouldAlert(finding)).toBe(true)
  })

  it('picks newest completed run', () => {
    const runs = [
      { status: 'failed', finished_at: '2026-11-10T11:00:00Z', started_at: '' },
      { status: 'completed', finished_at: '2026-11-10T10:00:00Z', started_at: '' },
      { status: 'completed', finished_at: '2026-11-10T09:00:00Z', started_at: '' },
    ]
    expect(lastSuccessfulIntradaySpendSampleAt(runs)).toBe('2026-11-10T10:00:00Z')
  })
})

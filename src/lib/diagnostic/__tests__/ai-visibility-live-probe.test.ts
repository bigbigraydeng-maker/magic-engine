import { describe, it, expect, vi } from 'vitest'
import { runProbeWithTimeout } from '../ai-visibility-live-probe'
import type { LiveProbe } from '../ai-visibility-live-probe'

const INPUT = { clientId: 'client-1', brandName: 'Test Brand' }

describe('runProbeWithTimeout — skip_kind must distinguish attempt failures', () => {
  it('marks a timed-out probe as skip_kind=attempt_failed, not not_configured', async () => {
    vi.useFakeTimers()
    try {
      const probe: LiveProbe = { run: () => new Promise(() => {}) } // never resolves
      const resultPromise = runProbeWithTimeout(probe, INPUT, 1_000)
      await vi.advanceTimersByTimeAsync(1_000)
      const result = await resultPromise

      expect(result.skipped).toBe(true)
      expect(result.skip_kind).toBe('attempt_failed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a probe that rejects as skip_kind=attempt_failed, not not_configured', async () => {
    const probe: LiveProbe = { run: () => Promise.reject(new Error('boom')) }
    const result = await runProbeWithTimeout(probe, INPUT, 1_000)

    expect(result.skipped).toBe(true)
    expect(result.skip_kind).toBe('attempt_failed')
  })

  it('leaves skip_kind unset when the probe resolves normally', async () => {
    const probe: LiveProbe = {
      run: () =>
        Promise.resolve({
          runs: 1,
          measured_runs: 1,
          failed_runs: 0,
          mentions: 1,
          avg_rank: 1,
          questions: [],
          latency_ms: 5,
          skipped: false,
        }),
    }
    const result = await runProbeWithTimeout(probe, INPUT, 1_000)

    expect(result.skipped).toBe(false)
    expect(result.skip_kind).toBeUndefined()
  })
})

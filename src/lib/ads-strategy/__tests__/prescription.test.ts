/**
 * Tests for the prescription layer — P21.K.6
 *
 * The cause→remedy mapping IS the product: prescribing the wrong remedy for
 * the diagnosed cause (e.g. "refresh creatives" for audience fatigue) wastes
 * the client's money on the wrong fix. Lock the mapping.
 */

import { describe, it, expect } from 'vitest'
import { prescribe } from '../prescription'
import type { MetricVerdict } from '../baseline'

function ctrMetric(verdict: 'alert' | 'watch' | 'healthy'): MetricVerdict {
  return { metric: 'ctr', verdict, baseline: 0.042, recent: 0.03, ratio: 0.71, reason: 'x' }
}
function cprMetric(verdict: 'alert' | 'watch' | 'healthy' | 'insufficient_history'): MetricVerdict {
  return { metric: 'cost_per_result', verdict, baseline: 10, recent: 16, ratio: 1.6, reason: 'x' }
}

describe('prescribe — cause→remedy mapping', () => {
  it('CTR decay + LOW frequency → refresh creatives (executable)', () => {
    // The real Reborn case: freq 1.12, CTR down 28% — creative went stale.
    const p = prescribe({ verdict: 'alert', metrics: [ctrMetric('alert'), cprMetric('insufficient_history')], frequency_7d: 1.12 })
    expect(p?.kind).toBe('refresh_creatives')
    expect(p?.executable).toBe(true)
  })

  it('CTR decay + HIGH frequency → rotate audience (advisory, NOT executable)', () => {
    const p = prescribe({ verdict: 'alert', metrics: [ctrMetric('alert')], frequency_7d: 3.1 })
    expect(p?.kind).toBe('rotate_audience')
    expect(p?.executable).toBe(false)
  })

  it('cost blowup with healthy CTR → review offer (advisory)', () => {
    const p = prescribe({ verdict: 'alert', metrics: [ctrMetric('healthy'), cprMetric('alert')], frequency_7d: 1.2 })
    expect(p?.kind).toBe('review_offer')
    expect(p?.executable).toBe(false)
  })

  it('unknown frequency defaults to creative refresh when CTR decays', () => {
    // No freq data → can't claim audience fatigue → the safe, cheap remedy.
    const p = prescribe({ verdict: 'watch', metrics: [ctrMetric('watch')], frequency_7d: null })
    expect(p?.kind).toBe('refresh_creatives')
  })

  it('prescribes nothing for healthy / paused / insufficient', () => {
    expect(prescribe({ verdict: 'healthy', metrics: [ctrMetric('healthy')], frequency_7d: 1 })).toBeNull()
    expect(prescribe({ verdict: 'paused', metrics: [], frequency_7d: null })).toBeNull()
    expect(prescribe({ verdict: 'insufficient_history', metrics: [], frequency_7d: null })).toBeNull()
  })

  it('always speaks plain language (no internal jargon in PM-facing text)', () => {
    const p = prescribe({ verdict: 'alert', metrics: [ctrMetric('alert')], frequency_7d: 1.1 })!
    for (const text of [p.title, p.why, p.execute_hint ?? '']) {
      expect(text).not.toMatch(/CTR|CPL|frequency|winner[-_]?sync/i)
    }
  })
})

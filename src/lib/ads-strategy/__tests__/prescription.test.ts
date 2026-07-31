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

describe('no fictional third party — ME does it, or you click (板桥)', () => {
  // The ads-health page went live on 2026-07-27 still saying "需要团队判断".
  // In ME's world there are exactly two actors: "ME 会…" and "要你点一下".
  // A "团队" the PM knows does not exist reads as "nobody owns this".
  const CASES: PrescribeInput[] = [
    { verdict: 'alert', frequency_7d: 3.0, metrics: [
      { metric: 'ctr', verdict: 'alert', baseline: 0.02, recent: 0.01, ratio: 0.5, reason: '' }] },
    { verdict: 'alert', frequency_7d: 1.2, metrics: [
      { metric: 'ctr', verdict: 'alert', baseline: 0.02, recent: 0.01, ratio: 0.5, reason: '' }] },
    { verdict: 'alert', frequency_7d: 1.2, metrics: [
      { metric: 'cost_per_result', verdict: 'alert', baseline: 20, recent: 33, ratio: 1.6, reason: '' }] },
    { verdict: 'watch', frequency_7d: null, metrics: [] },
  ]

  it('never mentions a 团队 in anything the PM reads', () => {
    for (const input of CASES) {
      const p = prescribe(input)
      if (!p) continue
      const surface = `${p.title} ${p.why} ${p.execute_hint ?? ''}`
      expect(surface, `case ${p.kind}`).not.toContain('团队')
    }
  })

  it('an advisory prescription still points at something doable today', () => {
    // "系统不自动动" on its own is a dead end. Every non-executable remedy must
    // name the money control, which works without any creative supply.
    for (const input of CASES) {
      const p = prescribe(input)
      if (!p || p.executable) continue
      expect(`${p.why} ${p.execute_hint ?? ''}`, `case ${p.kind}`).toMatch(/降预算|先停|按住/)
    }
  })
})

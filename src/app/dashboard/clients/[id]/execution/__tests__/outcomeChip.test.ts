/**
 * OutcomeChip display logic — P12.A.10
 *
 * Tests for formatOutcomeLabel: the pure function that builds the chip text
 * displayed on execution item cards ("✅ Mention rate +25%, confirmed (confidence 0.80)").
 */

import { describe, it, expect } from 'vitest'
import { formatOutcomeLabel } from '../page'

type OutcomeSummary = Parameters<typeof formatOutcomeLabel>[0]

const base: OutcomeSummary = {
  verdict: 'confirmed',
  metric_key: 'geo.query.mention_rate',
  delta: 0.25,
  delta_pct: 25,
  confidence: 0.8,
  computed_at: '2026-05-17T00:00:00Z',
}

describe('formatOutcomeLabel', () => {
  it('confirmed with delta_pct — full label', () => {
    const label = formatOutcomeLabel(base)
    expect(label).toBe('Mention rate +25%, confirmed (confidence 0.80)')
  })

  it('reversed with negative delta_pct', () => {
    const label = formatOutcomeLabel({
      ...base,
      verdict: 'reversed',
      delta_pct: -12,
      delta: -0.12,
      confidence: 0.6,
    })
    expect(label).toBe('Mention rate -12%, reversed (confidence 0.60)')
  })

  it('inconclusive with small delta', () => {
    const label = formatOutcomeLabel({
      ...base,
      verdict: 'inconclusive',
      delta_pct: 1,
      confidence: 0.2,
    })
    expect(label).toBe('Mention rate +1%, inconclusive (confidence 0.20)')
  })

  it('falls back to delta when delta_pct is null', () => {
    const label = formatOutcomeLabel({
      ...base,
      delta_pct: null,
      delta: 0.07,
    })
    expect(label).toBe('Mention rate +0.07, confirmed (confidence 0.80)')
  })

  it('no delta at all — label still renders', () => {
    const label = formatOutcomeLabel({
      ...base,
      delta_pct: null,
      delta: null,
    })
    expect(label).toBe('Mention rate confirmed (confidence 0.80)')
  })

  it('unknown metric_key falls back to raw key', () => {
    const label = formatOutcomeLabel({
      ...base,
      metric_key: 'geo.custom.unknown_metric',
    })
    expect(label).toContain('geo.custom.unknown_metric')
  })

  it('rounds delta_pct to nearest integer', () => {
    const label = formatOutcomeLabel({ ...base, delta_pct: 25.7 })
    expect(label).toContain('+26%')
  })

  it('negative delta shows minus sign without double-negative', () => {
    const label = formatOutcomeLabel({ ...base, delta_pct: -5.3, verdict: 'reversed', confidence: 0.5 })
    expect(label).toContain('-5%')
    expect(label).not.toContain('+-')
  })
})

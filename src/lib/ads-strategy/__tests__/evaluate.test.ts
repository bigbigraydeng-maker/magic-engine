/**
 * Tests for the payload assembly — P21.K.2
 *
 * evaluateClientAdHealth's DB glue is thin; the logic worth locking down is
 * buildNarrativePayload: worst-first ordering, overall verdict rollup, and the
 * "see it yourself" CTR strip.
 */

import { describe, it, expect } from 'vitest'
import { buildNarrativePayload } from '../evaluate'

interface Row {
  entity_id: string
  entity_name: string | null
  insight_date: string
  ctr: number | null
  cost_per_result: number | null
  results: number | null
  spend: number | null
  impressions: number | null
  frequency_7d: number | null
}

function series(id: string, name: string, ctrs: number[], startDay = 1): Row[] {
  return ctrs.map((ctr, i) => ({
    entity_id: id,
    entity_name: name,
    insight_date: `2026-07-${String(startDay + i).padStart(2, '0')}`,
    ctr,
    cost_per_result: null,
    results: 2,
    spend: 80,
    impressions: 5000,
    frequency_7d: i === ctrs.length - 1 ? 1.2 : null,
  }))
}

function grouped(...lists: Row[][]): Map<string, Row[]> {
  const m = new Map<string, Row[]>()
  for (const list of lists) m.set(list[0].entity_id, list)
  return m
}

const HEALTHY = Array.from({ length: 21 }, () => 0.03)
const COLLAPSED = [...Array.from({ length: 14 }, () => 0.04), ...Array.from({ length: 7 }, () => 0.02)]

describe('buildNarrativePayload', () => {
  it('rolls overall verdict up to the worst campaign', () => {
    const p = buildNarrativePayload(
      grouped(series('a', 'Healthy', HEALTHY), series('b', 'Fatigued', COLLAPSED)),
      '2026-07-21',
    )
    expect(p.overall_verdict).toBe('alert')
  })

  it('orders campaigns worst-first so the reader leads with what needs action', () => {
    const p = buildNarrativePayload(
      grouped(series('a', 'Healthy', HEALTHY), series('b', 'Fatigued', COLLAPSED)),
      '2026-07-21',
    )
    expect(p.campaigns[0].campaign_name).toBe('Fatigued')
    expect(p.campaigns[0].verdict).toBe('alert')
    expect(p.campaigns[1].verdict).toBe('healthy')
  })

  it('says all-healthy in plain language when nothing is wrong', () => {
    const p = buildNarrativePayload(
      grouped(series('a', 'A', HEALTHY), series('b', 'B', HEALTHY)),
      '2026-07-21',
    )
    expect(p.overall_verdict).toBe('healthy')
    expect(p.headline).toContain('全部健康')
  })

  it('carries the last 7 raw CTRs for the see-it-yourself strip', () => {
    const p = buildNarrativePayload(grouped(series('a', 'A', HEALTHY)), '2026-07-21')
    expect(p.campaigns[0].ctr_series).toHaveLength(7)
    expect(p.campaigns[0].ctr_series.at(-1)?.date).toBe('2026-07-21')
  })

  it('picks up the latest non-null frequency_7d from the sparse column', () => {
    const p = buildNarrativePayload(grouped(series('a', 'A', HEALTHY)), '2026-07-21')
    expect(p.campaigns[0].frequency_7d).toBe(1.2)
  })

  it('reports insufficient_history when every campaign is too new', () => {
    const short = series('a', 'A', Array.from({ length: 8 }, () => 0.03))
    const p = buildNarrativePayload(grouped(short), '2026-07-08')
    expect(p.overall_verdict).toBe('insufficient_history')
    expect(p.headline).toContain('积累')
  })

  it('sums 7-day spend and results for the header line', () => {
    const p = buildNarrativePayload(grouped(series('a', 'A', HEALTHY)), '2026-07-21')
    // 7 days × $80 spend, 7 days × 2 results.
    expect(p.campaigns[0].latest_spend_7d).toBe(560)
    expect(p.campaigns[0].latest_results_7d).toBe(14)
  })
})

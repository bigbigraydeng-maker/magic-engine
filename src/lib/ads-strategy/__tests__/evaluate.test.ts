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

  // ── Stopped campaigns (real incident: 5 stopped Oztop campaigns showed their
  //    pre-stop week as "近 7 天" spend. PM 2026-07-23) ────────────────────────

  it('marks a long-stopped campaign as paused with ZERO recent spend', () => {
    // Data ends 2026-07-08; evaluating as of 2026-07-21 (13 days later).
    const stopped = series('a', 'Stopped', Array.from({ length: 8 }, () => 0.03))
    const p = buildNarrativePayload(grouped(stopped), '2026-07-21')
    const c = p.campaigns[0]
    expect(c.verdict).toBe('paused')
    // The old bug: this showed $640 (its final 8 rows). Must be the REAL last
    // 7 calendar days — which contain nothing.
    expect(c.latest_spend_7d).toBe(0)
    expect(c.latest_results_7d).toBe(0)
    expect(c.headline).toContain('已停投')
  })

  it('does not let paused campaigns drag the account verdict or the count', () => {
    const stopped = series('a', 'Stopped', Array.from({ length: 8 }, () => 0.03))
    const live = series('b', 'Live', HEALTHY)
    const p = buildNarrativePayload(grouped(stopped, live), '2026-07-21')
    expect(p.overall_verdict).toBe('healthy')
    expect(p.headline).toContain('在投的 1 条广告全部健康')
    expect(p.headline).toContain('另 1 条已停投')
  })

  it('sorts paused campaigns to the bottom', () => {
    const stopped = series('a', 'Stopped', Array.from({ length: 8 }, () => 0.03))
    const live = series('b', 'Live', HEALTHY)
    const p = buildNarrativePayload(grouped(stopped, live), '2026-07-21')
    expect(p.campaigns[0].campaign_name).toBe('Live')
    expect(p.campaigns[1].verdict).toBe('paused')
  })

  it('keeps a briefly-lagging campaign (2 days without data) judged, not paused', () => {
    // Data ends 2026-07-19, evaluating 2026-07-21 → within the 3-day grace.
    const lagging = series('a', 'Lagging', Array.from({ length: 19 }, () => 0.03))
    const p = buildNarrativePayload(grouped(lagging), '2026-07-21')
    expect(p.campaigns[0].verdict).not.toBe('paused')
  })

  it('windows 近7天 by calendar days, not by last-7-rows', () => {
    // 19 daily rows ending 2026-07-19, evaluated as of 2026-07-21: the real
    // last-7-calendar-day window (7/15–7/21) holds only 5 data days.
    const lagging = series('a', 'Lagging', Array.from({ length: 19 }, () => 0.03))
    const p = buildNarrativePayload(grouped(lagging), '2026-07-21')
    expect(p.campaigns[0].latest_spend_7d).toBe(400)  // 5 × $80, not 7 × $80
  })
})

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

  it('flips to paused at exactly 3 full days without data (the boundary)', () => {
    // Data ends 2026-07-18, evaluated 2026-07-21 → 3 whole days missing → paused.
    // Locks the `<` comparison: a slip to `<=` or an off-by-one in the shift
    // would move this boundary and pass the other two (2-day / 13-day) tests.
    const atBoundary = series('a', 'Boundary', Array.from({ length: 18 }, () => 0.03))
    const p = buildNarrativePayload(grouped(atBoundary), '2026-07-21')
    expect(p.campaigns[0].verdict).toBe('paused')
  })

  it('says all-stopped, not "data accumulating", when every campaign is paused', () => {
    const stopped = series('a', 'Stopped', Array.from({ length: 8 }, () => 0.03))
    const p = buildNarrativePayload(grouped(stopped), '2026-07-21')
    expect(p.headline).toContain('都已停投')
    expect(p.headline).not.toContain('积累')
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

/**
 * 评估日从「UTC 的昨天」改成「广告账户时区的昨天」之后（2026-09-24），
 * PAUSED_AFTER_DAYS = 3 的行为必须原样不变。
 *
 * 为什么要单独钉：修之前取数窗口和评估日**都**按 UTC 算，两边同步偏移所以停投判定
 * 是对的（实测 2026-09-22 那天 7 条广告里 2 条判 paused，它俩最后花钱都是 09-16，
 * 确是真停投）。这次把评估日往后挪一天，如果数据侧没有同样挪，这个平衡就会被打破，
 * 在投广告会被误判成停投——那正是 PM 2026-09-24 授权的自动收放回路最贵的错误方向。
 */
describe('评估日改按账户时区之后的停投判定', () => {
  /** 连续 n 天、最后一天是 endDay 的日数据（9 月）。 */
  function daysEnding(id: string, name: string, endDay: number, n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({
      entity_id: id,
      entity_name: name,
      insight_date: `2026-09-${String(endDay - n + 1 + i).padStart(2, '0')}`,
      ctr: 0.03,
      cost_per_result: null,
      results: 2,
      spend: 80,
      impressions: 5000,
      frequency_7d: i === n - 1 ? 1.2 : null,
    }))
  }

  const NZ_DAY  = '2026-09-23'   // 奥克兰账户的「昨天」（cron 17:00 UTC 触发时）
  const UTC_DAY = '2026-09-22'   // 同一刻 UTC 的「昨天」——修复前用的那一天

  it('在投广告：数据和评估日一起前移一天，仍然判在投，而且看得到最新那一天', () => {
    const live = buildNarrativePayload(grouped(daysEnding('a', 'Live', 23, 21)), NZ_DAY)
    expect(live.campaigns[0].verdict).not.toBe('paused')
    expect(live.campaigns[0].ctr_series.at(-1)?.date).toBe('2026-09-23')

    // 修复前：同一批数据按 UTC 的昨天评估，09-23 那天存了也看不到。
    const stale = buildNarrativePayload(grouped(daysEnding('a', 'Live', 23, 21)), UTC_DAY)
    expect(stale.campaigns[0].ctr_series.at(-1)?.date).toBe('2026-09-22')
  })

  it('真停投的仍判停投：最后花钱 09-16，评估日 09-23（生产实测的那两条）', () => {
    const stopped = buildNarrativePayload(grouped(daysEnding('a', 'Stopped', 16, 10)), NZ_DAY)
    expect(stopped.campaigns[0].verdict).toBe('paused')
    expect(stopped.campaigns[0].headline).toContain('2026-09-16')
  })

  it('宽限期没被吃掉：数据比评估日晚 1 天 / 2 天都还不算停投，第 3 天才算', () => {
    const verdictFor = (lastDay: number) =>
      buildNarrativePayload(grouped(daysEnding('a', 'Lagging', lastDay, 20)), NZ_DAY).campaigns[0].verdict

    expect(verdictFor(22)).not.toBe('paused')   // 落后 1 天（某个账户当天还没写进来）
    expect(verdictFor(21)).not.toBe('paused')   // 落后 2 天
    expect(verdictFor(20)).toBe('paused')       // 落后 3 天 —— 边界仍在原处
  })
})

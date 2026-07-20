/**
 * Tests for the relative-baseline fatigue engine — P21.K.2
 *
 * The centrepiece is a REGRESSION against the real Reborn daily CTR series that
 * absolute thresholds missed. If the engine ever stops flagging that decay,
 * these fail.
 */

import { describe, it, expect } from 'vitest'
import { judgeCampaign, DailyPoint, DEFAULT_BASELINE_CONFIG } from '../baseline'

/** Build a DailyPoint with only the fields a given test cares about. */
function pt(date: string, ctr: number | null, cpr: number | null = null): DailyPoint {
  return {
    insight_date: date,
    ctr,
    cost_per_result: cpr,
    results: cpr != null ? 1 : 0,
    spend: 80,
    impressions: 5000,
  }
}

/**
 * Real Reborn CTR per day (fraction), pulled 2026-07-20 via Meta MCP
 * (time_increment=1, campaign 120247480862390307). This is the exact series
 * the PM watched degrade and paused by hand.
 */
const REBORN_CTR: Array<[string, number]> = [
  ['2026-06-24', 0.0418], ['2026-06-25', 0.0347], ['2026-06-26', 0.0436],
  ['2026-06-27', 0.0429], ['2026-06-28', 0.0422], ['2026-06-29', 0.0406],
  ['2026-06-30', 0.0373], ['2026-07-01', 0.0323], ['2026-07-02', 0.0370],
  ['2026-07-03', 0.0323], ['2026-07-04', 0.0352], ['2026-07-05', 0.0361],
  ['2026-07-06', 0.0312], ['2026-07-07', 0.0282], ['2026-07-08', 0.0441],
  ['2026-07-09', 0.0341], ['2026-07-10', 0.0283], ['2026-07-11', 0.0322],
  ['2026-07-12', 0.0293], ['2026-07-13', 0.0246], ['2026-07-14', 0.0254],
  ['2026-07-15', 0.0307], ['2026-07-16', 0.0303], ['2026-07-17', 0.0294],
  ['2026-07-18', 0.0304], ['2026-07-19', 0.0318], ['2026-07-20', 0.0250],
]

function rebornSeriesUpTo(date: string): DailyPoint[] {
  return REBORN_CTR.filter(([d]) => d <= date).map(([d, ctr]) => pt(d, ctr))
}

describe('judgeCampaign — Reborn regression (the fatigue absolute lines missed)', () => {
  it('flags the decay by 2026-07-13, which the absolute lines never did', () => {
    const v = judgeCampaign(rebornSeriesUpTo('2026-07-13'))
    // Absolute lines (freq>2.5, CTR<2%) never fired across this whole series.
    // The relative engine must at least be worried here.
    expect(['watch', 'alert']).toContain(v.verdict)
    const ctr = v.metrics.find(m => m.metric === 'ctr')!
    expect(ctr.baseline).toBeGreaterThan(ctr.recent!)   // recent below own peak
  })

  it('is calm at the healthy peak (late June), not crying wolf', () => {
    const v = judgeCampaign(rebornSeriesUpTo('2026-07-01'))
    // First two weeks are the campaign at full strength — must not alert.
    expect(v.verdict).not.toBe('alert')
  })

  it('names CTR (not frequency) as the failing metric — creative, not audience', () => {
    const v = judgeCampaign(rebornSeriesUpTo('2026-07-13'))
    const worst = v.metrics.find(m => m.verdict === v.verdict)
    expect(worst?.metric).toBe('ctr')
    expect(v.headline).toContain('点击率')
  })

  it('escalates the sustained watch to a red alert by the full series (3 days before the manual pause)', () => {
    // The median holds the drop just above the one-shot alert line, but a
    // watch that never recovers for a week must escalate — the PM felt it was
    // bad enough to pause by hand on 7/20; the engine says red from 7/17.
    const v = judgeCampaign(rebornSeriesUpTo('2026-07-20'))
    expect(v.verdict).toBe('alert')
    expect(v.headline).toContain('持续一周以上')
  })
})

describe('judgeCampaign — core behaviour', () => {
  it('returns insufficient_history below the minimum day count', () => {
    const short = Array.from({ length: 10 }, (_, i) =>
      pt(`2026-07-${String(i + 1).padStart(2, '0')}`, 0.03))
    expect(judgeCampaign(short).verdict).toBe('insufficient_history')
  })

  it('stays healthy when CTR holds near its own peak', () => {
    const flat = Array.from({ length: 20 }, (_, i) =>
      pt(`2026-07-${String(i + 1).padStart(2, '0')}`, 0.03))
    expect(judgeCampaign(flat).verdict).toBe('healthy')
  })

  it('alerts on a clear 30%+ CTR collapse from the campaign peak', () => {
    // 14 strong days at 4%, then 7 days at 2.5% (down ~38%).
    const points: DailyPoint[] = []
    for (let i = 1; i <= 14; i++) points.push(pt(`2026-07-${String(i).padStart(2, '0')}`, 0.04))
    for (let i = 15; i <= 21; i++) points.push(pt(`2026-07-${String(i).padStart(2, '0')}`, 0.025))
    const v = judgeCampaign(points)
    expect(v.verdict).toBe('alert')
    expect(v.metrics.find(m => m.metric === 'ctr')!.ratio).toBeLessThan(0.70)
  })

  it('alerts when cost-per-result climbs 40%+ from the cheapest week', () => {
    const points: DailyPoint[] = []
    for (let i = 1; i <= 14; i++) points.push(pt(`2026-07-${String(i).padStart(2, '0')}`, 0.03, 10))
    for (let i = 15; i <= 21; i++) points.push(pt(`2026-07-${String(i).padStart(2, '0')}`, 0.03, 16))
    const v = judgeCampaign(points)
    expect(v.verdict).toBe('alert')
    expect(v.metrics.find(m => m.metric === 'cost_per_result')!.verdict).toBe('alert')
  })

  it('does not judge cost-per-result when the campaign has no results history', () => {
    // 20 days of CTR but zero results (e.g. a pure ThruPlay pool) → CPR insufficient,
    // but CTR still judged.
    const points = Array.from({ length: 20 }, (_, i) =>
      pt(`2026-07-${String(i + 1).padStart(2, '0')}`, 0.03, null))
    const v = judgeCampaign(points)
    const cpr = v.metrics.find(m => m.metric === 'cost_per_result')!
    expect(cpr.verdict).toBe('insufficient_history')
    expect(v.verdict).not.toBe('insufficient_history') // CTR carried it
  })

  it('does not false-alarm on sparse cost-per-result (one cheap early day)', () => {
    // A messaging/ThruPlay-style campaign: results only some days. One cheap
    // early conversion ($2) must NOT become a baseline floor that makes every
    // later $8 look like a 4× blowup. Windowing over dense days prevents this.
    const points: DailyPoint[] = []
    for (let i = 1; i <= 21; i++) {
      const day = `2026-07-${String(i).padStart(2, '0')}`
      // results only every 3rd day; one very cheap conversion on day 1.
      const cpr = i === 1 ? 2 : i % 3 === 0 ? 8 : null
      points.push(pt(day, 0.03, cpr))
    }
    const cprVerdict = judgeCampaign(points).metrics.find(m => m.metric === 'cost_per_result')!
    // Steady $8 with one $2 outlier should read healthy or insufficient — never alert.
    expect(cprVerdict.verdict).not.toBe('alert')
  })

  it('will not paint a zero-click campaign green', () => {
    // 20 days of impressions, never a click → CTR baseline is 0 → can't judge.
    const points = Array.from({ length: 20 }, (_, i) =>
      pt(`2026-07-${String(i + 1).padStart(2, '0')}`, 0))
    const ctr = judgeCampaign(points).metrics.find(m => m.metric === 'ctr')!
    expect(ctr.verdict).toBe('insufficient_history')
  })

  it('reports the worst of the two metrics', () => {
    const points: DailyPoint[] = []
    // CTR healthy (flat 3%), CPR collapses (10 → 18)
    for (let i = 1; i <= 14; i++) points.push(pt(`2026-07-${String(i).padStart(2, '0')}`, 0.03, 10))
    for (let i = 15; i <= 21; i++) points.push(pt(`2026-07-${String(i).padStart(2, '0')}`, 0.03, 18))
    expect(judgeCampaign(points).verdict).toBe('alert')
  })

  it('sorts an out-of-order series before judging', () => {
    const points = [
      pt('2026-07-21', 0.025), pt('2026-07-01', 0.04), pt('2026-07-10', 0.04),
      pt('2026-07-05', 0.04), pt('2026-07-15', 0.025), pt('2026-07-03', 0.04),
      pt('2026-07-07', 0.04), pt('2026-07-09', 0.04), pt('2026-07-12', 0.04),
      pt('2026-07-14', 0.04), pt('2026-07-16', 0.025), pt('2026-07-17', 0.025),
      pt('2026-07-18', 0.025), pt('2026-07-19', 0.025), pt('2026-07-20', 0.025),
      pt('2026-07-02', 0.04), pt('2026-07-04', 0.04), pt('2026-07-06', 0.04),
      pt('2026-07-08', 0.04), pt('2026-07-11', 0.04), pt('2026-07-13', 0.04),
    ]
    // Recent week (15-21) is 0.025, peak week is 0.04 → down 37.5% → alert.
    expect(judgeCampaign(points).verdict).toBe('alert')
  })
})

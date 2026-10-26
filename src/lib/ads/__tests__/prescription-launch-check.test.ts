import { describe, expect, it } from 'vitest'
import {
  judgeLaunch, linesForCard, matchLaunch, planOutcomeWrites, UNSAVED_CASE_LINE,
  type InsightRef, type KpiRef, type LaunchRef, type PlanRef, type PrescriptionRef, type SiblingRef,
} from '../prescription-launch-check'

const RX = 'rx-1'
const GOAL = 'goal-1'
const CAMP = 'camp-1'
const LAUNCH = '2026-10-26T07:40:00.000Z'

function prescription(over: Partial<PrescriptionRef> = {}): PrescriptionRef {
  return { id: RX, goalId: GOAL, status: 'approved', approvedAt: '2026-10-26T07:20:00.000Z', ...over }
}

function launch(over: Partial<LaunchRef> = {}): LaunchRef {
  return { id: 'act-1', clientId: 'client-1', authorizedAt: LAUNCH, campaignId: CAMP, ...over }
}

function plan(over: Partial<PlanRef> = {}): PlanRef {
  return { goalId: GOAL, approvedAt: '2026-10-26T07:10:00.000Z', ...over }
}

function sibling(over: Partial<SiblingRef> = {}): SiblingRef {
  return { id: RX, approvedAt: '2026-10-26T07:20:00.000Z', ...over }
}

const kpis: KpiRef[] = [
  { metric: '线索', target: 10, unit: '条' },
  { metric: '成本', target: 12, unit: 'NZD' },
]

function day(over: Partial<InsightRef> = {}): InsightRef {
  return { insightDate: '2026-10-27', spend: 96, results: 12, ...over }
}

function matched(now: string, insights: InsightRef[] = [day()], targets: KpiRef[] = kpis) {
  const found = matchLaunch({
    prescription: prescription(),
    launches: [launch()],
    plans: [plan()],
    siblings: [sibling()],
    missingCampaign: false,
  })
  if (found.kind !== 'matched') throw new Error(found.kind)
  return judgeLaunch({ launch: found.launch, insights, kpis: targets, now: new Date(now) })
}

function sentence(now: string, label: string, insights?: InsightRef[], targets?: KpiRef[]): string {
  const line = matched(now, insights, targets).checkpoints.find(point => point.sentence.startsWith(label))
  return line?.sentence ?? ''
}

describe('prescription launch check', () => {
  it('says 还不知道 when nothing has gone live', () => {
    const match = matchLaunch({
      prescription: prescription({ status: 'draft', approvedAt: null }),
      launches: [],
      plans: [],
      siblings: [],
      missingCampaign: false,
    })
    expect(match.kind).toBe('not_launched')
    if (match.kind === 'not_launched') expect(match.lines).toEqual(['还没对上已开投的广告，所以还不知道。'])
  })

  it('keeps every checkpoint as 还不知道 before 24 hours', () => {
    const view = matched('2026-10-27T07:39:59.999Z')
    expect(view.lines.every(line => line.includes('还不知道'))).toBe(true)
    expect(view.lines[0]).toContain('开投后还没满 24 小时')
    expect(planOutcomeWrites(view.checkpoints, [])).toEqual([])
  })

  it('says 不知道 at 24 hours when the daily rows are missing', () => {
    const early = sentence('2026-10-27T08:40:00.000Z', '24 小时', [])
    const later = sentence('2026-10-27T08:40:00.000Z', '48 小时', [])
    expect(early).toContain('不知道')
    expect(early).toContain('开投后还没有这一条广告的每日花费和线索')
    expect(later).toContain('还不知道')
    expect(later).toContain('开投后还没满 48 小时')
  })

  it('says 达标 when leads are above target and cost is under target', () => {
    const view = matched('2026-11-02T00:00:00.000Z')
    const day7 = view.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')
    expect(day7).toMatchObject({ due: true, verdict: 'met' })
    expect(day7?.sentence).toContain('达标')
    expect(day7?.sentence).toContain('线索 12 条，目标 10 条')
    expect(day7?.sentence).toContain('单条成本 8 NZD，目标 12 NZD')
    expect(view.checkpoints.find(point => point.kpiMetric === 'launch_check_day14')?.verdict).toBe('pending')
  })

  it('says 没达标 when leads are below target', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', [day({ results: 3 })])
    expect(line).toContain('没达标')
    expect(line).toContain('线索 3 条，目标 10 条')
  })

  it('does not treat a null spend as zero', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', [day({ spend: null })])
    expect(line).toContain('不知道')
    expect(line).toContain('不能当成 0')
    expect(line).not.toContain('达标')
    expect(line).not.toContain('单条成本 0')
  })

  it('keeps a real zero-lead miss and refuses a cost made from zero leads', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', [day({ spend: 20, results: 0 })])
    expect(line).toContain('没达标')
    expect(line).toContain('线索 0 条，目标 10 条')
    expect(line).toContain('线索是 0，算不出单条成本')
    expect(line).not.toContain('单条成本 0')
  })

  it('does not call a gap 达标', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', [day()], [
      ...kpis,
      { metric: '曝光', target: 100, unit: '' },
    ])
    expect(line).toContain('不知道')
    expect(line).toContain('有一个指标认不出来：曝光')
    expect(line).not.toContain('达标')
  })

  it('counts launch day as day 1 in New Zealand', () => {
    const onTheDay = matched('2026-10-31T11:00:00.000Z')
    const before = matched('2026-10-31T10:59:00.000Z')
    expect(onTheDay.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')?.due).toBe(true)
    expect(before.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')?.due).toBe(false)
    const nextCalendarDay = judgeLaunch({
      launch: launch({ authorizedAt: '2026-10-26T11:00:00.000Z' }),
      insights: [day({ insightDate: '2026-10-27' })],
      kpis,
      now: new Date('2026-11-01T10:59:00.000Z'),
    })
    expect(nextCalendarDay.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')?.due).toBe(false)
  })

  it('does not pick one ad when two live ads match', () => {
    const match = matchLaunch({
      prescription: prescription(),
      launches: [launch(), launch({ id: 'act-2', campaignId: 'camp-2' })],
      plans: [plan()],
      siblings: [sibling()],
      missingCampaign: false,
    })
    expect(match.kind).toBe('unmatched')
    if (match.kind === 'unmatched') expect(match.lines[0]).toContain('对上了不止一条已开投的广告')
  })

  it('keeps the prescription that was passed later', () => {
    const shared = {
      launches: [launch()],
      plans: [plan()],
      siblings: [
        sibling({ id: 'older', approvedAt: '2026-10-26T07:00:00.000Z' }),
        sibling(),
      ],
      missingCampaign: false,
    }
    expect(matchLaunch({
      ...shared,
      prescription: prescription({ id: 'older', approvedAt: '2026-10-26T07:00:00.000Z' }),
    }).kind).toBe('unmatched')
    expect(matchLaunch({ ...shared, prescription: prescription() }).kind).toBe('matched')
  })

  it('stops when two prescriptions passed at the same time', () => {
    const match = matchLaunch({
      prescription: prescription(),
      launches: [launch()],
      plans: [plan()],
      siblings: [sibling(), sibling({ id: 'other' })],
      missingCampaign: false,
    })
    expect(match.kind).toBe('unmatched')
    if (match.kind === 'unmatched') expect(match.lines[0]).toContain('同一时间通过了不止一份处方')
  })

  it('does not use a plan for a different goal', () => {
    const match = matchLaunch({
      prescription: prescription(),
      launches: [launch()],
      plans: [plan({ goalId: 'other-goal' })],
      siblings: [sibling()],
      missingCampaign: false,
    })
    expect(match.kind).toBe('unmatched')
    if (match.kind === 'unmatched') expect(match.lines[0]).toContain('对不上这份处方')
  })

  it('says the check is not stored when there is no case row', () => {
    const view = matched('2026-11-02T00:00:00.000Z')
    expect(linesForCard(view, false)).toContain(UNSAVED_CASE_LINE)
    expect(linesForCard(view, true)).not.toContain(UNSAVED_CASE_LINE)
    expect(view.checkpoints.find(point => point.verdict === 'met')?.sentence).not.toContain('案例行')
  })

  it('does not overwrite a stored met or missed row', () => {
    const view = matched('2026-11-02T00:00:00.000Z', [day({ results: 3 })])
    const writes = planOutcomeWrites(view.checkpoints, [
      { id: 'old', kpiMetric: 'launch_check_day7', unit: 'met', dimension: '旧结论' },
    ])
    expect(writes.some(write => write.kpiMetric === 'launch_check_day7')).toBe(false)
  })

  it('updates an unknown row when the verdict becomes met', () => {
    const view = matched('2026-11-02T00:00:00.000Z')
    const writes = planOutcomeWrites(view.checkpoints, [
      { id: 'old', kpiMetric: 'launch_check_24h', unit: 'unknown', dimension: '旧缺口' },
    ])
    expect(writes).toContainEqual(expect.objectContaining({
      op: 'update',
      id: 'old',
      kpiMetric: 'launch_check_24h',
      unit: 'met',
    }))
  })
})

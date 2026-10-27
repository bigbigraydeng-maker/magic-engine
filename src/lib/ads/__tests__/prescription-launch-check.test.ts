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

// One row per NZ day from launch day (2026-10-26); only the first day carries numbers.
function series(first: Partial<InsightRef> = {}, through = '2026-11-01'): InsightRef[] {
  const out: InsightRef[] = []
  const cursor = new Date('2026-10-26T00:00:00Z')
  while (cursor.toISOString().slice(0, 10) <= through) {
    const insightDate = cursor.toISOString().slice(0, 10)
    out.push(out.length === 0
      ? { insightDate, spend: 96, results: 12, ...first }
      : { insightDate, spend: 0, results: 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const NZ_ZONE = 'Pacific/Auckland'

function matched(now: string, insights: InsightRef[] = series(), targets: KpiRef[] = kpis) {
  const found = matchLaunch({
    prescription: prescription(),
    launches: [launch()],
    plans: [plan()],
    siblings: [sibling()],
    missingCampaign: false,
  })
  if (found.kind !== 'matched') throw new Error(found.kind)
  return judgeLaunch({ launch: found.launch, insights, kpis: targets, now: new Date(now), accountTimezone: NZ_ZONE })
}

// Launch exactly at NZ midnight (2026-10-26 00:00 NZDT), so 24h / 48h line up with whole days.
const MIDNIGHT_LAUNCH = '2026-10-25T11:00:00.000Z'

function judgeAtMidnight(now: string, insights: InsightRef[], targets: KpiRef[] = kpis, zone: string | null = NZ_ZONE) {
  return judgeLaunch({
    launch: launch({ authorizedAt: MIDNIGHT_LAUNCH }), insights, kpis: targets, now: new Date(now), accountTimezone: zone,
  })
}

function sentence(now: string, label: string, insights?: InsightRef[], targets?: KpiRef[]): string {
  const line = matched(now, insights, targets).checkpoints.find(point => point.sentence.startsWith(label))
  return line?.sentence ?? ''
}

/** First day keeps `first`; later days are 0 when a number was read, otherwise still unread. */
function viewsOn(rows: InsightRef[], first: number | null): InsightRef[] {
  return fillColumn(rows, 'videoThruplays', first)
}

function conversationsOn(rows: InsightRef[], first: number | null): InsightRef[] {
  return fillColumn(rows, 'messagingConversations', first)
}

function fillColumn(
  rows: InsightRef[],
  key: 'videoThruplays' | 'messagingConversations',
  first: number | null,
): InsightRef[] {
  return rows.map((row, index) => ({
    ...row,
    [key]: index === 0 ? first : (typeof first === 'number' ? 0 : null),
  }))
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
    const view = judgeAtMidnight('2026-10-27T08:40:00.000Z', [])
    const early = view.lines[0]
    const later = view.lines[1]
    expect(early).toContain('不知道')
    expect(early).toContain('缺 1 天的每日数据：2026-10-26')
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
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', series({ results: 3 }))
    expect(line).toContain('没达标')
    expect(line).toContain('线索 3 条，目标 10 条')
  })

  it('reads 对话数 from conversations and 看完数 from video views', () => {
    const personalKpis: KpiRef[] = [
      { metric: '私信对话数', target: 10, unit: '个' },
      { metric: '看完数', target: 10, unit: '次' },
    ]
    const rows = conversationsOn(viewsOn(series({ results: 20 }), 40), 12)
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', rows, personalKpis)
    expect(line).toContain('达标')
    expect(line).toContain('对话数 12 个，目标 10 个')
    expect(line).toContain('看完数 40 次，目标 10 次')
    expect(line).not.toContain('对话数 20')
    expect(line).not.toContain('看完数 12')
    expect(line).not.toContain('看完数 20')
    expect(line).not.toContain('认不出来')
  })

  it('judges 看完数 from video views when there are views and no leads', () => {
    const line = sentence(
      '2026-11-02T00:00:00.000Z', '第 7 天',
      viewsOn(series({ results: 0, spend: 20 }), 40),
      [{ metric: '看完数', target: 10, unit: '次' }],
    )
    expect(line).toContain('达标')
    expect(line).toContain('看完数 40 次，目标 10 次')
    expect(line).not.toContain('看完数 0')
    expect(line).not.toContain('没达标')
  })

  it('says 不知道 when video views were not read, and does not substitute leads', () => {
    const line = sentence(
      '2026-11-02T00:00:00.000Z', '第 7 天',
      viewsOn(series({ results: 50 }), null),
      [{ metric: '视频看完数', target: 10, unit: '次' }],
    )
    expect(line).toContain('不知道')
    expect(line).toContain('看完数是空的，不能当成 0')
    expect(line).not.toContain('看完数 50')
    expect(line).not.toContain('看完数 0')
    expect(line).not.toContain('没达标')
  })

  it('still judges 线索 from results when video views are present', () => {
    const line = sentence(
      '2026-11-02T00:00:00.000Z', '第 7 天', viewsOn(series({ results: 3 }), 100),
    )
    expect(line).toContain('没达标')
    expect(line).toContain('线索 3 条，目标 10 条')
    expect(line).not.toContain('看完数')
  })

  it('says 没达标 when 对话数 is under target', () => {
    const line = sentence(
      '2026-11-02T00:00:00.000Z', '第 7 天',
      conversationsOn(series({ results: 20 }), 3),
      [{ metric: '对话数', target: 10, unit: '个' }],
    )
    expect(line).toContain('没达标')
    expect(line).toContain('对话数 3 个，目标 10 个')
    expect(line).not.toContain('对话数 20')
  })

  it('does not count 20 leads as 20 conversations when only 2 conversations were read', () => {
    const line = sentence(
      '2026-11-02T00:00:00.000Z', '第 7 天',
      conversationsOn(series({ results: 20 }), 2),
      [{ metric: '私信对话数', target: 10, unit: '个' }],
    )
    expect(line).toContain('没达标')
    expect(line).toContain('对话数 2 个，目标 10 个')
    expect(line).not.toContain('对话数 20')
    expect(line).not.toMatch(/第 7 天：达标/)
  })

  it('says 不知道 when conversations were not read, and does not substitute leads', () => {
    const line = sentence(
      '2026-11-02T00:00:00.000Z', '第 7 天',
      conversationsOn(series({ results: 20 }), null),
      [{ metric: '对话数', target: 10, unit: '个' }],
    )
    expect(line).toContain('不知道')
    expect(line).toContain('对话数是空的，不能当成 0')
    expect(line).not.toContain('对话数 20')
    expect(line).not.toContain('对话数 0')
    expect(line).not.toContain('没达标')
  })

  it('does not treat a null spend as zero', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', series({ spend: null }))
    expect(line).toContain('不知道')
    expect(line).toContain('不能当成 0')
    expect(line).not.toContain('达标')
    expect(line).not.toContain('单条成本 0')
  })

  it('keeps a real zero-lead miss and refuses a cost made from zero leads', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', series({ spend: 20, results: 0 }))
    expect(line).toContain('没达标')
    expect(line).toContain('线索 0 条，目标 10 条')
    expect(line).toContain('线索是 0，算不出单条成本')
    expect(line).not.toContain('单条成本 0')
  })

  it('does not call a gap 达标', () => {
    const line = sentence('2026-11-02T00:00:00.000Z', '第 7 天', series(), [
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
      accountTimezone: NZ_ZONE,
    })
    expect(nextCalendarDay.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')?.due).toBe(false)
  })

  it('judges each early checkpoint on its own window when the run is late', () => {
    const rows = series({ spend: 20, results: 2 }, '2026-11-01')
    rows[rows.length - 1] = { insightDate: '2026-11-01', spend: 100, results: 20 }
    const leadsOnly: KpiRef[] = [{ metric: '线索', target: 10, unit: '条' }]
    const view = judgeAtMidnight('2026-11-20T00:00:00.000Z', rows, leadsOnly)
    const by = (metric: string) => view.checkpoints.find(point => point.kpiMetric === metric)
    expect(by('launch_check_24h')).toMatchObject({ verdict: 'missed' })
    expect(by('launch_check_24h')?.sentence).toContain('线索 2 条')
    expect(by('launch_check_48h')).toMatchObject({ verdict: 'missed' })
    expect(by('launch_check_48h')?.sentence).toContain('线索 2 条')
    expect(by('launch_check_day7')).toMatchObject({ verdict: 'met' })
    expect(by('launch_check_day7')?.sentence).toContain('线索 22 条')
  })

  it('says 不知道 and names the days when a day row is missing', () => {
    const view = matched('2026-11-02T00:00:00.000Z', [series()[0]])
    const day7 = view.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')
    expect(day7?.verdict).toBe('unknown')
    expect(day7?.sentence).toContain('缺 6 天的每日数据：2026-10-27')
    expect(day7?.sentence).toContain('2026-11-01')
    expect(day7?.sentence).not.toContain('达标')
    expect(view.checkpoints.find(point => point.kpiMetric === 'launch_check_24h')?.verdict).toBe('unknown')
  })

  it('says 不知道 for 24h / 48h when launch is not at NZ midnight, even with leads above target on later days', () => {
    // Launch 2026-10-26 20:40 NZDT; 24h deadline is 2026-10-27 20:40 NZDT.
    const rows: InsightRef[] = [
      { insightDate: '2026-10-26', spend: 20, results: 2 },
      { insightDate: '2026-10-27', spend: 100, results: 20 },
      { insightDate: '2026-10-28', spend: 0, results: 0 },
    ]
    const leadsOnly: KpiRef[] = [{ metric: '线索', target: 10, unit: '条' }]
    const view = matched('2026-10-29T00:00:00.000Z', rows, leadsOnly)
    const by = (metric: string) => view.checkpoints.find(point => point.kpiMetric === metric)
    for (const metric of ['launch_check_24h', 'launch_check_48h']) {
      expect(by(metric)).toMatchObject({ due: true, verdict: 'unknown' })
      expect(by(metric)?.sentence).toContain('整点零点')
      expect(by(metric)?.sentence).not.toContain('没达标')
    }
    expect(planOutcomeWrites(view.checkpoints, []).every(write => write.unit === 'unknown')).toBe(true)
  })

  it('does not call a window 达标 when the last day is not synced yet', () => {
    const rows = series({}, '2026-10-31')
    const day7 = matched('2026-11-01T00:00:00.000Z', rows).checkpoints
      .find(point => point.kpiMetric === 'launch_check_day7')
    expect(day7).toMatchObject({ due: true, verdict: 'unknown' })
    expect(day7?.sentence).toContain('缺 1 天的每日数据：2026-11-01')
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
    const view = matched('2026-11-02T00:00:00.000Z', series({ results: 3 }))
    const writes = planOutcomeWrites(view.checkpoints, [
      { id: 'old', kpiMetric: 'launch_check_day7', unit: 'met', dimension: '旧结论' },
    ])
    expect(writes.some(write => write.kpiMetric === 'launch_check_day7')).toBe(false)
  })

  it('updates an unknown row when the verdict becomes met', () => {
    const view = matched('2026-11-02T00:00:00.000Z')
    const writes = planOutcomeWrites(view.checkpoints, [
      { id: 'old', kpiMetric: 'launch_check_day7', unit: 'unknown', dimension: '旧缺口' },
    ])
    expect(writes).toContainEqual(expect.objectContaining({
      op: 'update',
      id: 'old',
      kpiMetric: 'launch_check_day7',
      unit: 'met',
    }))
  })

  it('says 不知道 for every due checkpoint when the ad account is not on NZ time', () => {
    // Brisbane account: 12 leads sit on its 10-25 row, which the NZ window would otherwise drop.
    const rows: InsightRef[] = [
      { insightDate: '2026-10-25', spend: 96, results: 12 },
      { insightDate: '2026-10-26', spend: 0, results: 0 },
    ]
    const leadsOnly: KpiRef[] = [{ metric: '线索', target: 10, unit: '条' }]
    for (const zone of ['Australia/Brisbane', null]) {
      const view = judgeAtMidnight('2026-11-02T00:00:00.000Z', rows, leadsOnly, zone)
      for (const point of view.checkpoints) {
        expect(point).toMatchObject({ due: true, verdict: 'unknown' })
        expect(point.sentence).toContain('不能下结论')
        expect(point.sentence).not.toContain('没达标')
      }
      expect(view.checkpoints[0].sentence).toContain(zone ?? '读不到广告账户的时区')
      expect(planOutcomeWrites(view.checkpoints, []).every(write => write.unit === 'unknown')).toBe(true)
    }
  })
})

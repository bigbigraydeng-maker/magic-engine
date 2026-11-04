import { describe, expect, it } from 'vitest'
import {
  judgeLaunch, kpisFromContent, launchKpiKind,
  type InsightRef, type KpiRef, type LaunchRef,
} from '../prescription-launch-check'

const NZ_ZONE = 'Pacific/Auckland'
// Launch exactly at NZ midnight (2026-10-26 00:00 NZDT), so day windows line up with whole days.
const MIDNIGHT_LAUNCH = '2026-10-25T11:00:00.000Z'

function launch(over: Partial<LaunchRef> = {}): LaunchRef {
  return { id: 'act-1', clientId: 'client-1', authorizedAt: MIDNIGHT_LAUNCH, campaignId: 'camp-1', ...over }
}

// One row per NZ day from launch day (2026-10-26); only the first day carries numbers.
function series(first: Partial<InsightRef> = {}, through = '2026-11-01'): InsightRef[] {
  const out: InsightRef[] = []
  const cursor = new Date('2026-10-26T00:00:00Z')
  while (cursor.toISOString().slice(0, 10) <= through) {
    const insightDate = cursor.toISOString().slice(0, 10)
    out.push(out.length === 0
      ? { insightDate, spend: 0, results: 0, ...first }
      : { insightDate, spend: 0, results: 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

function kpi(metric: string, target: number | null, unit: string, timeframe: string): KpiRef {
  return { metric, target, unit, timeframe }
}

const COST_LINE = kpi(
  '一条线索的成本，继续线 $12 = 目标线索成本 C（按当前数据算，第 7 天重算）',
  12, 'NZD', '最近 7 天',
)
const PAUSE_LINE = kpi(
  '一条线索的成本，暂停线 $16 = $12 × 1.33，高于它就停这组',
  16, 'NZD', '最近 7 天',
)
const LEADS_TOTAL = kpi(
  '新增留资（客人填表留下联系方式，11-30 考核）',
  300, '条', '2026-10-25 至 2026-11-30',
)
const DAILY_CAP = kpi(
  '每天花费节奏上限 $102.8 = $3,700 ÷ 36 天',
  102.8, 'NZD', '每天',
)
const SPEND_TOTAL = kpi(
  '整个周期总花费上限（超了先问 Ray）',
  3700, 'NZD', '2026-10-25 至 2026-11-30',
)
const BREAK_EVEN = kpi(
  '报名保本线 3 单 = …（只作参考）',
  3, '单', '2026-12-31 结算',
)

const SIX = [COST_LINE, PAUSE_LINE, LEADS_TOTAL, DAILY_CAP, SPEND_TOTAL, BREAK_EVEN]

function day7(kpis: KpiRef[], insights: InsightRef[]) {
  const view = judgeLaunch({
    launch: launch(),
    insights,
    kpis,
    now: new Date('2026-11-02T00:00:00.000Z'),
    accountTimezone: NZ_ZONE,
  })
  return view.checkpoints.find(point => point.kpiMetric === 'launch_check_day7')
}

describe('launchKpiKind', () => {
  it('reads the six marketing-plan prose targets', () => {
    expect(launchKpiKind(COST_LINE)).toBe('cost')
    expect(launchKpiKind(PAUSE_LINE)).toBe('cost')
    expect(launchKpiKind(LEADS_TOTAL)).toBe('out_of_scope')
    expect(launchKpiKind(DAILY_CAP)).toBe('out_of_scope')
    expect(launchKpiKind(SPEND_TOTAL)).toBe('out_of_scope')
    expect(launchKpiKind(BREAK_EVEN)).toBe('out_of_scope')
  })

  it('keeps exact words as leads even with a whole-period timeframe', () => {
    expect(launchKpiKind(kpi('线索', 10, '条', '2026-10-25 至 2026-11-30'))).toBe('leads')
  })

  it('leaves an unknown prose metric as other', () => {
    expect(launchKpiKind(kpi('曝光次数', 1000, '次', '最近 7 天'))).toBe('other')
  })
})

describe('kpisFromContent', () => {
  it('reads timeframe and defaults to empty when missing', () => {
    const kpis = kpisFromContent({
      kpi_targets: [
        { metric: '线索', target_value: 10, unit: '条', timeframe: ' 最近 7 天 ' },
        { metric: '成本', target_value: 12, unit: 'NZD' },
      ],
    })
    expect(kpis).toEqual([
      { metric: '线索', target: 10, unit: '条', timeframe: '最近 7 天' },
      { metric: '成本', target: 12, unit: 'NZD', timeframe: '' },
    ])
  })
})

describe('day-7 with prose KPIs', () => {
  it('says 达标 when cost is under both lines and notes the out-of-scope targets', () => {
    const point = day7(SIX, series({ spend: 546, results: 105 }))
    expect(point).toMatchObject({ due: true, verdict: 'met' })
    expect(point?.sentence).toContain('达标')
    expect(point?.sentence).toContain('单条成本 5.2 NZD，目标 12 NZD')
    expect(point?.sentence).toContain('另有 4 项')
  })

  it('says 没达标 when cost is above the $12 line', () => {
    const point = day7(SIX, series({ spend: 1400, results: 100 }))
    expect(point).toMatchObject({ due: true, verdict: 'missed' })
    expect(point?.sentence).toContain('没达标')
    expect(point?.sentence).toContain('单条成本 14 NZD，目标 12 NZD')
  })

  it('says 不知道 when a prose metric is unrecognized, even with good cost numbers', () => {
    const point = day7(
      [kpi('曝光次数', 1000, '次', '最近 7 天'), COST_LINE],
      series({ spend: 546, results: 105 }),
    )
    expect(point).toMatchObject({ due: true, verdict: 'unknown' })
    expect(point?.sentence).toContain('有一个指标认不出来')
    expect(point?.sentence).toContain('曝光次数')
  })
})

describe('复审 P1/P2：长句目标不许假达标', () => {
  const k = (metric: string, unit: string, timeframe: string) => ({ metric, target: 20, unit, timeframe })
  it('比例、上限、筛选过的线索不当成线索条数', () => {
    expect(launchKpiKind(k('无效线索占比 ≤20%', '%', '最近 7 天'))).toBe('other')
    expect(launchKpiKind(k('线索回复率 ≥50%', '%', '最近 7 天'))).toBe('other')
    expect(launchKpiKind(k('合格线索（已报价）5 条', '条', '最近 7 天'))).toBe('other')
    expect(launchKpiKind(k('新增留资 50 条', '条', '最近 7 天'))).toBe('leads')
  })
  it('「至少」「至今」不算日期范围；认不出的长句不会被藏到检查之外', () => {
    expect(launchKpiKind(k('曝光次数至少 1 万', '次', '至少每周'))).toBe('other')
    expect(launchKpiKind(k('曝光次数', '次', '2026-10-25 至 2026-11-30'))).toBe('other')
    expect(launchKpiKind(k('每天花费节奏上限', 'NZD', '每天'))).toBe('out_of_scope')
  })
})

describe('复审 P1：条数目标只在窗口天数对上时比', () => {
  const LEADS_7D = kpi('新增留资 50 条', 50, '条', '最近 7 天')
  function judgeAt(label: string, kpis: KpiRef[], rows: InsightRef[]) {
    return judgeLaunch({ launch: launch(), insights: rows, kpis, now: new Date('2026-11-20T00:00:00Z'), accountTimezone: NZ_ZONE })
      .checkpoints.find(point => point.sentence.startsWith(label))
  }
  it('第 7 天：7 天的条数目标照比', () => {
    const point = judgeAt('第 7 天', [LEADS_7D], series({ spend: 100, results: 30 }))
    expect(point).toMatchObject({ verdict: 'missed' })
  })
  it('第 14 天：14 天累计不拿去比 7 天的目标（不许假达标）', () => {
    const point = judgeAt('第 14 天', [LEADS_7D], series({ spend: 100, results: 60 }, '2026-11-08'))
    expect(point?.verdict).not.toBe('met')
    expect(point?.sentence).toContain('时间范围跟这个时间点对不上')
  })
})

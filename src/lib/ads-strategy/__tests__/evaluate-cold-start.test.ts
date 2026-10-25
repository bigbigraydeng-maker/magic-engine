/** 冷启动按目标成本判：历史不满 14 天时，花费与单次成本都超过 2× 目标 → alert；没配目标不判。 */
import { describe, expect, it } from 'vitest'
import { buildNarrativePayload, campaignGoalFor, coldStartAlert, primaryCountOf } from '../evaluate'

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
  primary_results?: number | null
}

const TARGET = 11

function coldRows(totalSpend: number, totalResults: number): Map<string, Row[]> {
  const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
    entity_id: 'cold',
    entity_name: 'Cold',
    insight_date: `2026-07-${String(7 + i).padStart(2, '0')}`,
    ctr: 0.02,
    cost_per_result: totalResults > 0 ? totalSpend / totalResults : null,
    results: totalResults / 5,
    primary_results: totalResults / 5,
    spend: totalSpend / 5,
    impressions: 3000,
    frequency_7d: null,
  }))
  return new Map([['cold', rows]])
}

const verdictOf = (spend: number, results: number, target: number | null) =>
  buildNarrativePayload(coldRows(spend, results), '2026-07-11', undefined, null, target).campaigns[0].verdict

describe('冷启动按目标成本判（历史不满 14 天）', () => {
  it('花费 ≥ 2× 目标且 0 结果 → alert，头条写冷启动', () => {
    const p = buildNarrativePayload(coldRows(160, 0), '2026-07-11', undefined, null, TARGET)
    expect(p.campaigns[0].verdict).toBe('alert')
    expect(p.campaigns[0].headline).toContain('冷启动')
    expect(p.campaigns[0].prescription).toBeNull()
    expect(p.overall_verdict).toBe('alert')
  })

  it('单次成本 > 2× 目标 → alert', () => {
    expect(verdictOf(280, 10, TARGET)).toBe('alert')
  })

  it('单次成本在 2× 目标以内 → 仍是数据积累中', () => {
    expect(verdictOf(150, 10, TARGET)).toBe('insufficient_history')
  })

  it('花费没到 2× 目标 → 不判', () => {
    expect(verdictOf(20, 0, TARGET)).toBe('insufficient_history')
  })

  it('没配目标 → 不判（不回落行业默认）', () => {
    expect(verdictOf(160, 0, null)).toBe('insufficient_history')
  })
})

describe('冷启动按客户主结果口径计数', () => {
  it('通用 results 有私信但主结果（留资）为 0 → 仍按 0 主结果判 alert', () => {
    const rows = coldRows(150, 0)
    for (const r of rows.get('cold')!) r.results = 2 // 通用口径把私信算进去了
    const p = buildNarrativePayload(rows, '2026-07-11', undefined, null, TARGET)
    expect(p.campaigns[0].verdict).toBe('alert')
  })

  it('主结果归不上（null）→ 不判，不拿通用 results 代替', () => {
    const rows = coldRows(150, 0)
    for (const r of rows.get('cold')!) { r.primary_results = null; r.results = 0 }
    const p = buildNarrativePayload(rows, '2026-07-11', undefined, null, TARGET)
    expect(p.campaigns[0].verdict).toBe('insufficient_history')
  })
})

describe('冷启动主结果计数带广告组优化目标', () => {
  const customOnly = {
    entity_id: 'c1', entity_name: 'C1', insight_date: '2026-07-10', ctr: 0.02, cost_per_result: null,
    results: 0, spend: 30, impressions: 3000, frequency_7d: null,
    reach: null, video_thruplays: null,
    actions: [{ action_type: 'offsite_conversion.fb_pixel_custom', value: '1' }],
  }

  it('网站转化优化 + 只有自定义像素事件 → 留资 null（不判）', () => {
    expect(primaryCountOf('lead', customOnly, 'OFFSITE_CONVERSIONS')).toBeNull()
  })

  it('不传优化目标会误算成 0（说明保护靠目标上下文）', () => {
    expect(primaryCountOf('lead', customOnly, null)).toBe(0)
  })

  it('广告组目标缺失 / 查不到 / 含网站转化 → 按保守口径 OFFSITE_CONVERSIONS', () => {
    expect(campaignGoalFor(undefined)).toBe('OFFSITE_CONVERSIONS')
    expect(campaignGoalFor(new Set())).toBe('OFFSITE_CONVERSIONS')
    expect(campaignGoalFor(new Set<string | null>([null]))).toBe('OFFSITE_CONVERSIONS')
    expect(campaignGoalFor(new Set<string | null>(['LEAD_GENERATION', 'OFFSITE_CONVERSIONS']))).toBe('OFFSITE_CONVERSIONS')
  })

  it('目标明确且非网站转化 → 原样返回', () => {
    expect(campaignGoalFor(new Set<string | null>(['LEAD_GENERATION']))).toBe('LEAD_GENERATION')
  })

  it('归不上的天（primary_results null）使整条冷启动不判，即便花费远超 2× 目标', () => {
    const rows = coldRows(500, 0)
    for (const r of rows.get('cold')!) r.primary_results = primaryCountOf('lead', customOnly, 'OFFSITE_CONVERSIONS')
    const p = buildNarrativePayload(rows, '2026-07-11', undefined, null, TARGET)
    expect(p.campaigns[0].verdict).toBe('insufficient_history')
  })
})

describe('coldStartAlert 边界', () => {
  it('恰好等于 2× 目标的花费 + 0 结果 → 判；单次成本恰好 2× → 不判', () => {
    expect(coldStartAlert(22, 0, TARGET)).not.toBeNull()
    expect(coldStartAlert(44, 2, TARGET)).toBeNull()
  })

  it('目标 0 或负数视为没配', () => {
    expect(coldStartAlert(500, 0, 0)).toBeNull()
    expect(coldStartAlert(500, 0, -5)).toBeNull()
  })
})

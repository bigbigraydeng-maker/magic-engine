import { describe, it, expect } from 'vitest'
import type { ScorecardUnit } from '../scorecard'
import { summarizeResultsByType } from '../result-summary'

function unit(over: Partial<ScorecardUnit>): ScorecardUnit {
  return {
    adAccountId: 'act_1',
    level: 'adset',
    id: 'u1',
    name: 'u1',
    role: 'acquisition',
    spend: 100,
    resultType: 'lead',
    results: 10,
    costPerResult: 10,
    targetCost: null,
    vsTarget: null,
    sampleGap: null,
    separate: null,
    ...over,
  }
}

describe('summarizeResultsByType', () => {
  it('adds up two lead units into one lead row', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', results: 100, spend: 300 }),
      unit({ id: 'b', results: 51, spend: 100 }),
    ])
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].type).toBe('lead')
    expect(summary.rows[0].results).toBe(151)
    expect(summary.rows[0].spend).toBe(400)
    expect(summary.rows[0].costPerResult).toBeCloseTo(400 / 151)
  })

  it('never merges lead and messaging_started into one row', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', resultType: 'lead', results: 10, spend: 100 }),
      unit({ id: 'b', resultType: 'messaging_started', results: 7, spend: 50 }),
    ])
    expect(summary.rows).toHaveLength(2)
    expect(summary.rows.some(r => r.results === 17)).toBe(false)
    expect(summary.rows[0].type).toBe('lead')
    expect(summary.rows[0].spend).toBe(100)
    expect(summary.rows[1].type).toBe('messaging_started')
    expect(summary.rows[1].spend).toBe(50)
  })

  it('ignores units with spend 0', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', spend: 0, results: 5 }),
    ])
    expect(summary.rows).toHaveLength(0)
    expect(summary.noResultUnits).toBe(0)
    expect(summary.unknownUnits).toBe(0)
  })

  it('counts not_result_unit units separately', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', spend: 40, separate: 'not_result_unit' }),
    ])
    expect(summary.noResultUnits).toBe(1)
    expect(summary.rows).toHaveLength(0)
  })

  it('counts units with unknown result type as unknown', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', spend: 40, resultType: null, separate: 'result_type_unknown' }),
    ])
    expect(summary.unknownUnits).toBe(1)
    expect(summary.rows).toHaveLength(0)
  })

  it('counts units with null results as unknown', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', spend: 40, resultType: 'lead', results: null }),
    ])
    expect(summary.unknownUnits).toBe(1)
    expect(summary.rows).toHaveLength(0)
  })

  it('returns null costPerResult when results total 0', () => {
    const summary = summarizeResultsByType([
      unit({ id: 'a', resultType: 'lead', results: 0, spend: 100 }),
    ])
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0].results).toBe(0)
    expect(summary.rows[0].costPerResult).toBeNull()
  })

  it('returns empty summary for empty input', () => {
    const summary = summarizeResultsByType([])
    expect(summary.rows).toEqual([])
    expect(summary.noResultUnits).toBe(0)
    expect(summary.unknownUnits).toBe(0)
  })
})

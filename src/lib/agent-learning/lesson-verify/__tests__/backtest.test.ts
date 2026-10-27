import { describe, expect, it } from 'vitest'
import {
  classifyBacktest, describeBacktest, MIN_BACKTEST_ROWS, runBacktest, type InsightRow,
} from '../backtest'

function rows(n: number, f: (i: number) => { frequency: number; cpm: number; ctr: number }): InsightRow[] {
  return Array.from({ length: n }, (_, i) => ({ ...f(i), impressions: 1000 }))
}

describe('classifyBacktest', () => {
  it('matches only frequency→cpm / frequency→ctr wording', () => {
    expect(classifyBacktest('When frequency passes 3, CPM rises')).toBe('freq_cpm')
    expect(classifyBacktest('频次过高会让 CTR 下降')).toBe('freq_ctr')
    expect(classifyBacktest('Use short videos in Meta ads')).toBeNull()
    expect(classifyBacktest('Frequency matters for ads')).toBeNull()
  })
  it('rejects opposite-direction, negated or directionless claims', () => {
    expect(classifyBacktest('Higher frequency lowers CPM')).toBeNull()
    expect(classifyBacktest('Higher frequency increases CTR')).toBeNull()
    expect(classifyBacktest('频次越高 CPM 越低')).toBeNull()
    expect(classifyBacktest('Frequency does not raise CPM')).toBeNull()
    expect(classifyBacktest('频次越低 CPM 越高')).toBeNull()
    expect(classifyBacktest('频次越低 CTR 越低')).toBeNull()
    expect(classifyBacktest('When frequency drops, CPM rises')).toBeNull()
    expect(classifyBacktest('Frequency and CPM are related')).toBeNull()
  })
  it('accepts aligned direction wording', () => {
    expect(classifyBacktest('Higher frequency increases CPM')).toBe('freq_cpm')
    expect(classifyBacktest('Higher frequency reduces CTR')).toBe('freq_ctr')
    expect(classifyBacktest('频次越高 CPM 越高')).toBe('freq_cpm')
  })
})

describe('runBacktest', () => {
  it('supports freq→cpm when CPM rises with frequency', () => {
    const r = runBacktest('freq_cpm', rows(40, i => ({ frequency: 1 + i / 10, cpm: 10 + i, ctr: 0.02 })))
    expect(r.verdict).toBe('support')
  })
  it('does not support freq→cpm when CPM falls with frequency', () => {
    const r = runBacktest('freq_cpm', rows(40, i => ({ frequency: 1 + i / 10, cpm: 60 - i, ctr: 0.02 })))
    expect(r.verdict).toBe('against')
  })
  it('supports freq→ctr when CTR falls with frequency', () => {
    const r = runBacktest('freq_ctr', rows(40, i => ({ frequency: 1 + i / 10, cpm: 10, ctr: 0.05 - i / 1000 })))
    expect(r.verdict).toBe('support')
  })
  it('reports insufficient data when too few rows or no variance', () => {
    expect(runBacktest('freq_cpm', rows(MIN_BACKTEST_ROWS - 1, i => ({ frequency: 1 + i, cpm: i, ctr: 0 }))).verdict).toBe('insufficient')
    expect(runBacktest('freq_cpm', rows(40, () => ({ frequency: 2, cpm: 10, ctr: 0 }))).verdict).toBe('insufficient')
    expect(runBacktest('freq_cpm', []).verdict).toBe('insufficient')
  })
  it('ignores rows with null metrics or zero impressions', () => {
    const data: InsightRow[] = [
      ...rows(40, i => ({ frequency: 1 + i / 10, cpm: 10 + i, ctr: 0.02 })),
      { frequency: null, cpm: 5, ctr: 0.01, impressions: 1000 },
      { frequency: 3, cpm: null, ctr: 0.01, impressions: 1000 },
      { frequency: 9, cpm: 1, ctr: 0.01, impressions: 0 },
    ]
    expect(runBacktest('freq_cpm', data).rows).toBe(40)
  })
})

describe('describeBacktest', () => {
  it('always states correlation-only and has no JSON', () => {
    for (const verdict of ['support', 'against', 'insufficient'] as const) {
      const s = describeBacktest({ verdict, rows: 5, r: null })
      expect(s).toContain('只看相关性')
      expect(s).not.toContain('{')
    }
  })
})

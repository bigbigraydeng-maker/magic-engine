import type { ScorecardUnit } from './scorecard'
import type { CoreMetric } from '../rules/core-metric'

export interface ResultSummaryRow { type: CoreMetric; results: number; spend: number; costPerResult: number | null }

export interface ResultSummary {
  rows: ResultSummaryRow[]
  noResultUnits: number
  unknownUnits: number
}

// RL-12: never add messaging-started counts and lead counts together.
// One row per result kind; kinds are never merged.
export function summarizeResultsByType(units: readonly ScorecardUnit[]): ResultSummary {
  const byType = new Map<CoreMetric, { results: number; spend: number }>()
  let noResultUnits = 0
  let unknownUnits = 0

  for (const unit of units) {
    if (unit.spend <= 0) continue
    if (unit.separate === 'not_result_unit') { noResultUnits += 1; continue }
    if (unit.resultType === null || unit.results === null) { unknownUnits += 1; continue }
    const acc = byType.get(unit.resultType) ?? { results: 0, spend: 0 }
    acc.results += unit.results
    acc.spend += unit.spend
    byType.set(unit.resultType, acc)
  }

  const rows: ResultSummaryRow[] = []
  for (const [type, acc] of byType) {
    rows.push({
      type,
      results: acc.results,
      spend: acc.spend,
      costPerResult: acc.results > 0 ? acc.spend / acc.results : null,
    })
  }
  rows.sort((a, b) => b.spend - a.spend)

  return { rows, noResultUnits, unknownUnits }
}

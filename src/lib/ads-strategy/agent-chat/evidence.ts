/**
 * Evidence envelope for every ads investigation tool result.
 */

export interface DataFreshness {
  last_insight_date: string | null
  last_snapshot_captured_at: string | null
}

export interface InvestigationEvidence {
  metrics_included: string[]
  date_range: Record<string, string>
  data_freshness: DataFreshness
  could_not_read: string[]
  notes?: string[]
}

export function emptyFreshness(): DataFreshness {
  return { last_insight_date: null, last_snapshot_captured_at: null }
}

export function mergeFreshness(a: DataFreshness, b: DataFreshness): DataFreshness {
  const maxDate = (x: string | null, y: string | null) => {
    if (!x) return y
    if (!y) return x
    return x > y ? x : y
  }
  const maxIso = (x: string | null, y: string | null) => {
    if (!x) return y
    if (!y) return x
    return Date.parse(x) >= Date.parse(y) ? x : y
  }
  return {
    last_insight_date: maxDate(a.last_insight_date, b.last_insight_date),
    last_snapshot_captured_at: maxIso(a.last_snapshot_captured_at, b.last_snapshot_captured_at),
  }
}

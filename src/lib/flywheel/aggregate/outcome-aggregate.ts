/**
 * Flywheel outcome aggregation helpers — P12.C.1
 *
 * Pure functions; DB querying lives in the API route.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutcomeRow {
  action_type: string
  verdict: string
}

export interface VerdictStats {
  confirmed: number
  inconclusive: number
  reversed: number
  total: number
  confirmed_rate: number
}

export interface AggregateEntry extends VerdictStats {
  action_type: string
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function computeVerdictStats(rows: OutcomeRow[]): VerdictStats {
  let confirmed = 0
  let inconclusive = 0
  let reversed = 0
  for (const r of rows) {
    if (r.verdict === 'confirmed')     confirmed++
    else if (r.verdict === 'inconclusive') inconclusive++
    else if (r.verdict === 'reversed') reversed++
  }
  const total = confirmed + inconclusive + reversed
  return {
    confirmed,
    inconclusive,
    reversed,
    total,
    confirmed_rate: total === 0 ? 0 : confirmed / total,
  }
}

export function buildAggregateRows(rows: OutcomeRow[]): AggregateEntry[] {
  const byType = new Map<string, OutcomeRow[]>()
  for (const r of rows) {
    const bucket = byType.get(r.action_type) ?? []
    bucket.push(r)
    byType.set(r.action_type, bucket)
  }
  const result: AggregateEntry[] = []
  for (const [action_type, bucket] of byType) {
    result.push({ action_type, ...computeVerdictStats(bucket) })
  }
  return result
}

/**
 * Pick top N entries by confirmed_rate, filtered to min_total or more outcomes.
 * Excludes entries with too few data points to be meaningful.
 */
export function pickTop(
  entries: AggregateEntry[],
  n: number,
  minTotal = 2,
): AggregateEntry[] {
  return entries
    .filter(e => e.total >= minTotal)
    .sort((a, b) => b.confirmed_rate - a.confirmed_rate)
    .slice(0, n)
}

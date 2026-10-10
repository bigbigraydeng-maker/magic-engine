/**
 * Flywheel outcome aggregation helpers — P12.C.1
 *
 * Pure functions; DB querying lives in the API route.
 */

import { MIN_DECIDED_FOR_RATE } from '@/lib/flywheel/attribution/outcome-identity'

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
  /** confirmed + reversed — the cases that decided something. */
  decided: number
  /** confirmed ÷ decided; 0 when nothing was decided. */
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
  const decided = confirmed + reversed
  return {
    confirmed,
    inconclusive,
    reversed,
    total,
    decided,
    confirmed_rate: decided === 0 ? 0 : confirmed / decided,
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
  for (const [action_type, bucket] of Array.from(byType.entries())) {
    result.push({ action_type, ...computeVerdictStats(bucket) })
  }
  return result
}

/**
 * Pick top N entries by confirmed_rate, keeping only entries with at least
 * `minDecided` decided cases (confirmed + reversed). Undecided cases do not make
 * a sample: "1 confirmed + 99 unknown" must not rank as a proven move.
 */
export function pickTop(
  entries: AggregateEntry[],
  n: number,
  minDecided = MIN_DECIDED_FOR_RATE,
): AggregateEntry[] {
  return entries
    .filter(e => e.decided >= minDecided)
    .sort((a, b) => b.confirmed_rate - a.confirmed_rate)
    .slice(0, n)
}

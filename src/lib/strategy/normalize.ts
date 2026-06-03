/**
 * Phase 32 — Frontend normalisation for Supabase NUMERIC fields.
 *
 * Why this exists:
 *   PostgreSQL NUMERIC columns are serialized as **strings** by PostgREST/Supabase
 *   to avoid precision loss. The TypeScript types in @/types/strategy claim
 *   these fields are `number`, which is a lie at runtime.
 *
 * Symptoms when not normalized:
 *   - `reduce((s, i) => s + i.budget_percent, 0)` returns "020" (string concat)
 *   - `goal.budget_amount * 0.3` becomes NaN
 *   - Edit drawer max attribute corrupted
 *
 * Bug: B7 (Initiative budget % reset to 0 after edit)
 */

import type { GoalRow, InitiativeRow } from '@/types/strategy'

/** Coerce a NUMERIC string to a number; preserve null. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const parsed = parseFloat(String(v))
  return Number.isFinite(parsed) ? parsed : null
}

/** Normalize a GoalRow's numeric fields (baseline_value, target_value, budget_amount). */
export function normalizeGoalRow(row: GoalRow): GoalRow {
  return {
    ...row,
    baseline_value: num(row.baseline_value) ?? 0,
    target_value: num(row.target_value) ?? 0,
    budget_amount: num(row.budget_amount),
  }
}

/** Normalize an InitiativeRow's numeric fields (budget_percent, budget_amount). */
export function normalizeInitiativeRow(row: InitiativeRow): InitiativeRow {
  return {
    ...row,
    budget_percent: num(row.budget_percent),
    budget_amount: num(row.budget_amount),
  }
}

/** Normalize a list. */
export function normalizeInitiativeList(rows: InitiativeRow[]): InitiativeRow[] {
  return rows.map(normalizeInitiativeRow)
}

export function normalizeGoalList(rows: GoalRow[]): GoalRow[] {
  return rows.map(normalizeGoalRow)
}

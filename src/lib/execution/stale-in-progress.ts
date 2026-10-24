/**
 * Close execution items left `in_progress` with no update for more than 30 days.
 *
 * Those rows are not the auto-run claim (that one is released after 2 hours).
 * They are cards nobody has touched. Leaving them in progress makes the board
 * look like work is happening. `skipped` is the existing terminal status;
 * `completed` would pretend the work was done.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const STALE_IN_PROGRESS_DAYS = 30
export const STALE_IN_PROGRESS_REASON = 'stale_in_progress_30d'

export interface StaleInProgressRow {
  id: string
  client_id: string
  status: string
  updated_at: string | null
  title: string | null
}

export function staleInProgressCutoff(now: Date, days = STALE_IN_PROGRESS_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000)
}

export function isStaleInProgress(
  row: { status: string; updated_at: string | null },
  now: Date,
  days = STALE_IN_PROGRESS_DAYS,
): boolean {
  if (row.status !== 'in_progress') return false
  if (!row.updated_at) return false
  const updated = Date.parse(row.updated_at)
  if (Number.isNaN(updated)) return false
  return updated < staleInProgressCutoff(now, days).getTime()
}

export async function listStaleInProgressItems(
  supabase: SupabaseClient,
  now: Date,
): Promise<StaleInProgressRow[]> {
  const cutoff = staleInProgressCutoff(now).toISOString()
  const { data, error } = await supabase
    .from('execution_items')
    .select('id, client_id, status, updated_at, title')
    .eq('status', 'in_progress')
    .lt('updated_at', cutoff)
    .limit(500)
  if (error) throw new Error(`stale in_progress lookup failed: ${error.message}`)
  return ((data ?? []) as StaleInProgressRow[]).filter((row) => isStaleInProgress(row, now))
}

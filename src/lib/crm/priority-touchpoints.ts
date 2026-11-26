import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllParallel } from '@/lib/supabase-paginate'
import type { TouchRow } from './contact-response-row'

const COLUMNS = 'id, contact_id, channel, direction, occurred_at, created_at, raw, metadata, source'

/**
 * Every touchpoint of one client, newest first, for the priority list.
 *
 * Pages are read in parallel after the first page reports the exact row count.
 * The earlier single-request database function was measured in production on
 * 2026-11-15 and was not faster (one very large response instead of ten small
 * ones), so it is no longer called.
 */
export async function loadPriorityTouchpoints(sb: SupabaseClient, clientId: string): Promise<TouchRow[]> {
  const rows = await fetchAllParallel<Omit<TouchRow, 'summary'>>(
    (from, to, withCount) =>
      sb.from('contact_touchpoints').select(COLUMNS, withCount ? { count: 'exact' } : undefined)
        .eq('client_id', clientId).order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
    (row) => row.id,
  )
  return rows.map((row) => ({ ...row, summary: null }))
}

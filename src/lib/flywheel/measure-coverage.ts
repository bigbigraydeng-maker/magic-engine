/**
 * Which clients have reached the Measure phase — Issue #859, round 27.
 *
 * Lifted out of the dashboard page so it can be tested: the page is a server
 * component that fans out a dozen queries at once, and "did we miss a client"
 * is not something a rendering test would ever notice.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'

/**
 * The set of clients with at least one attribution outcome.
 *
 * Paginated, because this reads outcome ROWS to answer a question about
 * CLIENTS. PostgREST caps a response at 1000 rows and says nothing; one action
 * already yields three rows (clicks / impressions / avg_position), so the cap
 * arrives roughly three times sooner than the row count suggests — and sooner
 * again if ATTRIBUTION_DUAL_WINDOW_ENABLED is ever turned on. Past it, one busy
 * client's rows push other clients out of the set entirely and the dashboard
 * under-reports Measure coverage with no error anywhere.
 *
 * 194 rows in production today, so this is a fuse rather than a live fault.
 */
export async function loadClientsWithOutcomes(): Promise<Set<string>> {
  const rows = await fetchAll<{ client_id: string }>((from, to) =>
    supabaseAdmin
      .from('flywheel_outcomes')
      .select('client_id')
      // A stable, unique sort — `range` without one repeats or drops rows at
      // page boundaries.
      .order('id', { ascending: true })
      .range(from, to),
  )

  return new Set(rows.map(r => r.client_id))
}

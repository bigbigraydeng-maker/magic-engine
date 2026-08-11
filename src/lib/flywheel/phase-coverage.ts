/**
 * Which clients have reached the Diagnose / Prioritise / Execute phases.
 *
 * The siblings of `loadClientsWithOutcomes` in `./measure-coverage`, which
 * covers the fourth phase. Same shape, same hazard, same fix: these read ROWS
 * to answer a question about CLIENTS, and PostgREST caps a response at 1000
 * rows without returning an error. Past the cap one busy client's rows push
 * other clients out of the set entirely, and the dashboard under-reports
 * coverage with nothing anywhere to indicate the figure is short.
 *
 * Lifted out of the dashboard page for the same reason as the Measure one: the
 * page is a server component that fans out a dozen queries at once, and "did we
 * miss a client" is not something a rendering test would ever notice.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'

/**
 * The set of clients with at least one prescription.
 *
 * 16 rows in production today, so this one is a fuse rather than a live fault —
 * paginated because the table only grows and nothing about the query would
 * start complaining when it crosses the line.
 */
export async function loadClientsWithDiagnose(): Promise<Set<string>> {
  const rows = await fetchAll<{ client_id: string }>((from, to) =>
    supabaseAdmin
      .from('prescriptions')
      .select('client_id')
      // A stable, unique sort — `range` without one repeats or drops rows at
      // page boundaries.
      .order('id', { ascending: true })
      .range(from, to),
  )

  return new Set(rows.map(r => r.client_id))
}

export interface ExecutionPhaseClients {
  /** Clients with work queued but not finished. */
  prioritise: Set<string>
  /** Clients with at least one finished item. */
  execute: Set<string>
}

/**
 * The clients sitting in the Prioritise and Execute phases, by item status.
 *
 * Unlike the others this is not a fuse — it is already at the line. There are
 * exactly 1000 execution items in production today across 16 clients, so the
 * very next insert starts truncating the response. The clients that fall off
 * are the ones at the end of the sort, and the distribution is steep: the two
 * busiest clients hold 540 of the 1000 rows while the quietest holds 2. Those
 * small clients are precisely the ones a coverage percentage is supposed to
 * surface, and they would have vanished from it silently.
 *
 * The status split lives here rather than in the page so that it is covered by
 * the same test that covers the paging.
 */
export async function loadExecutionPhaseClients(): Promise<ExecutionPhaseClients> {
  const rows = await fetchAll<{ client_id: string; status: string }>((from, to) =>
    supabaseAdmin
      .from('execution_items')
      .select('client_id, status')
      .order('id', { ascending: true })
      .range(from, to),
  )

  const prioritise = new Set<string>()
  const execute = new Set<string>()

  for (const row of rows) {
    if (row.status === 'pending' || row.status === 'in_progress') {
      prioritise.add(row.client_id)
    } else if (row.status === 'completed') {
      execute.add(row.client_id)
    }
  }

  return { prioritise, execute }
}

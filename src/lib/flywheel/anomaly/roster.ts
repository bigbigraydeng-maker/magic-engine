/**
 * Serviced-client roster — who the standing watchers are allowed to look at.
 *
 * HISTORY (read this before changing the selector)
 * ------------------------------------------------
 * AnomalyDetectorJob used to select clients with `.eq('status', 'active')`.
 * The `clients` table had no `status` column. Postgres returned "column
 * clients.status does not exist", the error was pushed into an errors[] array
 * inside the cron summary, and the job returned success with scannedClients:0
 * every day from 2026-07-03 to 2026-07-31. anomaly_signals stayed empty.
 *
 * That root cause was fixed on main by PR #727 (a90ff332), which introduced
 * `clients.client_status` ('active' | 'prospect' | 'archived'), a Settings-page
 * writer UI, and switched 11 monitoring crons onto it. The 2026-08-01 run
 * scanned 8 clients and wrote the first signal in a month.
 *
 * SO: this module deliberately does NOT invent its own definition of
 * "who is a client". It reuses `client_status = 'active'`, the same gate every
 * other monitoring cron uses. A second, cleverer definition living only here
 * would drift from the one the Settings UI writes, and nobody would notice.
 *
 * The one thing kept from the incident: the roster must never be silently
 * empty. An empty roster is treated as a failure, because "we have no clients"
 * is far more likely to mean "the query broke" than to be true.
 */

import { supabaseAdmin } from '../../supabase'

/** A client we are actively serving. */
export interface RosterClient {
  id: string
  name: string
  createdAt: string
  facebookPageId: string | null
  metaAdAccountId: string | null
}

export interface RosterResult {
  clients: RosterClient[]
  /**
   * Clients excluded by the gate, kept so an exclusion is visible rather than
   * invisible. Somebody flipping a client to 'prospect' by accident should be
   * readable in the cron summary, not silently absent.
   */
  excluded: { id: string; name: string; clientStatus: string }[]
}

/** Row shape returned by the roster query. */
interface ClientRow {
  id: string
  name: string
  created_at: string
  client_status: string | null
  facebook_page_id: string | null
  meta_ad_account_id: string | null
}

/**
 * Build the serviced-client roster.
 *
 * Throws on query failure or on an empty result. This is deliberate: the
 * previous implementation swallowed the error into an array and reported
 * success for 30 consecutive days. A roster we cannot build is a blind
 * detector, and it has to be loud.
 */
export async function fetchServicedClients(): Promise<RosterResult> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, created_at, client_status, facebook_page_id, meta_ad_account_id')

  if (error) {
    throw new Error(`fetchServicedClients: clients query failed: ${error.message}`)
  }

  const rows = (data ?? []) as ClientRow[]
  if (rows.length === 0) {
    throw new Error('fetchServicedClients: clients table returned no rows')
  }

  const { clients, excluded } = partitionByServiceGate(rows)

  if (clients.length === 0) {
    throw new Error(
      `fetchServicedClients: no client has client_status='active' ` +
        `(${rows.length} client rows examined). Refusing to report a healthy ` +
        `run over an empty roster.`
    )
  }

  return { clients, excluded }
}

/**
 * Split client rows into serviced and excluded.
 *
 * Pure and exported so the gate itself is testable without a database — the
 * gate is the part that broke last time.
 */
export function partitionByServiceGate(rows: ClientRow[]): RosterResult {
  const clients: RosterClient[] = []
  const excluded: RosterResult['excluded'] = []

  for (const row of rows) {
    if (row.client_status === 'active') {
      clients.push({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        facebookPageId: row.facebook_page_id ?? null,
        metaAdAccountId: row.meta_ad_account_id ?? null,
      })
    } else {
      excluded.push({
        id: row.id,
        name: row.name,
        clientStatus: row.client_status ?? 'unset',
      })
    }
  }

  return { clients, excluded }
}

/**
 * The single definition of "which clients have a usable Google Search Console
 * connection".
 *
 * Both the daily Google data pullback route
 * (`src/app/api/cron/google-data-pullback-daily/route.ts`) and the per-page
 * daily GSC fan-out use this module, so the two can never disagree about who is
 * connected.
 *
 * Rule: a `client_connectors` row with `anchor = 'gsc'`, `status = 'connected'`
 * and a non-blank string `config.site_url` (trimmed). No client names or ids
 * appear in this module. `client_connectors` has UNIQUE (client_id, anchor), so
 * there is at most one GSC row per client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const GSC_CONNECTOR_ANCHOR = 'gsc'
export const GSC_CONNECTOR_CONNECTED = 'connected'

export interface GscConnectedClient {
  readonly clientId: string
  readonly siteUrl: string
}

export type GscRosterResult =
  | { readonly ok: true; readonly clients: readonly GscConnectedClient[] }
  | { readonly ok: false; readonly reason: string }

/**
 * The one rule for "this connector row points at a usable GSC property".
 *
 * Returns the trimmed `config.site_url` when it is a non-blank string, and
 * `null` for anything else — a missing config, a non-object config, a
 * non-string `site_url`, or a string that is only whitespace.
 */
export function gscSiteUrlFromConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null
  const siteUrl = (config as { site_url?: unknown }).site_url
  if (typeof siteUrl !== 'string') return null
  const trimmed = siteUrl.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Load every client with a usable GSC connection.
 *
 * A read failure is reported as `ok: false` with the database reason rather
 * than an empty roster — callers must be able to tell "nobody is connected"
 * apart from "we could not find out".
 */
export async function loadGscConnectedClients(
  supabase: SupabaseClient,
): Promise<GscRosterResult> {
  const { data, error } = await supabase
    .from('client_connectors')
    .select('client_id, config')
    .eq('anchor', GSC_CONNECTOR_ANCHOR)
    .eq('status', GSC_CONNECTOR_CONNECTED)

  if (error) return { ok: false, reason: error.message }

  const clients = (data ?? []).flatMap((row): GscConnectedClient[] => {
    const clientId = (row as { client_id?: unknown }).client_id
    if (typeof clientId !== 'string' || clientId.length === 0) return []
    const siteUrl = gscSiteUrlFromConfig((row as { config?: unknown }).config)
    if (siteUrl === null) return []
    return [{ clientId, siteUrl }]
  })

  return { ok: true, clients }
}

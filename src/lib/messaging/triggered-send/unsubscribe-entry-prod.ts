/**
 * The real dependencies of the one-click unsubscribe entry: the send ledger read, the unsubscribe write, the clock, the
 * log (codes and the send id only, never the token).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordEmailUnsubscribe } from '@/lib/crm/email-unsubscribe'
import type { SendRowRead, UnsubscribeEntryDeps } from './unsubscribe-entry'
import type { EnvReader } from './unsubscribe-token'

/** The ledger row a link names. A read error is `{ ok:false }` (the entry answers "try again"), a missing row is null. */
export async function loadUnsubscribeSendRow(db: SupabaseClient, sendId: string): Promise<SendRowRead> {
  const { data, error } = await db
    .from('triggered_sends')
    .select('id, client_id, contact_id, channel, dedupe_scope, to_address_sha256')
    .eq('id', sendId)
    .maybeSingle()
  if (error) return { ok: false }
  if (data === null) return { ok: true, row: null }
  const row = data as {
    id: string
    client_id: string
    contact_id: string
    channel: string
    dedupe_scope: string
    to_address_sha256: string | null
  }
  return {
    ok: true,
    row: {
      id: row.id,
      clientId: row.client_id,
      contactId: row.contact_id,
      channel: row.channel,
      dedupeScope: row.dedupe_scope,
      toAddressSha256: row.to_address_sha256,
    },
  }
}

function log(code: string, sendId?: string): void {
  const line: Record<string, string> = { evt: 'me_unsubscribe', code }
  if (sendId !== undefined) line.send_id = sendId
  console.info(JSON.stringify(line))
}

export function createUnsubscribeEntryDeps(db: SupabaseClient, env: EnvReader = (name) => process.env[name]): UnsubscribeEntryDeps {
  return {
    env,
    loadSend: (sendId) => loadUnsubscribeSendRow(db, sendId),
    record: (input) => recordEmailUnsubscribe(db, input),
    now: () => new Date(),
    log,
  }
}

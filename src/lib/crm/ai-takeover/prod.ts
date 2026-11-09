/** The real Supabase data behind the AI takeover store and today's list. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { isTakeoverKind, type TakeoverEvent } from './state'
import type { TakeoverStoreDeps } from './store'

const MAX_EVENTS = 1000
const PAGE = 1000

export function createTakeoverStore(db: SupabaseClient = supabaseAdmin): TakeoverStoreDeps {
  return {
    async insertEvent(e) {
      const { data, error } = await db
        .from('contact_automation_events')
        .upsert(
          {
            client_id: e.clientId,
            contact_id: e.contactId,
            kind: e.kind,
            actor: e.actor,
            reason: e.reason,
            catalog_version: e.catalogVersion,
            source_ref: e.sourceRef,
          },
          { onConflict: 'client_id,source_ref', ignoreDuplicates: true },
        )
        .select('id')
        .maybeSingle()
      if (error) throw new Error(`contact_automation_events: ${error.message}`)
      return { inserted: data !== null }
    },
    async loadEvents(clientId, contactId): Promise<TakeoverEvent[]> {
      const { data, error } = await db
        .from('contact_automation_events')
        .select('kind, created_at, actor')
        .eq('client_id', clientId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(MAX_EVENTS)
      if (error) throw new Error(`contact_automation_events: ${error.message}`)
      const rows = (data as Array<{ kind: unknown; created_at: unknown; actor: unknown }> | null) ?? []
      return rows
        .filter((r) => isTakeoverKind(r.kind))
        .map((r) => ({ kind: r.kind as TakeoverEvent['kind'], createdAt: String(r.created_at), actor: String(r.actor) }))
    },
    async setMirror(clientId, contactId, since) {
      const { error } = await db
        .from('contacts')
        .update({ ai_takeover_since: since })
        .eq('client_id', clientId)
        .eq('id', contactId)
      if (error) throw new Error(`contacts.ai_takeover_since: ${error.message}`)
    },
  }
}

/**
 * contactId → ai_takeover_since for the client's guests currently in takeover (mirror column, fast path).
 * Throws on a read error; today's list catches it and shows everyone (the behaviour before this feature).
 */
export async function loadTakeoverSince(clientId: string, db: SupabaseClient = supabaseAdmin): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('contacts')
      .select('id, ai_takeover_since')
      .eq('client_id', clientId)
      .not('ai_takeover_since', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`contacts.ai_takeover_since: ${error.message}`)
    const rows = (data as Array<{ id: string; ai_takeover_since: string | null }> | null) ?? []
    for (const r of rows) if (r.ai_takeover_since) out.set(r.id, r.ai_takeover_since)
    if (rows.length < PAGE) break
  }
  return out
}

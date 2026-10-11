/**
 * Open "please publish" requests across all clients — the one catalog read that code outside the
 * catalog folders may use (the daily to-do list). It returns who asked, when and their note;
 * it cannot reach the draft or any tour content. Listed in boundary.test.ts as an open module.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OpenPublishRequest {
  id: string
  clientId: string
  requestedBy: string
  note: string
  createdAt: string
}

const MAX_OPEN_REQUESTS = 200

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Requests nobody has published yet, oldest first. Throws when the table cannot be read. */
export async function listOpenPublishRequests(db: SupabaseClient): Promise<OpenPublishRequest[]> {
  const res = await db
    .from('tour_catalog_publish_requests')
    .select('id, client_id, requested_by, note, created_at')
    .is('handled_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_OPEN_REQUESTS)
  if (res.error) {
    throw new Error(res.error.message)
  }
  const rows: unknown[] = Array.isArray(res.data) ? res.data : []
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      id: text(row.id),
      clientId: text(row.client_id),
      requestedBy: text(row.requested_by),
      note: text(row.note),
      createdAt: text(row.created_at),
    }))
    .filter((request) => request.clientId !== '')
}

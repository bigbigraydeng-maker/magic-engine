/**
 * Has this contact unsubscribed from e-mail through ME's one-click link?
 *
 * The record (written by the unsubscribe entry, P2-2b) is one contact_touchpoints row: source `me_unsubscribe`,
 * channel `email`, source_ref = the contact id, so the table's unique key (client_id, source, source_ref) makes a
 * second click a no-op. It stops e-mail only: it is not "do not contact", so calls and the sales lists are unaffected,
 * and nothing in ME ever turns it back on by itself (that needs the guest's new consent).
 *
 * A failed read is `{ ok:false }`. Every caller must then refuse to send: an unreadable answer is never "not unsubscribed".
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.3.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const EMAIL_UNSUBSCRIBE_SOURCE = 'me_unsubscribe'

export type EmailUnsubscribeRead = { ok: true; unsubscribed: boolean } | { ok: false; error: string }

export async function readEmailUnsubscribed(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
): Promise<EmailUnsubscribeRead> {
  try {
    const { data, error } = await db
      .from('contact_touchpoints')
      .select('id')
      .eq('client_id', clientId)
      .eq('contact_id', contactId)
      .eq('source', EMAIL_UNSUBSCRIBE_SOURCE)
      .eq('channel', 'email')
      .limit(1)
    if (error) return { ok: false, error: `unsubscribe read: ${error.message}` }
    if (!Array.isArray(data)) return { ok: false, error: 'unsubscribe read: no rows array' }
    return { ok: true, unsubscribed: data.length > 0 }
  } catch (err) {
    return { ok: false, error: `unsubscribe read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

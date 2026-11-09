/**
 * Has this guest unsubscribed from e-mail through ME's one-click link?
 *
 * Asked about a contact AND its addresses: the same address can sit on two contact records, and an unsubscribe given on
 * one of them must stop mail to that address from the other one too. A record (written by the unsubscribe entry,
 * P2-2b) is one contact_touchpoints row:
 *   source 'me_unsubscribe', channel 'email', direction 'inbound', contact_id = the contact the link was for,
 *   metadata { automated: true, kind: 'email_unsubscribed', address_sha256: <fingerprint of the address it was sent to> }.
 * A row of this contact counts whatever its address; a row of another contact counts when its address fingerprint is
 * one of this guest's addresses.
 *
 * It stops e-mail only: it is not "do not contact", so calls and the sales lists are unaffected, and nothing in ME ever
 * turns it back on by itself (that needs the guest's new consent).
 * A failed read is `{ ok:false }`. Every caller must then refuse to send: an unreadable answer is never "not unsubscribed".
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.3 (address part: §16.8).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { emailAddressSha256s } from './address-sha256'
import { EMAIL_UNSUBSCRIBE_SOURCE } from './touchpoint-sources'

export { EMAIL_UNSUBSCRIBE_SOURCE }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EmailUnsubscribeRead = { ok: true; unsubscribed: boolean } | { ok: false; error: string }

export async function readEmailUnsubscribed(
  db: SupabaseClient,
  clientId: string,
  guest: { contactId: string; addresses: readonly string[] },
): Promise<EmailUnsubscribeRead> {
  // Both values go into a filter expression: refuse anything that is not exactly a uuid (the fingerprints are hex).
  if (!UUID_RE.test(guest.contactId)) return { ok: false, error: 'unsubscribe read: contact id is not a uuid' }
  const fingerprints = emailAddressSha256s(guest.addresses)
  const anyOf =
    fingerprints.length === 0
      ? `contact_id.eq.${guest.contactId}`
      : `contact_id.eq.${guest.contactId},metadata->>address_sha256.in.(${fingerprints.join(',')})`
  try {
    const { data, error } = await db
      .from('contact_touchpoints')
      .select('id')
      .eq('client_id', clientId)
      .eq('source', EMAIL_UNSUBSCRIBE_SOURCE)
      .eq('channel', 'email')
      .or(anyOf)
      .limit(1)
    if (error) return { ok: false, error: `unsubscribe read: ${error.message}` }
    if (!Array.isArray(data)) return { ok: false, error: 'unsubscribe read: no rows array' }
    return { ok: true, unsubscribed: data.length > 0 }
  } catch (err) {
    return { ok: false, error: `unsubscribe read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

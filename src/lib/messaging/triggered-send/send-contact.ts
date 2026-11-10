/**
 * One guest as a letter needs it: the rehearsal's view of the contact (same audience filter, same addresses) plus the
 * name the letter greets by. Read-only: this file never writes a contact.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadContactsByIds } from './shadow-reads-prod'
import type { ContactLoad } from './send-types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'error'
}

function nameOf(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null
  const name = (row as Record<string, unknown>).display_name
  return typeof name === 'string' ? name : null
}

export async function loadSendContact(db: SupabaseClient, args: { clientId: string; contactId: string; sources: readonly string[] }): Promise<ContactLoad> {
  if (!UUID_RE.test(args.contactId)) return { ok: false, error: 'contact id is not a uuid' }
  const read = await loadContactsByIds(db, { clientId: args.clientId, contactIds: [args.contactId], sources: args.sources })
  if (!read.ok) return read
  const contact = read.contacts.find((c) => c.contactId === args.contactId)
  if (contact === undefined) return { ok: true, contact: null }
  const { data, error } = await db.from('contacts').select('display_name').eq('client_id', args.clientId).eq('id', args.contactId).maybeSingle()
  if (error) return { ok: false, error: `contact name: ${codeOf(error)}` }
  return { ok: true, contact: { ...contact, displayName: nameOf(data) } }
}

/**
 * The contacts of this client that carry one of these addresses: as a registered e-mail identity or as their primary
 * e-mail (an address can be registered on one contact only, but another may still have it as its primary e-mail).
 * Used for a trial's allow-list only (a handful of internal addresses). Exact, lower-case match.
 */
export async function findContactIdsByAddresses(db: SupabaseClient, clientId: string, addresses: readonly string[]): Promise<{ ok: true; contactIds: string[] } | { ok: false; error: string }> {
  const wanted = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0))]
  if (wanted.length === 0) return { ok: true, contactIds: [] }
  const [identities, primaries] = await Promise.all([
    db.from('contact_identities').select('contact_id').eq('client_id', clientId).eq('kind', 'email').in('value', wanted).limit(50),
    db.from('contacts').select('id').eq('client_id', clientId).in('primary_email', wanted).limit(50),
  ])
  if (identities.error) return { ok: false, error: `trial contacts: ${codeOf(identities.error)}` }
  if (primaries.error) return { ok: false, error: `trial contacts: ${codeOf(primaries.error)}` }
  const ids = new Set<string>()
  for (const row of (identities.data as Array<{ contact_id: unknown }> | null) ?? []) if (typeof row.contact_id === 'string') ids.add(row.contact_id)
  for (const row of (primaries.data as Array<{ id: unknown }> | null) ?? []) if (typeof row.id === 'string') ids.add(row.id)
  return { ok: true, contactIds: [...ids].sort() }
}

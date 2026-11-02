/**
 * Database readers of the triggered-send shadow sweep. Read-only: only select queries, no writes.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizationRead, ContactsRead, MailboxCheck, OpenAuthorization, ShadowContact } from './types'

const CHUNK_SIZE = 100
const CONTACT_LIMIT = 1000

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err !== null && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'unknown error'
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function listClientsWithOpenAuthorization(
  db: SupabaseClient,
): Promise<{ ok: true; clientIds: string[] } | { ok: false; error: string }> {
  try {
    const { data, error } = await db
      .from('triggered_send_authorizations')
      .select('client_id')
      .eq('trigger_key', 'welcome')
      .eq('channel', 'email')
      .is('revoked_at', null)
    if (error) return { ok: false, error: errorMessage(error) }
    const rows = (data ?? []) as Array<{ client_id: string }>
    const ids = new Set<string>()
    for (const row of rows) ids.add(row.client_id)
    return { ok: true, clientIds: [...ids].sort() }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function loadOpenAuthorization(db: SupabaseClient, clientId: string): Promise<AuthorizationRead> {
  try {
    const { data, error } = await db
      .from('triggered_send_authorizations')
      .select('id, client_id, rule, rule_sha256, proposed_at, authorized_at')
      .eq('client_id', clientId)
      .eq('trigger_key', 'welcome')
      .eq('channel', 'email')
      .is('revoked_at', null)
      .order('proposed_at', { ascending: false })
      .limit(1)
    if (error) return { ok: false, error: errorMessage(error) }
    const rows = (data ?? []) as Array<{
      id: string
      client_id: string
      rule: unknown
      rule_sha256: string
      proposed_at: string
      authorized_at: string | null
    }>
    const row = rows[0]
    if (!row) return { ok: true, row: null }
    const mapped: OpenAuthorization = {
      id: row.id,
      clientId: row.client_id,
      rule: row.rule,
      ruleSha256: row.rule_sha256,
      proposedAt: row.proposed_at,
      authorized: row.authorized_at !== null,
    }
    return { ok: true, row: mapped }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function loadLeadContacts(
  db: SupabaseClient,
  args: { clientId: string; sinceIso: string; sources: readonly string[] },
): Promise<ContactsRead> {
  const { clientId, sinceIso, sources } = args
  try {
    const step1 = await db
      .from('contacts')
      .select('id, created_at, primary_email')
      .eq('client_id', clientId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(CONTACT_LIMIT)
    if (step1.error) return { ok: false, error: errorMessage(step1.error) }
    const baseRows = (step1.data ?? []) as Array<{ id: string; created_at: string; primary_email: unknown }>
    if (baseRows.length >= CONTACT_LIMIT) {
      return { ok: false, error: 'too many contacts in the window to check them all' }
    }
    if (baseRows.length === 0) return { ok: true, contacts: [] }

    // Step 2: keep only contacts that have a touchpoint from one of the sources.
    const keptIds = new Set<string>()
    for (const ids of chunk(baseRows.map((r) => r.id), CHUNK_SIZE)) {
      const res = await db
        .from('contact_touchpoints')
        .select('contact_id')
        .eq('client_id', clientId)
        .in('source', [...sources])
        .in('contact_id', ids)
      if (res.error) return { ok: false, error: errorMessage(res.error) }
      const rows = (res.data ?? []) as Array<{ contact_id: string }>
      for (const row of rows) keptIds.add(row.contact_id)
    }
    const kept = baseRows.filter((r) => keptIds.has(r.id))
    if (kept.length === 0) return { ok: true, contacts: [] }

    // Step 3: collect every e-mail identity of the kept contacts.
    const identitiesByContact = new Map<string, string[]>()
    for (const ids of chunk(kept.map((r) => r.id), CHUNK_SIZE)) {
      const res = await db
        .from('contact_identities')
        .select('contact_id, value')
        .eq('client_id', clientId)
        .eq('kind', 'email')
        .in('contact_id', ids)
      if (res.error) return { ok: false, error: errorMessage(res.error) }
      const rows = (res.data ?? []) as Array<{ contact_id: string; value: unknown }>
      for (const row of rows) {
        const email = normaliseEmail(row.value)
        if (email === null) continue
        const list = identitiesByContact.get(row.contact_id)
        if (list) list.push(email)
        else identitiesByContact.set(row.contact_id, [email])
      }
    }

    const contacts: ShadowContact[] = kept.map((row) => {
      const primaryEmail = normaliseEmail(row.primary_email)
      const addresses: string[] = []
      const seen = new Set<string>()
      if (primaryEmail !== null) {
        addresses.push(primaryEmail)
        seen.add(primaryEmail)
      }
      for (const email of identitiesByContact.get(row.id) ?? []) {
        if (seen.has(email)) continue
        seen.add(email)
        addresses.push(email)
      }
      return { contactId: row.id, createdAt: row.created_at, primaryEmail, addresses }
    })

    contacts.sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1
      if (a.createdAt > b.createdAt) return 1
      if (a.contactId < b.contactId) return -1
      if (a.contactId > b.contactId) return 1
      return 0
    })
    return { ok: true, contacts }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function checkRequiredMailboxes(
  listActiveMailboxes: (clientId: string) => Promise<Array<{ connectionId: string; account: string }>>,
  clientId: string,
  required: readonly string[],
): Promise<MailboxCheck> {
  if (required.length === 0) {
    return { ok: false, reason: 'unreadable', detail: 'no required mailbox configured' }
  }
  let active: Array<{ connectionId: string; account: string }>
  try {
    active = await listActiveMailboxes(clientId)
  } catch (err) {
    return { ok: false, reason: 'unreadable', detail: errorMessage(err) }
  }
  const activeSet = new Set(active.map((m) => m.account.trim().toLowerCase()))
  const missing: string[] = []
  for (const mailbox of required) {
    if (!activeSet.has(mailbox.trim().toLowerCase())) missing.push(mailbox)
  }
  if (missing.length > 0) {
    return { ok: false, reason: 'missing', detail: `missing: ${missing.join(', ')}` }
  }
  return { ok: true }
}

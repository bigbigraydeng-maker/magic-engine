/**
 * Database readers of the triggered-send shadow sweep. Read-only: only select queries, no writes.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizationRead, ContactsRead, MailboxCheck, OpenAuthorization, ShadowContact } from './types'

const CHUNK_SIZE = 100
/** The database returns at most this many rows per request. */
const PAGE_SIZE = 1000
/** At most this many pages of lead-form touchpoints are read in one sweep (5 x 1000); more fails closed. */
const MAX_PAGES = 5

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

type ContactRow = { id: string; created_at: string; primary_email: unknown }

/** Every e-mail identity of the given contacts (normalised), by contact id. */
async function loadEmailIdentities(
  db: SupabaseClient,
  clientId: string,
  contactIds: readonly string[],
): Promise<{ ok: true; byContact: Map<string, string[]> } | { ok: false; error: string }> {
  const byContact = new Map<string, string[]>()
  for (const ids of chunk(contactIds, CHUNK_SIZE)) {
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
      const list = byContact.get(row.contact_id)
      if (list) list.push(email)
      else byContact.set(row.contact_id, [email])
    }
  }
  return { ok: true, byContact }
}

/**
 * The first touchpoint of the audience sources of each contact (a lead-form submission), by contact id.
 * `occurred_at` is when the person actually filled the form; `contacts.created_at` is when ME first stored the contact,
 * which can be weeks later when a sync catches up after an outage.
 */
async function loadFirstTouches(
  db: SupabaseClient,
  clientId: string,
  contactIds: readonly string[],
  sources: readonly string[],
): Promise<{ ok: true; firstTouch: Map<string, string> } | { ok: false; error: string }> {
  const firstTouch = new Map<string, string>()
  for (const ids of chunk(contactIds, CHUNK_SIZE)) {
    const res = await db
      .from('contact_touchpoints')
      .select('contact_id, occurred_at')
      .eq('client_id', clientId)
      .in('source', [...sources])
      .in('contact_id', ids)
    if (res.error) return { ok: false, error: errorMessage(res.error) }
    const rows = (res.data ?? []) as Array<{ contact_id: string; occurred_at: unknown }>
    if (rows.length >= PAGE_SIZE) return { ok: false, error: 'too many lead-form touchpoints to read them all' }
    for (const row of rows) {
      if (typeof row.occurred_at !== 'string' || Number.isNaN(Date.parse(row.occurred_at))) continue
      const known = firstTouch.get(row.contact_id)
      if (known === undefined || Date.parse(row.occurred_at) < Date.parse(known)) {
        firstTouch.set(row.contact_id, row.occurred_at)
      }
    }
  }
  return { ok: true, firstTouch }
}

/** The earlier of two timestamps; an unreadable second one is ignored. */
function earlierOf(createdAt: string, other: string | undefined): string {
  if (other === undefined) return createdAt
  const otherMs = Date.parse(other)
  if (Number.isNaN(otherMs)) return createdAt
  return otherMs < Date.parse(createdAt) ? other : createdAt
}

function timeOf(value: string): number {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

/**
 * Contact rows + identities + first touches -> ShadowContact: primary e-mail first, unique addresses, oldest lead first.
 * `createdAt` is the LEAD time (the earlier of the contact's creation and its first lead-form touchpoint).
 */
function assembleContacts(
  rows: readonly ContactRow[],
  identitiesByContact: Map<string, string[]>,
  firstTouch: Map<string, string>,
): ShadowContact[] {
  const contacts: ShadowContact[] = rows.map((row) => {
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
    return { contactId: row.id, createdAt: earlierOf(row.created_at, firstTouch.get(row.id)), primaryEmail, addresses }
  })
  contacts.sort((a, b) => {
    const byTime = timeOf(a.createdAt) - timeOf(b.createdAt)
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime
    if (a.contactId < b.contactId) return -1
    if (a.contactId > b.contactId) return 1
    return 0
  })
  return contacts
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

/**
 * Reads these contacts (with their e-mail identities and first lead-form touch) and builds the ShadowContacts.
 * `sinceIso` keeps only contacts created since then (the sweep's window); null keeps every contact asked for.
 */
async function loadContactsWithTimes(
  db: SupabaseClient,
  args: { clientId: string; contactIds: readonly string[]; sources: readonly string[]; sinceIso: string | null },
): Promise<ContactsRead> {
  const { clientId, contactIds, sources, sinceIso } = args
  const rows: ContactRow[] = []
  for (const ids of chunk(contactIds, CHUNK_SIZE)) {
    let query = db.from('contacts').select('id, created_at, primary_email').eq('client_id', clientId).in('id', ids)
    if (sinceIso !== null) query = query.gte('created_at', sinceIso)
    const res = await query
    if (res.error) return { ok: false, error: errorMessage(res.error) }
    rows.push(...((res.data ?? []) as ContactRow[]))
  }
  if (rows.length === 0) return { ok: true, contacts: [] }

  const found = rows.map((r) => r.id)
  const touches = await loadFirstTouches(db, clientId, found, sources)
  if (!touches.ok) return touches
  const identities = await loadEmailIdentities(db, clientId, found)
  if (!identities.ok) return identities
  return { ok: true, contacts: assembleContacts(rows, identities.byContact, touches.firstTouch) }
}

/**
 * The new lead contacts of a client since a time: contacts CREATED since then that have a touchpoint from one of the
 * audience sources. Starts from the touchpoints (the lead volume is small and bounded) rather than from every contact
 * created in the window: a bulk import of non-lead contacts must not stop the sweep.
 */
export async function loadLeadContacts(
  db: SupabaseClient,
  args: { clientId: string; sinceIso: string; sources: readonly string[] },
): Promise<ContactsRead> {
  const { clientId, sinceIso, sources } = args
  try {
    // Step 1: the lead-form touchpoints stored since then, page by page.
    const ids: string[] = []
    const seen = new Set<string>()
    let lastPageFull = false
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await db
        .from('contact_touchpoints')
        .select('contact_id')
        .eq('client_id', clientId)
        .in('source', [...sources])
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (res.error) return { ok: false, error: errorMessage(res.error) }
      const rows = (res.data ?? []) as Array<{ contact_id: string }>
      for (const row of rows) {
        if (seen.has(row.contact_id)) continue
        seen.add(row.contact_id)
        ids.push(row.contact_id)
      }
      lastPageFull = rows.length >= PAGE_SIZE
      if (!lastPageFull) break
    }
    if (lastPageFull) return { ok: false, error: 'too many lead-form touchpoints in the window to check them all' }
    if (ids.length === 0) return { ok: true, contacts: [] }

    // Steps 2-4: the contacts created in the window, their lead time and e-mail identities.
    return await loadContactsWithTimes(db, { clientId, contactIds: ids, sources, sinceIso })
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** Specific contacts again (used inside a chunk step, so no e-mail address travels between steps). */
export async function loadContactsByIds(
  db: SupabaseClient,
  args: { clientId: string; contactIds: readonly string[]; sources: readonly string[] },
): Promise<ContactsRead> {
  const { clientId, contactIds, sources } = args
  if (contactIds.length === 0) return { ok: true, contacts: [] }
  try {
    return await loadContactsWithTimes(db, { clientId, contactIds, sources, sinceIso: null })
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
    // No address in the detail: it ends up in the plan, the step output and the run log.
    return { ok: false, reason: 'missing', detail: `${missing.length} of ${required.length} required mailboxes are not connected` }
  }
  return { ok: true }
}

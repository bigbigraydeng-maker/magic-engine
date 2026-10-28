/**
 * Production data for the template send gates: published catalog facts, contact / call evidence, sender name,
 * earlier receipts, and the four frequency sources. Everything is scoped to ONE client, fixed when the gates are built.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import { findConnectedCallEvidence, type PhoneTouch } from './call-evidence'
import { createFrequencySources, type FrequencySourceDeps, type MailboxRef } from './frequency-sources-prod'
import { findSentTemplateReceiptsSince } from './receipt-store'
import {
  GATE_MESSAGES,
  createSendGates,
  emptyMeta,
  type ContactView,
  type FactsLoad,
  type MailNewGates,
  type SendGateData,
  type SendMeta,
} from './send-gates'
import { getCurrentTemplate } from './template-store'
import { loadClientTimeZone } from './time-zone'

export interface SendGatesProdArgs {
  clientId: string
  listActiveMailboxes: FrequencySourceDeps['listActiveMailboxes']
  graphGetPage: FrequencySourceDeps['graphGetPage']
}

interface Loaders {
  loadPublishedTourFacts: typeof loadPublishedTourFacts
}

function normaliseAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null
}

async function loadFacts(db: SupabaseClient, loaders: Loaders, clientId: string, today: string): Promise<FactsLoad> {
  try {
    const read = await loaders.loadPublishedTourFacts(db, clientId, today)
    // Nothing published yet: an empty catalog (every tour page is then "not on sale"), version 0.
    return read.published ? { ok: true, version: read.version, tours: read.tours } : { ok: true, version: 0, tours: [] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function loadContactView(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
  callWindowHours: number,
  now: Date,
): Promise<ContactView | null> {
  const contact = await db.from('contacts').select('display_name, primary_email').eq('id', contactId).eq('client_id', clientId).maybeSingle()
  if (contact.error) throw new Error(`contacts: ${contact.error.message}`)
  if (!contact.data) return null
  const row = contact.data as { display_name: string | null; primary_email: string | null }

  const identities = await db.from('contact_identities').select('value').eq('contact_id', contactId).eq('client_id', clientId).eq('kind', 'email')
  if (identities.error) throw new Error(`contact_identities: ${identities.error.message}`)
  const addresses = new Set<string>()
  const primary = normaliseAddress(row.primary_email)
  if (primary !== null) addresses.add(primary)
  for (const identity of (identities.data as Array<{ value: string }> | null) ?? []) {
    const address = normaliseAddress(identity.value)
    if (address !== null) addresses.add(address)
  }

  const since = new Date(now.getTime() - callWindowHours * 3_600_000).toISOString()
  const touches = await db
    .from('contact_touchpoints')
    .select('occurred_at, source, metadata')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('channel', 'phone')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(50)
  if (touches.error) throw new Error(`contact_touchpoints: ${touches.error.message}`)
  const phone: PhoneTouch[] = ((touches.data as Array<{ occurred_at: string; source: string | null; metadata: Record<string, unknown> | null }> | null) ?? []).map(
    (t) => ({ occurredAt: t.occurred_at, source: t.source, metadata: t.metadata }),
  )
  const evidence = findConnectedCallEvidence(phone, now, callWindowHours)
  return { displayName: row.display_name, addresses: Array.from(addresses), callEvidenceAt: evidence === null ? null : evidence.at }
}

async function loadSenderName(db: SupabaseClient, clientId: string, email: string): Promise<string | null> {
  const rows = await db.from('client_portal_users').select('display_name').eq('client_id', clientId).eq('email', email.trim().toLowerCase()).limit(1)
  if (rows.error) throw new Error(`client_portal_users: ${rows.error.message}`)
  const first = ((rows.data as Array<{ display_name: string | null }> | null) ?? [])[0]
  return first?.display_name ?? null
}

export function createSendGateData(
  db: SupabaseClient,
  args: SendGatesProdArgs,
  loaders: Loaders = { loadPublishedTourFacts },
): SendGateData {
  return {
    loadTemplate: (clientId, key) => getCurrentTemplate(db, clientId, key),
    loadFacts: (clientId, today) => loadFacts(db, loaders, clientId, today),
    loadContactView: (clientId, contactId, hours, now) => loadContactView(db, clientId, contactId, hours, now),
    loadSenderName: (clientId, email) => loadSenderName(db, clientId, email),
    sentTemplateReceiptsSince: (clientId, contactId, sinceIso) => findSentTemplateReceiptsSince(db, clientId, contactId, sinceIso),
    loadTimeZone: (clientId) => loadClientTimeZone(db, clientId),
    frequencySources: createFrequencySources({
      db,
      clientId: args.clientId,
      listActiveMailboxes: args.listActiveMailboxes,
      graphGetPage: args.graphGetPage,
    }),
  }
}

// The frequency sources are bound to one client; a call for another client is refused instead of answered wrongly.
export function guardClient(clientId: string, inner: MailNewGates): MailNewGates {
  const refuse = (meta: SendMeta) => ({
    ok: false as const,
    status: 503 as const,
    reason: 'internal_error' as const,
    error: GATE_MESSAGES.internal_error,
    meta,
  })
  return {
    preLock: (a) => (a.clientId === clientId ? inner.preLock(a) : Promise.resolve(refuse(emptyMeta()))),
    inLock: (a) => (a.clientId === clientId ? inner.inLock(a) : Promise.resolve(refuse(a.meta))),
  }
}

export function createSendGatesProd(args: SendGatesProdArgs): MailNewGates {
  return guardClient(args.clientId, createSendGates(createSendGateData(supabaseAdmin, args)))
}

export type { MailboxRef }

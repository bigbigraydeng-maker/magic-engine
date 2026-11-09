/**
 * Applies one stored provider receipt to the send ledger (the consumer of `crm.provider_event.received`).
 *
 * Which letter is it about? In this order:
 *  1. the ledger row with the receipt's provider message id;
 *  2. the row named by the letter's own `triggered_send_id` tag, when the receipt carries it (exact: we set that tag);
 *  3. a row of the same address (fingerprint) that has no message id yet and was attempted in the last 2 days — a send
 *     whose outcome was unknown, or one a person marked "not sent". A row that is still `pending` is given a few minutes
 *     first (`in_flight`): its sender is probably about to record the id itself.
 *  4. otherwise it is not one of ours (ME's own system mail shares the Resend account, PM 2026-11-10 「共用」): nothing
 *     happens, nothing is retried, nothing is reported.
 * The update is compare-and-set on the row's `updated_at`, so two receipts of one letter never overwrite each other.
 * A complaint also records an e-mail unsubscribe for that contact and address (e-mail only; calls are unaffected).
 * Nothing here holds an address: receipts are matched by fingerprints, and results carry ids and codes only.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.5 (implementation: §16.10).
 */

import { emailAddressSha256s } from '@/lib/crm/address-sha256'
import type { EmailUnsubscribeRecord, EmailUnsubscribeWrite } from '@/lib/crm/email-unsubscribe'
import {
  bounceKindOf,
  decideReceipt,
  isReceiptEventType,
  type ReceiptFacts,
  type ReceiptPatch,
  type ReceiptRow,
  type ReceiptStatus,
} from './receipt'

export const SEND_ID_TAG = 'triggered_send_id'
/** How far back a send without a message id can still be matched by its address. */
export const ADDRESS_MATCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000
const CAS_TRIES = 3
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The stored receipt row (provider_webhook_events). */
export interface StoredReceipt {
  eventType: string
  providerMessageId: string | null
  occurredAt: string | null
  payload: unknown
}

/** What the consumer keeps of a receipt: no address, only fingerprints. Safe to keep in workflow state. */
export interface LoadedReceipt {
  facts: ReceiptFacts | null
  tagSendId: string | null
  toFingerprints: string[]
}

export type UpdateResult = 'updated' | 'changed' | 'stale' | 'conflict'

export interface ReceiptStore {
  findByMessageId(messageId: string): Promise<ReceiptRow[]>
  findById(id: string): Promise<ReceiptRow | null>
  findUnboundByAddress(fingerprints: readonly string[], sinceIso: string): Promise<ReceiptRow[]>
  /** Writes the patch only if the row still has the `updatedAt` it was read with. Throws on a database error. */
  updateIfUnchanged(row: ReceiptRow, patch: ReceiptPatch): Promise<UpdateResult>
  recordUnsubscribe(input: EmailUnsubscribeRecord): Promise<EmailUnsubscribeWrite>
}

export type ReceiptOutcome =
  | { outcome: 'applied'; sendId: string; status: ReceiptStatus }
  | { outcome: 'unchanged'; sendId: string; reason: string }
  | { outcome: 'in_flight'; sendId: string }
  | { outcome: 'conflict'; sendId: string | null }
  | { outcome: 'ambiguous' }
  | { outcome: 'not_ours' }
  | { outcome: 'not_a_receipt' }

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) return null
  return d.toISOString()
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The `triggered_send_id` tag, whether the receipt lists tags as an object or as name/value pairs. */
export function tagSendIdOf(tags: unknown): string | null {
  let value: unknown = null
  if (Array.isArray(tags)) {
    const hit = tags.map(record).find((t) => t !== null && t.name === SEND_ID_TAG)
    value = hit?.value ?? null
  } else {
    value = record(tags)?.[SEND_ID_TAG] ?? null
  }
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

/** Recipient fingerprints. Accepts plain addresses and "Name <address>". */
export function recipientFingerprints(to: unknown): string[] {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : []
  const addresses = list
    .filter((a): a is string => typeof a === 'string')
    .map((a) => /<([^<>\s]+)>\s*$/.exec(a)?.[1] ?? a)
  return emailAddressSha256s(addresses)
}

/** Read what the consumer needs from a stored receipt. A type we do not follow gives `facts: null`. */
export function loadReceipt(stored: StoredReceipt): LoadedReceipt {
  const data = record(record(stored.payload)?.data)
  const toFingerprints = recipientFingerprints(data?.to)
  const tagSendId = tagSendIdOf(data?.tags)
  if (!isReceiptEventType(stored.eventType)) return { facts: null, tagSendId, toFingerprints }
  const facts: ReceiptFacts = {
    type: stored.eventType,
    messageId: stored.providerMessageId,
    occurredAt: isoOrNull(stored.occurredAt),
    emailCreatedAt: isoOrNull(data?.created_at),
    bounceKind: bounceKindOf(record(data?.bounce)?.type),
  }
  return { facts, tagSendId, toFingerprints }
}

type Match =
  | { kind: 'row'; row: ReceiptRow; bind: boolean }
  | { kind: 'in_flight'; sendId: string }
  | { kind: 'conflict'; sendId: string | null }
  | { kind: 'ambiguous' }
  | { kind: 'not_ours' }

async function matchByTag(loaded: LoadedReceipt, messageId: string | null, store: ReceiptStore): Promise<Match | null> {
  if (loaded.tagSendId === null) return null
  const row = await store.findById(loaded.tagSendId)
  if (row === null || row.dedupeScope !== 'lifetime') return null
  if (row.providerMessageId === null) return messageId === null ? null : { kind: 'row', row, bind: true }
  return row.providerMessageId === messageId ? { kind: 'row', row, bind: false } : { kind: 'conflict', sendId: row.id }
}

async function matchRow(loaded: LoadedReceipt, store: ReceiptStore, bindPending: boolean, now: Date): Promise<Match> {
  const messageId = loaded.facts?.messageId ?? null
  if (messageId !== null) {
    const rows = await store.findByMessageId(messageId)
    if (rows.length > 1) return { kind: 'ambiguous' }
    if (rows.length === 1) return { kind: 'row', row: rows[0], bind: false }
  }
  const byTag = await matchByTag(loaded, messageId, store)
  if (byTag !== null) return byTag
  if (messageId === null || loaded.toFingerprints.length === 0) return { kind: 'not_ours' }
  const since = new Date(now.getTime() - ADDRESS_MATCH_WINDOW_MS).toISOString()
  const rows = await store.findUnboundByAddress(loaded.toFingerprints, since)
  if (rows.length > 1) return { kind: 'ambiguous' }
  if (rows.length === 0) return { kind: 'not_ours' }
  if (rows[0].status === 'pending' && !bindPending) return { kind: 'in_flight', sendId: rows[0].id }
  return { kind: 'row', row: rows[0], bind: true }
}

/** A complaint stops e-mail to that contact and address. Repeats are harmless; a failed write throws (retry). */
async function recordComplaint(row: ReceiptRow, facts: ReceiptFacts, store: ReceiptStore, now: Date): Promise<void> {
  if (facts.type !== 'email.complained' || row.toAddressSha256 === null) return
  const written = await store.recordUnsubscribe({
    clientId: row.clientId,
    contactId: row.contactId,
    addressSha256: row.toAddressSha256,
    triggeredSendId: row.id,
    via: 'complaint',
    occurredAt: facts.occurredAt ?? now.toISOString(),
  })
  if (!written.ok) throw new Error(`complaint unsubscribe not recorded: ${written.error}`)
}

/** Apply one receipt. Throws only on database errors (the workflow step is then retried; every write is idempotent). */
export async function applyReceipt(
  loaded: LoadedReceipt,
  store: ReceiptStore,
  opts: { bindPending: boolean; now: Date },
): Promise<ReceiptOutcome> {
  const facts = loaded.facts
  if (facts === null) return { outcome: 'not_a_receipt' }
  const match = await matchRow(loaded, store, opts.bindPending, opts.now)
  if (match.kind === 'in_flight') return { outcome: 'in_flight', sendId: match.sendId }
  if (match.kind === 'conflict') return { outcome: 'conflict', sendId: match.sendId }
  if (match.kind !== 'row') return { outcome: match.kind }
  let row = match.row
  for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
    const decision = decideReceipt(row, facts, match.bind ? facts.messageId : null, opts.now.toISOString())
    if (decision.kind === 'unchanged') {
      if (row.status === 'complained') await recordComplaint(row, facts, store, opts.now)
      return { outcome: 'unchanged', sendId: row.id, reason: decision.reason }
    }
    const result = await store.updateIfUnchanged(row, decision.patch)
    if (result === 'updated') {
      if (decision.status === 'complained') await recordComplaint(row, facts, store, opts.now)
      return { outcome: 'applied', sendId: row.id, status: decision.status }
    }
    if (result === 'stale') return { outcome: 'unchanged', sendId: row.id, reason: 'not_forward' }
    if (result === 'conflict') return { outcome: 'conflict', sendId: row.id }
    const fresh = await store.findById(row.id)
    if (fresh === null) return { outcome: 'not_ours' }
    if (match.bind && fresh.providerMessageId !== null && fresh.providerMessageId !== facts.messageId) {
      return { outcome: 'conflict', sendId: row.id }
    }
    row = fresh
  }
  throw new Error('ledger row kept changing while a receipt was applied; retry later')
}

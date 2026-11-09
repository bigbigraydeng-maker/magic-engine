/**
 * Applies one stored provider receipt to the send ledger (the consumer of `crm.provider_event.received`).
 *
 * A receipt is only ever applied to a letter it names EXACTLY:
 *  1. the ledger row with the receipt's provider message id;
 *  2. the row the letter itself names: its `triggered_send_id` tag, or the send of a correctly signed unsubscribe link
 *     in its List-Unsubscribe header (the signature is checked; the token never leaves the load step).
 * Nothing is ever matched by address: the same Resend account also sends ME's system mail, and anyone can make it mail
 * any address (a contact form), so "same address, close in time" is not proof (review 2026-11-10, both reviewers).
 * The address is used for one thing only: when a row of that address is still `pending` without a message id, its
 * sender is probably about to record the id, so the receipt is retried a few times before it is given up ("unmatched").
 * Everything else is ME's own system mail ("not ours"): nothing happens, nothing is retried, nothing is reported.
 *
 * The update is compare-and-set on the row's `updated_at`, so two receipts of one letter never overwrite each other.
 * A complaint about an exactly named letter always records an e-mail unsubscribe for its contact and address (e-mail
 * only; calls are unaffected), even when the ledger itself cannot move.
 * Nothing here holds an address or a token: results carry ids and codes only.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.5 (implementation: §16.10).
 */

import type { EmailUnsubscribeRecord, EmailUnsubscribeWrite } from '@/lib/crm/email-unsubscribe'
import type { ProviderReceipt } from '@/lib/messaging/provider-events/resend-receipt'
import { decideReceipt, type ReceiptFacts, type ReceiptKind, type ReceiptPatch, type ReceiptRow } from './receipt'
import { verifyUnsubscribeToken, type EnvReader } from './unsubscribe-token'

export const SEND_ID_TAG = 'triggered_send_id'
/** A `pending` row this recent may still be recording its message id: a receipt to its address is retried. */
export const IN_FLIGHT_WINDOW_MS = 30 * 60 * 1000
const CAS_TRIES = 3
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UNSUBSCRIBE_PATH_RE = /\/api\/u\/([A-Za-z0-9_-]{16,300}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g

/** A ledger row the letter names itself. `clientId` is known when it came from a signed link. */
export interface SendHint {
  sendId: string
  clientId: string | null
}

/** What the consumer keeps of a receipt: no address, no token. Safe to keep in workflow state. */
export interface LoadedReceipt {
  facts: ReceiptFacts | null
  hints: SendHint[]
  toFingerprints: string[]
}

export type UpdateResult = 'updated' | 'changed' | 'stale' | 'conflict'

export interface ReceiptStore {
  findByMessageId(messageId: string): Promise<ReceiptRow[]>
  findById(id: string): Promise<ReceiptRow | null>
  /** Live rows still `pending` without a message id, of these addresses, attempted since `sinceIso`. */
  findPendingByAddress(fingerprints: readonly string[], sinceIso: string): Promise<ReceiptRow[]>
  /** Writes the patch only if the row still has the `updatedAt` it was read with. Throws on a database error. */
  updateIfUnchanged(row: ReceiptRow, patch: ReceiptPatch): Promise<UpdateResult>
  recordUnsubscribe(input: EmailUnsubscribeRecord): Promise<EmailUnsubscribeWrite>
}

export type ReceiptOutcome =
  | { outcome: 'applied'; sendId: string; status: ReceiptKind }
  | { outcome: 'unchanged'; sendId: string; reason: string }
  | { outcome: 'in_flight'; sendId: string }
  | { outcome: 'unmatched'; sendId: string }
  | { outcome: 'conflict'; sendId: string }
  | { outcome: 'ambiguous' }
  | { outcome: 'not_ours' }
  | { outcome: 'not_a_receipt' }

/** The signed unsubscribe tokens inside List-Unsubscribe header values. */
export function unsubscribeTokensIn(headerValues: readonly string[]): string[] {
  const out: string[] = []
  for (const value of headerValues) {
    for (const m of value.matchAll(UNSUBSCRIBE_PATH_RE)) out.push(m[1])
  }
  return out
}

/**
 * The exact identity a receipt carries, and its provider-neutral facts. Runs inside the load step, so a token is
 * checked and dropped there: only the send id it names (and its client) goes on.
 */
export function identifyLetter(receipt: ProviderReceipt, env: EnvReader): LoadedReceipt {
  const hints = new Map<string, SendHint>()
  const tag = receipt.tags[SEND_ID_TAG]
  if (tag !== undefined && UUID_RE.test(tag)) hints.set(tag, { sendId: tag, clientId: null })
  for (const token of unsubscribeTokensIn(receipt.listUnsubscribe)) {
    const verified = verifyUnsubscribeToken(token, env)
    if (verified.ok) hints.set(verified.payload.sendId, { sendId: verified.payload.sendId, clientId: verified.payload.clientId })
  }
  const facts: ReceiptFacts | null =
    receipt.kind === null
      ? null
      : {
          kind: receipt.kind,
          eventType: receipt.eventType,
          messageId: receipt.messageId,
          occurredAt: receipt.occurredAt,
          emailCreatedAt: receipt.emailCreatedAt,
          bounceKind: receipt.bounceKind,
        }
  return { facts, hints: Array.from(hints.values()), toFingerprints: [...receipt.toFingerprints] }
}

type Match =
  | { kind: 'row'; row: ReceiptRow; bind: boolean }
  | { kind: 'conflict'; row: ReceiptRow }
  | { kind: 'in_flight' | 'unmatched'; sendId: string }
  | { kind: 'ambiguous' | 'not_ours' }

/** The live rows the letter names itself (a signed link must name a row of its own client). */
async function namedRows(hints: readonly SendHint[], store: ReceiptStore): Promise<ReceiptRow[]> {
  const rows: ReceiptRow[] = []
  for (const hint of hints) {
    const row = await store.findById(hint.sendId)
    if (row === null || row.dedupeScope !== 'lifetime') continue
    if (hint.clientId !== null && row.clientId !== hint.clientId) continue
    if (!rows.some((r) => r.id === row.id)) rows.push(row)
  }
  return rows
}

async function matchRow(loaded: LoadedReceipt, store: ReceiptStore, lastTry: boolean, now: Date): Promise<Match> {
  const messageId = loaded.facts?.messageId ?? null
  if (messageId !== null) {
    const rows = await store.findByMessageId(messageId)
    if (rows.length > 1) return { kind: 'ambiguous' }
    if (rows.length === 1) return { kind: 'row', row: rows[0], bind: false }
  }
  const named = await namedRows(loaded.hints, store)
  if (named.length > 1) return { kind: 'ambiguous' }
  if (named.length === 1) {
    const row = named[0]
    if (row.providerMessageId === null) return { kind: 'row', row, bind: messageId !== null }
    return row.providerMessageId === messageId ? { kind: 'row', row, bind: false } : { kind: 'conflict', row }
  }
  if (messageId === null || loaded.toFingerprints.length === 0) return { kind: 'not_ours' }
  const since = new Date(now.getTime() - IN_FLIGHT_WINDOW_MS).toISOString()
  const pending = await store.findPendingByAddress(loaded.toFingerprints, since)
  if (pending.length === 0) return { kind: 'not_ours' }
  return { kind: lastTry ? 'unmatched' : 'in_flight', sendId: pending[0].id }
}

/** A complaint stops e-mail to the contact and address of the named letter. Repeats are harmless; a failed write throws. */
async function recordComplaint(row: ReceiptRow, facts: ReceiptFacts, store: ReceiptStore, now: Date): Promise<void> {
  if (facts.kind !== 'complained' || row.dedupeScope !== 'lifetime' || row.toAddressSha256 === null) return
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

async function writeReceipt(first: ReceiptRow, bind: boolean, facts: ReceiptFacts, store: ReceiptStore, now: Date): Promise<ReceiptOutcome> {
  let row = first
  for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
    const decision = decideReceipt(row, facts, bind ? facts.messageId : null, now.toISOString())
    const result: UpdateResult | 'unchanged' = decision.kind === 'unchanged' ? 'unchanged' : await store.updateIfUnchanged(row, decision.patch)
    if (result !== 'changed') await recordComplaint(row, facts, store, now)
    if (decision.kind === 'unchanged') return { outcome: 'unchanged', sendId: row.id, reason: decision.reason }
    if (result === 'updated') return { outcome: 'applied', sendId: row.id, status: decision.status }
    if (result === 'stale') return { outcome: 'unchanged', sendId: row.id, reason: 'not_forward' }
    if (result === 'conflict') return { outcome: 'conflict', sendId: row.id }
    const fresh = await store.findById(row.id)
    if (fresh === null) return { outcome: 'not_ours' }
    if (bind && fresh.providerMessageId !== null && fresh.providerMessageId !== facts.messageId) {
      await recordComplaint(fresh, facts, store, now)
      return { outcome: 'conflict', sendId: fresh.id }
    }
    row = fresh
  }
  throw new Error('ledger row kept changing while a receipt was applied; retry later')
}

/**
 * Apply one receipt. `lastTry` = the final attempt of the workflow: a still-pending row of the address is then reported
 * as "unmatched" instead of waited for. Throws only on database errors (the step is retried; every write is idempotent).
 */
export async function applyReceipt(
  loaded: LoadedReceipt,
  store: ReceiptStore,
  opts: { lastTry: boolean; now: Date },
): Promise<ReceiptOutcome> {
  const facts = loaded.facts
  if (facts === null) return { outcome: 'not_a_receipt' }
  const match = await matchRow(loaded, store, opts.lastTry, opts.now)
  if (match.kind === 'row') return writeReceipt(match.row, match.bind, facts, store, opts.now)
  if (match.kind === 'conflict') {
    await recordComplaint(match.row, facts, store, opts.now)
    return { outcome: 'conflict', sendId: match.row.id }
  }
  if (match.kind === 'in_flight' || match.kind === 'unmatched') return { outcome: match.kind, sendId: match.sendId }
  return { outcome: match.kind }
}

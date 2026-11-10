/**
 * The database side of real sending: the live ledger rows (`triggered_sends`, `dedupe_scope='lifetime'`), the claim
 * function, the guest as a letter needs it, both locks, and the replay of receipts that arrived before the message id.
 *
 * 🔴 Every write that follows a read is a compare-and-set on `updated_at` (and the status it was read with): a receipt
 *    or another run that changed the row in between wins, and the caller reads again (design P2 §4.2, §16.10).
 * 🔴 `pending` is never written here: only `triggered_send_claim` may (the table's guards refuse anyone else, §3.2).
 * 🔴 Errors are returned as codes only (a failed write may echo the whole row back).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readResendReceipt } from '@/lib/messaging/provider-events/resend-receipt'
import type { StoredProviderEvent } from '@/lib/messaging/provider-events/receipt-types'
import { applyReceipt, identifyLetter } from './receipt-consumer'
import { createReceiptStore } from './receipt-store-prod'
import { loadContactsByIds } from './shadow-reads-prod'
import type { CasWrite, ClaimInput, ClaimOutcome, ClaimRead, ContactLoad, DecisionWrite, EnvReader, LedgerWrite, LifetimeRow, SendLedger, SendLocks } from './send-types'

const TABLE = 'triggered_sends'
const COLUMNS = 'id, contact_id, status, reason_code, authorization_id, idempotency_key, rendered_sha256, to_address_sha256, first_attempt_at, provider_message_id, updated_at'
/** How long a claimed letter is ours before another run may take it over (§3.3; the claim allows 1–30). */
export const CLAIM_LEASE_MINUTES = 10
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CLAIM_OUTCOMES: ReadonlySet<string> = new Set([
  'claimed', 'takeover', 'in_flight', 'exists_terminal', 'expired_unknown', 'address_duplicate', 'cap_reached', 'auth_inactive', 'rule_invalid', 'template_mismatch',
])

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'error'
}

interface DbRow {
  id: string
  contact_id: string
  status: string
  reason_code: string | null
  authorization_id: string | null
  idempotency_key: string | null
  rendered_sha256: string | null
  to_address_sha256: string | null
  first_attempt_at: string | null
  provider_message_id: string | null
  updated_at: string
}

function toRow(r: DbRow): LifetimeRow {
  return {
    id: r.id,
    contactId: r.contact_id,
    status: r.status,
    reasonCode: r.reason_code,
    authorizationId: r.authorization_id,
    idempotencyKey: r.idempotency_key,
    renderedSha256: r.rendered_sha256,
    toAddressSha256: r.to_address_sha256,
    firstAttemptAt: r.first_attempt_at,
    providerMessageId: r.provider_message_id,
    updatedAt: r.updated_at,
  }
}

function isClaimOutcome(value: unknown): value is ClaimOutcome {
  return typeof value === 'string' && CLAIM_OUTCOMES.has(value)
}

function parseClaim(data: unknown): ClaimRead {
  const first: unknown = Array.isArray(data) ? data[0] : undefined
  if (typeof first !== 'object' || first === null) return { ok: false, error: 'claim: unexpected answer' }
  const row = first as Record<string, unknown>
  if (!isClaimOutcome(row.outcome)) return { ok: false, error: 'claim: unexpected answer' }
  const sendId = typeof row.send_id === 'string' ? row.send_id : null
  const key = typeof row.row_idempotency_key === 'string' ? row.row_idempotency_key : null
  return { ok: true, outcome: row.outcome, sendId, idempotencyKey: key }
}

/** A guarded update: exactly one row = written; none = the row changed since it was read. */
async function casUpdate(db: SupabaseClient, row: LifetimeRow, fromStatus: string, patch: Record<string, unknown>): Promise<CasWrite> {
  const { data, error } = await db.from(TABLE).update(patch).eq('id', row.id).eq('status', fromStatus).eq('updated_at', row.updatedAt).select('id')
  if (error) return { ok: false, error: `ledger update: ${codeOf(error)}` }
  return { ok: true, result: (data ?? []).length === 1 ? 'updated' : 'changed' }
}

async function insertDecision(db: SupabaseClient, d: DecisionWrite): Promise<LedgerWrite> {
  const { error } = await db.from(TABLE).insert({
    client_id: d.clientId,
    trigger_key: 'welcome',
    channel: 'email',
    contact_id: d.contactId,
    dedupe_scope: 'lifetime',
    status: d.status,
    reason_code: d.reasonCode,
    authorization_id: d.authorizationId,
    annotations: d.annotations,
    to_address_sha256: d.toAddressSha256,
    consent_basis: d.consentBasis,
    source_ref: d.sourceRef,
  })
  return error ? { ok: false, error: `ledger insert: ${codeOf(error)}` } : { ok: true }
}

async function claimRpc(db: SupabaseClient, input: ClaimInput): Promise<ClaimRead> {
  const { data, error } = await db.rpc('triggered_send_claim', {
    p_authorization_id: input.authorizationId,
    p_contact_id: input.contactId,
    p_to_address_sha256: input.toAddressSha256,
    p_idempotency_key: input.idempotencyKey,
    p_template_key: input.templateKey,
    p_template_version: input.templateVersion,
    p_template_sha256: input.templateSha256,
    p_rendered_sha256: input.renderedSha256,
    p_source_ref: input.sourceRef,
    p_consent_basis: input.consentBasis,
    p_lease_minutes: CLAIM_LEASE_MINUTES,
  })
  if (error) return { ok: false, error: `claim: ${codeOf(error)}` }
  return parseClaim(data)
}

export function createSendLedger(db: SupabaseClient): SendLedger {
  const live = () => db.from(TABLE).select(COLUMNS).eq('trigger_key', 'welcome').eq('channel', 'email').eq('dedupe_scope', 'lifetime')
  return {
    async rowsFor(clientId, contactIds) {
      if (contactIds.length === 0) return { ok: true, rows: [] }
      const { data, error } = await live().eq('client_id', clientId).in('contact_id', [...contactIds])
      if (error) return { ok: false, error: `ledger read: ${codeOf(error)}` }
      return { ok: true, rows: ((data as DbRow[] | null) ?? []).map(toRow) }
    },
    async rowById(clientId, id) {
      const { data, error } = await live().eq('client_id', clientId).eq('id', id).maybeSingle()
      if (error) return { ok: false, error: `ledger read: ${codeOf(error)}` }
      return { ok: true, row: data === null ? null : toRow(data as DbRow) }
    },
    async recordDecision(d) {
      if (d.existing === null) return insertDecision(db, d)
      if (d.existing.status !== 'blocked') return { ok: false, error: 'ledger: only a blocked row may be decided again' }
      const patch = { status: d.status, reason_code: d.reasonCode, authorization_id: d.authorizationId, annotations: d.annotations, to_address_sha256: d.toAddressSha256, consent_basis: d.consentBasis, source_ref: d.sourceRef }
      const written = await casUpdate(db, d.existing, 'blocked', patch)
      if (!written.ok) return written
      return written.result === 'updated' ? { ok: true } : { ok: false, error: 'ledger: the row changed' }
    },
    async noteBlock(row, reasonCode) {
      const written = await casUpdate(db, row, 'pending', { last_block_reason: reasonCode })
      if (!written.ok) return written
      // Changed meanwhile (a receipt moved it on): there is nothing to note any more.
      return { ok: true }
    },
    claim: (input) => claimRpc(db, input),
    markSent: (row, input) =>
      casUpdate(db, row, 'pending', { status: 'sent', provider_message_id: input.messageId, provider_account: input.account, sent_at: input.sentAt, provider_impact: 'PROVIDER_ACCEPTED' }),
    markFailed: (row, input) => casUpdate(db, row, 'pending', { status: 'failed', reason_code: input.reasonCode, provider_account: input.account }),
  }
}

/** One guest as a letter needs it: the rehearsal's view (same audience filter) plus the display name. */
export async function loadSendContact(db: SupabaseClient, args: { clientId: string; contactId: string; sources: readonly string[] }): Promise<ContactLoad> {
  if (!UUID_RE.test(args.contactId)) return { ok: false, error: 'contact id is not a uuid' }
  const read = await loadContactsByIds(db, { clientId: args.clientId, contactIds: [args.contactId], sources: args.sources })
  if (!read.ok) return read
  const contact = read.contacts.find((c) => c.contactId === args.contactId)
  if (contact === undefined) return { ok: true, contact: null }
  const { data, error } = await db.from('contacts').select('display_name').eq('client_id', args.clientId).eq('id', args.contactId).maybeSingle()
  if (error) return { ok: false, error: `contact name: ${codeOf(error)}` }
  const name = (data as { display_name: unknown } | null)?.display_name
  return { ok: true, contact: { ...contact, displayName: typeof name === 'string' ? name : null } }
}

/** The holder label of ME's own lock rows (the sales side writes its mailbox there). */
export const SEND_LOCK_HOLDER = 'me-send'

interface LockStore {
  acquireContactLock(clientId: string, contactId: string, mailbox: string): Promise<boolean>
  releaseContactLock(clientId: string, contactId: string): Promise<void>
  acquireRecipientLock(clientId: string, recipient: string, mailbox: string): Promise<boolean>
  releaseRecipientLock(clientId: string, recipient: string): Promise<void>
}

/** The SAME two locks the sales side takes (`mail-send-new.ts`): a person and ME can never write to a guest at once. */
export function createSendLocks(store: LockStore): SendLocks {
  return {
    async take(clientId, contactId, address) {
      try {
        if (!(await store.acquireContactLock(clientId, contactId, SEND_LOCK_HOLDER))) return { ok: true, held: false }
        let recipient = false
        try {
          recipient = await store.acquireRecipientLock(clientId, address, SEND_LOCK_HOLDER)
        } finally {
          if (!recipient) await store.releaseContactLock(clientId, contactId).catch(() => undefined)
        }
        return { ok: true, held: recipient }
      } catch (err) {
        return { ok: false, error: `lock: ${err instanceof Error ? err.name : 'error'}` }
      }
    },
    async release(clientId, contactId, address) {
      await store.releaseRecipientLock(clientId, address).catch(() => undefined)
      await store.releaseContactLock(clientId, contactId).catch(() => undefined)
    },
  }
}

/**
 * The receipts already stored for a message id, applied now (§16.10: a receipt that came before the sender wrote the
 * message id waited, found nothing to bind and is not delivered a second time by the provider). Never throws.
 */
export async function replayStoredReceipts(db: SupabaseClient, messageId: string, env: EnvReader, now: () => Date): Promise<{ applied: number; error: string | null }> {
  try {
    const { data, error } = await db
      .from('provider_webhook_events')
      .select('event_type, provider_message_id, occurred_at, payload')
      .eq('provider', 'resend')
      .eq('provider_message_id', messageId)
      .order('received_at', { ascending: true })
      .limit(20)
    if (error) return { applied: 0, error: `receipts read: ${codeOf(error)}` }
    const store = createReceiptStore(db)
    let applied = 0
    for (const raw of (data as Array<{ event_type: string; provider_message_id: string | null; occurred_at: string | null; payload: unknown }> | null) ?? []) {
      const stored: StoredProviderEvent = { eventType: raw.event_type, providerMessageId: raw.provider_message_id, occurredAt: raw.occurred_at, payload: raw.payload }
      const outcome = await applyReceipt(identifyLetter(readResendReceipt(stored), env), store, { lastTry: true, now: now() })
      if (outcome.outcome === 'applied') applied += 1
    }
    return { applied, error: null }
  } catch (err) {
    return { applied: 0, error: `receipts replay: ${err instanceof Error ? err.name : 'error'}` }
  }
}

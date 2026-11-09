/**
 * The Supabase side of the receipt consumer: reads the stored receipt and the send ledger, writes the ledger with
 * compare-and-set, records a complaint's unsubscribe. Errors are passed on as codes only: the details of a failed write
 * can echo a whole row.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.5 (implementation: §16.10).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordEmailUnsubscribe } from '@/lib/crm/email-unsubscribe'
import type { ReceiptPatch, ReceiptRow } from './receipt'
import { NOT_SENT_CONFIRMED } from './receipt'
import type { ReceiptStore, StoredReceipt, UpdateResult } from './receipt-consumer'

const LEDGER = 'triggered_sends'
const COLUMNS =
  'id, client_id, contact_id, dedupe_scope, status, reason_code, provider_message_id, to_address_sha256, sent_at, provider_impact, first_attempt_at, updated_at'
const SHA256_RE = /^[0-9a-f]{64}$/

interface LedgerDbRow {
  id: string
  client_id: string
  contact_id: string
  dedupe_scope: string
  status: string
  reason_code: string | null
  provider_message_id: string | null
  to_address_sha256: string | null
  sent_at: string | null
  provider_impact: string
  first_attempt_at: string | null
  updated_at: string
}

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown'
}

function toRow(r: LedgerDbRow): ReceiptRow {
  return {
    id: r.id,
    clientId: r.client_id,
    contactId: r.contact_id,
    dedupeScope: r.dedupe_scope,
    status: r.status,
    reasonCode: r.reason_code,
    providerMessageId: r.provider_message_id,
    toAddressSha256: r.to_address_sha256,
    sentAt: r.sent_at,
    providerImpact: r.provider_impact,
    firstAttemptAt: r.first_attempt_at,
    updatedAt: r.updated_at,
  }
}

function rowsOf(data: unknown): ReceiptRow[] {
  return Array.isArray(data) ? (data as LedgerDbRow[]).map(toRow) : []
}

export async function loadStoredReceipt(
  db: SupabaseClient,
  key: { account: string; providerEventId: string },
): Promise<StoredReceipt | null> {
  const { data, error } = await db
    .from('provider_webhook_events')
    .select('event_type, provider_message_id, occurred_at, payload')
    .eq('provider', 'resend')
    .eq('account', key.account)
    .eq('provider_event_id', key.providerEventId)
    .maybeSingle()
  if (error) throw new Error(`receipt read: ${codeOf(error)}`)
  if (data === null) return null
  const row = data as { event_type: string; provider_message_id: string | null; occurred_at: string | null; payload: unknown }
  return { eventType: row.event_type, providerMessageId: row.provider_message_id, occurredAt: row.occurred_at, payload: row.payload }
}

export function createReceiptStore(db: SupabaseClient): ReceiptStore {
  return {
    async findByMessageId(messageId) {
      const { data, error } = await db
        .from(LEDGER)
        .select(COLUMNS)
        .eq('provider_message_id', messageId)
        .eq('dedupe_scope', 'lifetime')
        .limit(2)
      if (error) throw new Error(`ledger read: ${codeOf(error)}`)
      return rowsOf(data)
    },
    async findById(id) {
      const { data, error } = await db.from(LEDGER).select(COLUMNS).eq('id', id).maybeSingle()
      if (error) throw new Error(`ledger read: ${codeOf(error)}`)
      return data === null ? null : toRow(data as LedgerDbRow)
    },
    async findUnboundByAddress(fingerprints, sinceIso) {
      const hashes = fingerprints.filter((f) => SHA256_RE.test(f))
      if (hashes.length === 0) return []
      const { data, error } = await db
        .from(LEDGER)
        .select(COLUMNS)
        .in('to_address_sha256', hashes)
        .eq('dedupe_scope', 'lifetime')
        .is('provider_message_id', null)
        .gte('first_attempt_at', sinceIso)
        .or(`status.in.(pending,unknown_outcome),and(status.eq.failed,reason_code.eq.${NOT_SENT_CONFIRMED})`)
        .limit(2)
      if (error) throw new Error(`ledger read: ${codeOf(error)}`)
      return rowsOf(data)
    },
    async updateIfUnchanged(row, patch): Promise<UpdateResult> {
      const { data, error } = await db
        .from(LEDGER)
        .update(patch)
        .eq('id', row.id)
        .eq('updated_at', row.updatedAt)
        .select('id')
      if (error) {
        const code = codeOf(error)
        // The ledger's own guard refused a backward move (another receipt got there first): nothing to do.
        if (code === '23001' && (error as { hint?: unknown }).hint === 'status_regress') return 'stale'
        // The address is now held by another live row (only after a plain failure released it): leave it be.
        if (code === '23505') return 'conflict'
        throw new Error(`ledger update: ${code}`)
      }
      return Array.isArray(data) && data.length === 1 ? 'updated' : 'changed'
    },
    recordUnsubscribe: (input) => recordEmailUnsubscribe(db, input),
  }
}

/**
 * What one provider receipt (sent / delivered / delayed / bounced / complained / failed / suppressed) does to the send
 * ledger row of the letter it is about. Pure: no database, no clock, no provider details (those are read into a
 * provider-neutral `ProviderReceipt` in src/lib/messaging/provider-events/).
 *
 * The ledger only moves forward (status levels, §4.2): pending 1 < unknown_outcome 2 < sent 3 < delivery_delayed 4 <
 * delivered 5 < suppressed = failed 6 < bounced 7 < complained 8. A receipt that would move it back, or sideways, changes
 * nothing, so receipts that arrive out of order end in the same place. Two exceptions, both from the design:
 *  - a row a person marked "not sent" (failed + not_sent_confirmed) is overridden by any real receipt that proves
 *    otherwise (level >= sent);
 *  - a `failed` receipt never applies to a row that was delivered or more (and never to a person's "not sent" row):
 *    failed releases the address, and the letter did reach the guest (§13 writer contract).
 * Every applied receipt records which event moved the row and when, and that the provider accepted the request.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.2, §6.5 (implementation: §16.10).
 */

import type { ReceiptKind } from '@/lib/messaging/provider-events/resend-receipt'

export type { ReceiptKind }

export const RECEIPT_KINDS: readonly ReceiptKind[] = [
  'sent',
  'delivery_delayed',
  'delivered',
  'suppressed',
  'failed',
  'bounced',
  'complained',
]

/** The send group's levels, the same as triggered_send_status_rank() in the ledger migration. */
const RANK: Readonly<Record<string, number>> = {
  pending: 1,
  unknown_outcome: 2,
  sent: 3,
  delivery_delayed: 4,
  delivered: 5,
  suppressed: 6,
  failed: 6,
  bounced: 7,
  complained: 8,
}

/** Statuses that mean the letter left the provider for the guest's mail server: they fix `sent_at` when it is empty. */
const LEFT_PROVIDER: ReadonlySet<ReceiptKind> = new Set(['sent', 'delivery_delayed', 'delivered', 'bounced', 'complained'])

export const NOT_SENT_CONFIRMED = 'not_sent_confirmed'
export const PROVIDER_FAILED_REASON = 'provider_failed'

export function rankOf(status: string): number | null {
  return RANK[status] ?? null
}

/** The ledger columns a receipt reads. */
export interface ReceiptRow {
  id: string
  clientId: string
  contactId: string
  dedupeScope: string
  status: string
  reasonCode: string | null
  providerMessageId: string | null
  toAddressSha256: string | null
  sentAt: string | null
  providerImpact: string
  firstAttemptAt: string | null
  /** The row's version: an update is only written if the row still has it (compare-and-set). */
  updatedAt: string
}

/** What a receipt says, without any address. */
export interface ReceiptFacts {
  kind: ReceiptKind
  /** The provider's own event name (kept in last_event_type). */
  eventType: string
  /** The provider's id of the letter. */
  messageId: string | null
  /** When the event happened (ISO), or null when the receipt did not say. */
  occurredAt: string | null
  /** When the letter was created at the provider (ISO), or null. */
  emailCreatedAt: string | null
  /** For bounces: 'permanent' | 'transient' | 'undetermined'. */
  bounceKind: 'permanent' | 'transient' | 'undetermined' | null
}

export interface ReceiptPatch {
  status?: ReceiptKind
  provider_message_id?: string
  reason_code?: string
  bounce_kind?: 'permanent' | 'transient' | 'undetermined'
  sent_at?: string
  provider_impact?: 'PROVIDER_ACCEPTED'
  last_event_type: string
  last_event_at: string
}

export type ReceiptDecision =
  | { kind: 'update'; patch: ReceiptPatch; status: ReceiptKind }
  | { kind: 'unchanged'; reason: 'not_a_send' | 'not_forward' | 'failed_after_delivery' | 'person_marked_not_sent' }

function isPersonNotSent(row: ReceiptRow): boolean {
  return row.status === 'failed' && row.reasonCode === NOT_SENT_CONFIRMED
}

function moveAllowed(row: ReceiptRow, target: ReceiptKind): ReceiptDecision | null {
  const from = rankOf(row.status)
  const to = RANK[target]
  if (row.dedupeScope !== 'lifetime' || from === null) return { kind: 'unchanged', reason: 'not_a_send' }
  if (target === 'failed') {
    if (isPersonNotSent(row)) return { kind: 'unchanged', reason: 'person_marked_not_sent' }
    if (from >= RANK.delivered) return { kind: 'unchanged', reason: 'failed_after_delivery' }
  }
  if (isPersonNotSent(row) && to >= RANK.sent) return null
  return to > from ? null : { kind: 'unchanged', reason: 'not_forward' }
}

/**
 * Decide the update for one receipt. `bindMessageId` = the provider id to record on a row that does not have one yet
 * (the row was named exactly by the letter's own tag or signed link); null when it was found by its own message id.
 */
export function decideReceipt(
  row: ReceiptRow,
  facts: ReceiptFacts,
  bindMessageId: string | null,
  nowIso: string,
): ReceiptDecision {
  const target = facts.kind
  const refusal = moveAllowed(row, target)
  if (refusal !== null) return refusal
  const patch: ReceiptPatch = {
    status: target,
    last_event_type: facts.eventType,
    last_event_at: facts.occurredAt ?? nowIso,
  }
  if (bindMessageId !== null && row.providerMessageId === null) patch.provider_message_id = bindMessageId
  // The ledger refuses a `failed` without its reason in the same update (§13): both go together.
  if (target === 'failed') patch.reason_code = PROVIDER_FAILED_REASON
  if (target === 'bounced') patch.bounce_kind = facts.bounceKind ?? 'undetermined'
  if (LEFT_PROVIDER.has(target) && row.sentAt === null) patch.sent_at = facts.emailCreatedAt ?? facts.occurredAt ?? nowIso
  if (row.providerImpact !== 'PROVIDER_ACCEPTED') patch.provider_impact = 'PROVIDER_ACCEPTED'
  return { kind: 'update', patch, status: target }
}

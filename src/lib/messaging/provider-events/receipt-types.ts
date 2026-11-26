/**
 * Provider-neutral receipt types: what any provider's receipt is read into before the send ledger sees it. Each
 * provider has its own reader next to this file (Resend: resend-receipt.ts).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.5 (layering: §16.10).
 */

/** What a receipt says happened to a letter, whatever the provider. */
export type ReceiptKind = 'sent' | 'delivery_delayed' | 'delivered' | 'suppressed' | 'failed' | 'bounced' | 'complained'

export interface ProviderReceipt {
  /** null = a stored event type the ledger does not follow. */
  kind: ReceiptKind | null
  /** The provider's own event name, kept for the ledger's last_event_type. */
  eventType: string
  /** The provider's id of the letter. */
  messageId: string | null
  /** When the event happened (ISO), or null. */
  occurredAt: string | null
  /** When the letter was created at the provider (ISO), or null. */
  emailCreatedAt: string | null
  bounceKind: 'permanent' | 'transient' | 'undetermined' | null
  /** The letter's tags as sent (name → value), when the receipt carries them. */
  tags: Readonly<Record<string, string>>
  /** The values of the letter's List-Unsubscribe header(s), when the receipt carries its headers. */
  listUnsubscribe: readonly string[]
  /** Fingerprints of the recipients. */
  toFingerprints: readonly string[]
}

/** A stored provider event row (the columns the consumer reads). */
export interface StoredProviderEvent {
  eventType: string
  providerMessageId: string | null
  occurredAt: string | null
  payload: unknown
}

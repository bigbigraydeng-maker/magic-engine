import type { StoredReceipt } from '../types'

export type { StoredReceipt }

/** One reason a message may not go out (block) or deserves a yellow note (warning). */
export interface GateViolation {
  code: string
  detail: string
  /** Guardrail rule id, when the violation comes from a configured phrase rule. */
  ruleId?: string
  /** The link the violation is about, when it is a link (shown to the staff member only; receipts never carry it). */
  url?: string
}

export interface ContentGateResult {
  blocks: GateViolation[]
  warnings: GateViolation[]
}

// ---- frequency gate -------------------------------------------------------

export type OutboundSource = 'sent_items' | 'audit' | 'touchpoint' | 'mailchimp' | 'me_send'

/** One email we sent to one of the guest's addresses. */
export interface OutboundItem {
  source: OutboundSource
  /** Provider message id when known (Graph id); null otherwise. */
  id: string | null
  /** ISO timestamp of sending. */
  at: string
  subject: string | null
  /** Lower-case recipient address this item counts for. '' = contact-scoped (audit rows, touchpoints): counted for the primary address. */
  address: string
  /**
   * true = a mail a machine sent that still counts toward the cap (ME's own automated letters, source `me_send`). It is
   * never a person's email: anything asking "did a person write to this guest" must leave it out. It is also never
   * folded into another record as "the same mail" unless the two carry the same id (gates/frequency.ts). Absent = an
   * ordinary item.
   */
  automated?: true
}

/** A source either answers (possibly with zero items) or fails. A failure is NEVER read as zero. */
export type SourceResult =
  | { ok: true; items: OutboundItem[] }
  | { ok: false; error: string }

export interface FrequencySources {
  /** Mailbox sent-items (Graph), every connected mailbox, paged back to sinceIso, matching to/cc/bcc. */
  sentItems(addresses: readonly string[], sinceIso: string): Promise<SourceResult>
  /** Our own audit rows (conversation_outbound_log) for this contact. */
  audit(contactId: string, sinceIso: string): Promise<SourceResult>
  /** Outbound email touchpoints for this contact. */
  touchpoints(contactId: string, sinceIso: string): Promise<SourceResult>
  /** Mailchimp campaigns the addresses received. `applicable:false` = the client has no Mailchimp audience. */
  mailchimp(
    addresses: readonly string[],
    sinceIso: string,
  ): Promise<SourceResult | { ok: true; items: []; applicable: false }>
  /**
   * ME's own automated mails to these addresses (the send ledger, matched by address fingerprint, so a guest whose address
   * sits on two contact records is still counted). Every item is `automated: true`, source `me_send`.
   */
  meSends(addresses: readonly string[], sinceIso: string): Promise<SourceResult>
}

/**
 * Lists the provider message ids (Graph ids) of mails that must NOT count toward the cap: replies to a guest's own
 * enquiry, sent by templates the settings mark as exempt. It throws when it cannot list them all, and then the cap
 * fails closed (frequency_unverifiable); a failure is never read as "there are none".
 */
export type ExemptIdLoader = (sinceIso: string) => Promise<readonly string[]>

export type FrequencyVerdict =
  | { ok: true; count: number; items: OutboundItem[] }
  | {
      ok: false
      reason: 'frequency_cap'
      count: number
      items: OutboundItem[]
      /** ISO time at which the count first drops below the cap. */
      nextAllowedAt: string
    }
  | { ok: false; reason: 'frequency_unverifiable'; error: string }

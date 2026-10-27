import type { StoredReceipt } from '../types'

export type { StoredReceipt }

/** One reason a message may not go out (block) or deserves a yellow note (warning). */
export interface GateViolation {
  code: string
  detail: string
  /** Guardrail rule id, when the violation comes from a configured phrase rule. */
  ruleId?: string
}

export interface ContentGateResult {
  blocks: GateViolation[]
  warnings: GateViolation[]
}

// ---- frequency gate -------------------------------------------------------

export type OutboundSource = 'sent_items' | 'audit' | 'touchpoint' | 'mailchimp'

/** One email we sent to one of the guest's addresses. */
export interface OutboundItem {
  source: OutboundSource
  /** Provider message id when known (Graph id); null otherwise. */
  id: string | null
  /** ISO timestamp of sending. */
  at: string
  subject: string | null
  /** Lower-case recipient address this item counts for. */
  address: string
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
}

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

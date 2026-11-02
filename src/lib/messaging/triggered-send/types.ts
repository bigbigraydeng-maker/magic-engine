/**
 * Shared types of the triggered-send SHADOW run (rehearsal): every morning ME decides, per new lead, whether it
 * WOULD send the welcome e-mail, and freezes that decision as a shadow ledger row. Nothing is ever sent.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.
 */

import type { OutboundItem } from '@/lib/crm/email-templates/gates/types'

/** A lead contact as the shadow run sees it. */
export interface ShadowContact {
  contactId: string
  /**
   * ISO timestamp of when the LEAD came in: the earlier of the contact's creation and its first lead-form touchpoint.
   * (A lead that a sync catches up on weeks later is created today but is old: its age must not look new.)
   */
  createdAt: string
  /** Lower-cased, trimmed; null when the contact has no usable primary e-mail. */
  primaryEmail: string | null
  /** Every known e-mail address of the contact (primary first), lower-case, unique. */
  addresses: readonly string[]
}

/** What the lead-form touchpoints of a contact say about consent. `bases` = every metadata.consent_basis found. */
export type ConsentRead =
  | { ok: true; bases: readonly string[]; sourceRef: string | null }
  | { ok: false; error: string }

/** The do-not-contact verdict. A failed lookup is `ok:false`, never "not blocked". */
export type DncRead = { ok: true; blocked: boolean } | { ok: false; error: string }

/**
 * The contact's state in the client's Mailchimp audience.
 * `suppressed` = unsubscribed / cleaned / archived; `not_applicable` = the client has no Mailchimp audience.
 */
export type MemberRead =
  | { ok: true; state: 'active' | 'suppressed' | 'not_in_audience' | 'not_applicable' }
  | { ok: false; error: string }

/** What the old daily welcome batch did for one contact, read from its Mailchimp campaigns. */
export interface LegacyEvidence {
  /** The old batch e-mailed one of the contact's addresses. */
  welcomed: boolean
  /** The old batch has sent a campaign recently, so "not welcomed" can be trusted (it ran). */
  batchSeen: boolean
  /** Ids of the batch campaigns that welcomed the contact. Campaign ids only, no personal data. */
  campaignIds: string[]
}

/**
 * Every e-mail we sent to the contact's addresses in the evidence window, from the four frequency sources
 * (mailbox sent items, audit rows, outbound touchpoints, Mailchimp campaigns), de-duplicated.
 * The old batch's campaigns are NOT in `items` (they are taken out BEFORE de-duplication and counting, because after
 * the switch-over that batch no longer exists); what the batch did is reported separately in `legacy`.
 */
export type EvidenceRead =
  | { ok: true; items: readonly OutboundItem[]; legacy: LegacyEvidence }
  | { ok: false; error: string }

/** Everything the gates read. Read-only by construction: there is no write method on purpose. */
export interface ShadowGatePorts {
  consent(contactId: string): Promise<ConsentRead>
  dnc(contactId: string): Promise<DncRead>
  member(email: string): Promise<MemberRead>
  evidence(contact: ShadowContact): Promise<EvidenceRead>
}

/** Definite reasons: the decision is final and gets frozen into a `skipped` shadow row. */
export type SkipReason =
  | 'stale'
  | 'bad_email'
  | 'system_address'
  | 'not_in_allowlist'
  | 'dnc'
  | 'mailchimp_suppressed'
  | 'no_consent_basis'
  | 'sales_email_exists'
  | 'frequency_full'

/** Retryable reasons: a read failed, so nothing is written now and the contact is tried again on the next sweep. */
export type DeferReason = 'dnc_unverifiable' | 'consent_unreadable' | 'legacy_unverifiable' | 'evidence_unverifiable'

/** Stored in triggered_sends.annotations. No personal data: booleans, counts and a day. */
export interface ShadowAnnotations {
  gate_contract_version: number
  would_send: boolean
  /** The old batch welcomed this contact (from the Mailchimp campaigns). null = not known (stale). */
  legacy_welcomed: boolean | null
  /** The old batch had sent a campaign recently when this was decided. false = "not welcomed" may only mean it was late or skipped. */
  legacy_batch_seen: boolean | null
  /** Ids of the old-batch campaigns that welcomed this contact (to reconcile with each campaign's own total). */
  legacy_campaign_ids: string[] | null
  /** A human e-mail to this contact exists since the lead was created. null = not known. */
  sales_email: boolean | null
  /** Number of counted e-mails in the cap window (old batch excluded). null = not known. */
  frequency_count: number | null
  /** The day the lead was created, in the rule's time zone (YYYY-MM-DD). */
  lead_local_day: string
}

export type ShadowDecision =
  | {
      kind: 'write'
      status: 'shadow' | 'skipped'
      reasonCode: SkipReason | null
      annotations: ShadowAnnotations
      consentBasis: string | null
      sourceRef: string | null
    }
  | { kind: 'defer'; reasonCode: DeferReason }

// ── Loaders and the sweep (the orchestration around the pure gates) ─────────────────────────────────────

/** The open (not revoked) proposal or authorization row of a client: the source of the sweep's rule. */
export interface OpenAuthorization {
  id: string
  clientId: string
  /** The raw jsonb; the sweep parses it strictly and checks it against `ruleSha256`. */
  rule: unknown
  ruleSha256: string
  /** ISO timestamp when the row was created. */
  proposedAt: string
  /** True once a person authorized it (authorized_at is set). The shadow run behaves the same either way. */
  authorized: boolean
}

export type AuthorizationRead = { ok: true; row: OpenAuthorization | null } | { ok: false; error: string }
export type ContactsRead = { ok: true; contacts: ShadowContact[] } | { ok: false; error: string }
export type ShadowRowsRead = { ok: true; contactIds: Set<string> } | { ok: false; error: string }
export type MailboxCheck = { ok: true } | { ok: false; reason: 'missing' | 'unreadable'; detail: string }

/** One campaign of the old daily batch that the sweep saw in Mailchimp (used for the batch totals). */
export interface LegacyBatchSeen {
  campaignId: string
  title: string
  sentAt: string | null
  emailsSent: number
}

export type SweepStatus =
  | 'no_open_proposal'
  | 'rule_invalid'
  | 'gate_changed'
  | 'mailbox_unreadable'
  | 'read_failed'
  | 'write_failed'
  | 'swept'

/** The machine-readable receipt of one sweep for one client. No personal data. `no_send` and `provider_impact` are constants. */
export interface SweepReceipt {
  status: SweepStatus
  client_id: string
  dry_run: boolean
  authorization_id: string | null
  /** Contacts that were decided this run (candidates + stale ones), before deferrals. */
  to_decide: number
  /** Contacts looked at but not decided: too new, before the proposal, bad date, or already holding a shadow row. */
  ignored: number
  decided: number
  /** Contacts that turned out to hold a shadow row already when their chunk ran (a retry, or another run was faster). */
  already_decided: number
  deferred: number
  inserted: number
  would_send: number
  skipped_by_reason: Record<string, number>
  deferred_by_reason: Record<string, number>
  legacy_batches: LegacyBatchSeen[]
  no_send: true
  provider_impact: 'NONE'
  error: string | null
  created_at: string
}

// ── The sweep in chunks (one Inngest step per chunk, so no single step runs long) ─────────────────────────

/**
 * What the first step of a stepped sweep hands to the chunk steps. Plain JSON and NO personal data: only ids,
 * counters and the day. Every chunk step re-reads what it needs from the database.
 */
export interface SweepPlan {
  clientId: string
  dryRun: boolean
  authorizationId: string
  /** The client-local day of the sweep (YYYY-MM-DD). */
  sweepDay: string
  /** Contacts to decide with the external reads. */
  candidateIds: string[]
  /** Contacts too old to welcome: frozen as skipped:stale without any external read. */
  staleIds: string[]
  to_decide: number
  ignored: number
  deferred: number
  deferred_by_reason: Record<string, number>
  /** 'swept', or 'mailbox_unreadable' when the candidates were set aside. */
  status: SweepStatus
  error: string | null
  createdAt: string
}

export type PrepareResult = { kind: 'done'; receipt: SweepReceipt } | { kind: 'plan'; plan: SweepPlan }

/** What one chunk step did. Plain JSON, no personal data. */
export interface ChunkResult {
  decided: number
  /** Contacts in the chunk that already held a shadow row (not decided again; the stored row stays). */
  already_decided: number
  deferred: number
  inserted: number
  would_send: number
  skipped_by_reason: Record<string, number>
  deferred_by_reason: Record<string, number>
  legacy_batches: LegacyBatchSeen[]
  /** Set when the chunk could not read or write what it needs; what was not decided is counted as deferred. */
  error: string | null
  /** Which kind of failure `error` is (null when there is none). */
  error_status: 'read_failed' | 'write_failed' | null
}

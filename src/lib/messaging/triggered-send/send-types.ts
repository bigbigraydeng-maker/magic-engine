/**
 * Types of REAL sending of the welcome letter (the half after the rehearsal, design P2 §5.2 G–M). The orchestration is
 * in `send-sweep.ts`; every dependency is injected, so the whole of it is tested without a database or a provider.
 * No type here carries personal data across workflow steps: only ids, codes and counters.
 */

import type { ResendEmailPort } from '@/lib/messaging/adapters/resend-email'
import type { TemplateRead } from './authorization-core'
import type { AuthorizationRecord } from './authorization-store'
import type { SendTouchpointInput, TouchpointCancel, TouchpointWrite } from './send-touchpoint'
import type { TriggeredSendRule } from './rule'
import type { MailboxCheck, ShadowContact, ShadowGatePorts } from './types'

export type EnvReader = (name: string) => string | undefined

/** A guest as real sending sees it: the rehearsal's view plus the name the letter greets by. */
export interface SendContact extends ShadowContact {
  displayName: string | null
}

/** The live (non-rehearsal) ledger row of one contact, as far as sending needs it. */
export interface LifetimeRow {
  id: string
  contactId: string
  status: string
  reasonCode: string | null
  authorizationId: string | null
  idempotencyKey: string | null
  renderedSha256: string | null
  toAddressSha256: string | null
  firstAttemptAt: string | null
  providerMessageId: string | null
  /** How often the row was claimed or taken over: a change means another run owns the letter now. */
  attempts: number
  updatedAt: string
}

/** What `triggered_send_claim` answered (§3.3). */
export type ClaimOutcome =
  | 'claimed'
  | 'takeover'
  | 'in_flight'
  | 'exists_terminal'
  | 'expired_unknown'
  | 'address_duplicate'
  | 'cap_reached'
  | 'auth_inactive'
  | 'rule_invalid'
  | 'template_mismatch'
  /** `triggered_send_claim_letter` only: the authorization's letter list does not name this letter. */
  | 'letter_not_authorized'

export interface ClaimInput {
  authorizationId: string
  contactId: string
  toAddressSha256: string
  idempotencyKey: string
  templateKey: string
  templateVersion: number
  templateSha256: string
  renderedSha256: string
  sourceRef: string | null
  consentBasis: string | null
}

export type ClaimRead =
  | { ok: true; outcome: ClaimOutcome; sendId: string | null; idempotencyKey: string | null }
  | { ok: false; error: string }

/** A decision that is not a claim: a retryable block or a final skip, written as a live row. */
export interface DecisionWrite {
  clientId: string
  contactId: string
  authorizationId: string
  status: 'blocked' | 'skipped'
  reasonCode: string
  annotations: Record<string, unknown>
  toAddressSha256: string | null
  consentBasis: string | null
  sourceRef: string | null
  /** The row the decision replaces (a `blocked` one), or null for a first decision. Never a `pending` one. */
  existing: LifetimeRow | null
}

export type LedgerWrite = { ok: true } | { ok: false; error: string }
/** A write that only goes through while the row is still exactly as it was read (`updated_at`). */
export type CasWrite = { ok: true; result: 'updated' | 'changed' } | { ok: false; error: string }

export interface SendLedger {
  rowsFor(clientId: string, contactIds: readonly string[]): Promise<{ ok: true; rows: LifetimeRow[] } | { ok: false; error: string }>
  rowById(clientId: string, id: string): Promise<{ ok: true; row: LifetimeRow | null } | { ok: false; error: string }>
  recordDecision(input: DecisionWrite): Promise<LedgerWrite>
  /** A `pending` row met a gate (locks, the cap): only the reason is noted, the status stays (§4.2). */
  noteBlock(row: LifetimeRow, reasonCode: string): Promise<LedgerWrite>
  /** The provider's answer was unclear: the row stays pending, but says the letter may have gone out. */
  markUnknown(row: LifetimeRow): Promise<CasWrite>
  claim(input: ClaimInput): Promise<ClaimRead>
  markSent(row: LifetimeRow, input: { messageId: string; account: string; sentAt: string }): Promise<CasWrite>
  markFailed(row: LifetimeRow, input: { reasonCode: string; account: string }): Promise<CasWrite>
}

/**
 * A live row of one letter of a letter list (`dedupe_scope = 'letter:<key>'`), with what the named-letter entry needs
 * besides the shared fields: which letter, its annotations (link tracking, the caller's reference), the pinned template
 * it was claimed with (the 20-hour check hands them back to the claim function) and when it was sent.
 */
export interface LetterRow extends LifetimeRow {
  letterKey: string
  annotations: Record<string, unknown>
  templateKey: string | null
  templateVersion: number | null
  templateSha256: string | null
  sentAt: string | null
}

export type LetterRowsRead = { ok: true; rows: LetterRow[] } | { ok: false; error: string }

/** The ledger of ONE letter of a list: the shared ledger, plus the annotations a named letter keeps on its row. */
export interface LetterLedger extends SendLedger {
  /** Merge-free write of the whole annotations object of a row that is still pending (compare-and-set). */
  annotate(row: LifetimeRow, annotations: Record<string, unknown>): Promise<CasWrite>
}

export type LockTake = { ok: true; held: boolean } | { ok: false; error: string }

/** The contact lock and the recipient lock of ONE send step (one instance per step: a release only drops our own). */
export interface SendLocks {
  take(clientId: string, contactId: string, address: string): Promise<LockTake>
  release(clientId: string, contactId: string, address: string): Promise<void>
}

export type AuthorizationLoad = { ok: true; record: AuthorizationRecord | null } | { ok: false; error: string }
export type ContactLoad = { ok: true; contact: SendContact | null } | { ok: false; error: string }

export interface SendDeps {
  now(): Date
  env: EnvReader
  /** The open, AUTHORIZED row of the client (activated or not); null when there is none. */
  loadAuthorization(clientId: string): Promise<AuthorizationLoad>
  loadTemplate(clientId: string, key: string): Promise<TemplateRead>
  /** Revoke as the system (`system:<code>`); best effort, never throws. */
  revokeAsSystem(record: AuthorizationRecord, code: string): Promise<'revoked' | 'not_open' | 'failed'>
  /** The contacts carrying one of these addresses (a trial's allow-list): by registered e-mail or primary e-mail. */
  findContactIdsByAddresses(clientId: string, addresses: readonly string[]): Promise<{ ok: true; contactIds: string[] } | { ok: false; error: string }>
  loadContact(args: { clientId: string; contactId: string; sources: readonly string[] }): Promise<ContactLoad>
  checkMailboxes(clientId: string, required: readonly string[]): Promise<MailboxCheck>
  createPorts(args: { clientId: string; rule: TriggeredSendRule; now: Date }): ShadowGatePorts
  createLocks(): SendLocks
  ledger: SendLedger
  resend: ResendEmailPort
  writeTouchpoint(input: SendTouchpointInput): Promise<TouchpointWrite>
  cancelTouchpoint(clientId: string, sendId: string): Promise<TouchpointCancel>
  /** Apply the receipts already stored for this message id (they may have come before the id was written). Never throws. */
  replayReceipts(messageId: string): Promise<{ applied: number; error: string | null }>
  newIdempotencyKey(): string
}

/** Why a run sends nothing at all. */
export type SendStopStatus =
  | 'dry_run'
  | 'not_armed'
  | 'no_active_authorization'
  /** The authorization is for real guests (no allow-list): not sent by this version (see send-arming.ts). */
  | 'formal_sending_not_enabled'
  | 'authorization_inactive'
  | 'authorization_changed'
  | 'authorization_self_revoked'
  /** A letter list's authorization does not list the letter asked for (design 2026-11-17 §7.3). */
  | 'letter_not_authorized'
  | 'template_unreadable'
  | 'trial_domains_not_configured'
  | 'trial_recipient_not_internal'
  | 'no_account_key'
  | 'no_unsubscribe_secret'
  | 'no_app_url'
  | 'outside_send_window'
  | 'mailbox_unreadable'
  | 'read_failed'

/** What a send run hands from its first step to the per-contact steps. Plain JSON, no personal data. */
export interface SendPlan {
  clientId: string
  authorizationId: string
  /** The client-local day of the run (YYYY-MM-DD). */
  sweepDay: string
  /** Contacts to try, letters in flight first. */
  contactIds: string[]
  /** Contacts too old to welcome: written as skipped:stale. */
  staleIds: string[]
  /** Contacts found behind the trial's addresses (0 = the allow-list matches nobody: a setup problem). */
  found: number
  createdAt: string
}

export type SendOutcome =
  | 'sent'
  | 'rejected'
  | 'account_error'
  | 'unknown_outcome'
  | 'not_attempted'
  | 'skipped'
  | 'blocked'
  | 'in_flight'
  | 'already_done'
  | 'expired_unknown'
  | 'contact_missing'
  | 'conflict'
  | 'stopped'
  | 'read_failed'
  | 'write_failed'

export type ProviderImpact = 'NONE' | 'PROVIDER_ACCEPTED' | 'PROVIDER_UNKNOWN'

export interface SendOneResult {
  outcome: SendOutcome
  /** The reason code (a gate, a provider code, a stop status); null when there is nothing to say. */
  reason: string | null
  sendId: string | null
  /** True when no further guest may be tried in this run (the authorization stopped, the account key is wrong). */
  stopRun: boolean
  providerImpact: ProviderImpact
}

export type SendPrepareResult = { kind: 'stop'; receipt: SendReceipt } | { kind: 'plan'; plan: SendPlan }

/** The machine-readable receipt of real sending in one run (goes into the run log as `summary.send`). */
export interface SendReceipt {
  status: SendStopStatus | 'sent_run'
  authorization_id: string | null
  /** Guests tried (one step each). */
  tried: number
  /** Contacts found behind the trial's addresses; null when the run stopped before looking. */
  found: number | null
  by_outcome: Record<string, number>
  by_reason: Record<string, number>
  /** The strongest provider impact of the run (any letter accepted → PROVIDER_ACCEPTED). */
  provider_impact: ProviderImpact
  /** Set when the run stopped early, with why. */
  stopped: string | null
  error: string | null
  created_at: string
}

// ── a named letter of a letter list (design 2026-11-17 §2, §7.3) ──────────────────────────────────────────

/** Link tracking of a named letter's body. Neither method throws; tracking never stops a letter (it goes untracked). */
export interface LinkTrackingPort {
  /** First attempt: token the tracked links and store the tokens under the ledger row id. */
  tag(args: { clientId: string; contactId: string; requestId: string; body: string }): Promise<{ body: string; tagged: number; tokens: string[]; warning: string | null }>
  /** A replay: put the SAME tokens back into the same body (nothing is stored). `ok:false` = it cannot be rebuilt. */
  retag(args: { clientId: string; body: string; tokens: readonly string[] }): Promise<{ ok: true; body: string } | { ok: false }>
}

/** The send deps of a trigger with a letter list, plus what only a named letter needs. */
export interface NamedLetterDeps extends SendDeps {
  /** The ledger of one letter (its `letter:<key>` rows, `triggered_send_claim_letter`). */
  letters(letterKey: string): LetterLedger
  /** Every letter row of one guest under this trigger. */
  letterRows(clientId: string, contactId: string): Promise<LetterRowsRead>
  linkTracking: LinkTrackingPort
}

/** What 76 asks for: one letter of the authorized list, to one guest, now. */
export interface NamedLetterRequest {
  clientId: string
  contactId: string
  letterKey: string
  /** The caller's own record id (≤120 characters, no personal data): kept on the ledger row to reconcile. */
  requestRef: string
}

/** `SendOneResult`, plus the row's real status when the letter was already handled (`already_done`). */
export interface NamedLetterResult extends SendOneResult {
  rowStatus?: string
}

export interface LetterStatus {
  letterKey: string
  status: string
  sentAt: string | null
  sendId: string
}

export type LetterStatusesRead = { ok: true; letters: LetterStatus[] } | { ok: false; error: string }

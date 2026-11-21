/**
 * The per-guest body of real sending, shared by every kind of letter (design P2 §5.2 A–M; design 2026-11-17 §4.3).
 * Never throws past its callers' own try/catch (`sendOne`, `sendNamedLetter`), which build the flow and its context.
 *
 *   a letter in flight is TAKEN OVER (same frozen inputs, attempt 'replay'), any other guest goes through the gates A–F
 *   (`decideShadow`, mode 'send') → render (H) → check the full request before claiming anything (§16.8 ①) → both locks
 *   (I) → inside them, the e-mail evidence again (J) → claim (K) → the timeline record (a failed write = no send,
 *   §16.8 ③) → the body as it goes out (`finalText`: link tracking for a named letter) → send (L) → write the outcome with
 *   a compare-and-set, replay the receipts already stored for the message id → release the locks (M).
 *
 * What differs between the kinds is the `SendFlow`: which ledger rows (scope) and claim function, how the letter is
 * rendered, the timeline line, whether "the 7-day cap is full" is final, and the body as it goes out.
 *
 * 🔴 Only a FIRST attempt may conclude "not sent" (rejected, account error, not attempted): after a replay nothing is
 *    certain, the row stays pending and the claim function turns it into `unknown_outcome` after 20 hours (§6.1).
 * 🔴 The locks are taken and released inside this one step (Inngest may replay a step in another process, §5.2 I).
 */

import { resendRequestProblem, type ResendSendOutcome } from '@/lib/messaging/adapters/resend-email'
import type { Armed } from './send-arming'
import { buildLetterRequest, PRECHECK_SEND_ID, type RenderedLetter } from './send-letter'
import { decideShadow, evidenceReason, isPlausibleEmail } from './shadow-gates'
import { addressSha256 } from './shadow-store'
import type { ClaimRead, LifetimeRow, SendContact, SendDeps, SendLedger, SendOneResult, SendOutcome } from './send-types'
import type { ShadowDecision } from './types'
import { GATE_CONTRACT_VERSION } from './rule'

export type ArmedOk = Extract<Armed, { ok: true }>

/** Statuses after which no letter is ever tried again for the contact (for this letter). */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'skipped', 'unknown_outcome', 'sent', 'delivery_delayed', 'delivered', 'suppressed', 'failed', 'bounced', 'complained',
])

/** The judgements on the e-mail evidence: on a takeover the cap is checked separately (exempting the letter itself). */
const EVIDENCE_REASONS: ReadonlySet<string> = new Set(['sales_email_exists', 'frequency_full'])

/** How often a compare-and-set write is tried again on a row that is still pending (a note or a lease moved it on). */
const CAS_TRIES = 3

export type FlowRender = { ok: true; letter: RenderedLetter } | { ok: false; reason: string }
export type FinalText = { ok: true; text: string } | { ok: false; result: SendOneResult }

/** What one kind of letter brings to the shared body. */
export interface SendFlow {
  clientId: string
  /** The ledger rows of THIS letter (its scope) and the claim function that claims them. */
  ledger: SendLedger
  /** The trigger the timeline record is filed under. */
  triggerKey: string
  /** The timeline line of a claimed letter (no personal data). */
  timelineSummary: string
  /** Is "the 7-day cap is full" final (the welcome letter: skipped) or a wait (a named letter: blocked, §7.3)? */
  frequencyFullFinal: boolean
  /** Render the letter; `pending` = the row being taken over (a replay renders as its first attempt did), or null. */
  render(pending: LifetimeRow | null): FlowRender
  /** Added to the annotations of every decision row this flow writes (e.g. the caller's own reference). */
  extraAnnotations: Readonly<Record<string, unknown>>
  /** The body as it goes out, after the claim and the timeline record (a stop result = nothing is sent). */
  finalText(c: SendCtx, row: LifetimeRow, letter: RenderedLetter, attempt: 'first' | 'replay'): Promise<FinalText>
}

export interface SendCtx {
  flow: SendFlow
  deps: SendDeps
  armed: ArmedOk
  contact: SendContact
  /** The live row of the contact before this step: null, or `blocked` (a pending one goes to takeOver). */
  row: LifetimeRow | null
  now: Date
}

export function result(outcome: SendOutcome, reason: string | null, sendId: string | null = null, extra: Partial<SendOneResult> = {}): SendOneResult {
  return { outcome, reason, sendId, stopRun: false, providerImpact: 'NONE', ...extra }
}

/** A guest whose row is not final: a letter in flight is taken over, anyone else is decided afresh. */
export async function sendToGuest(c: SendCtx, row: LifetimeRow | null): Promise<SendOneResult> {
  if (row !== null && row.status === 'pending') return takeOver(c, row)
  return sendFresh(c)
}

// ── decisions that are not a claim ───────────────────────────────────────────────────────────────────────

/** A decision that is not a claim, written as the guest's live row (a retryable block or a final skip). */
export async function decide(c: SendCtx, status: 'blocked' | 'skipped', reasonCode: string, decision: ShadowDecision | null): Promise<SendOneResult> {
  const email = c.contact.primaryEmail
  const extra = c.flow.extraAnnotations
  const written = await c.flow.ledger.recordDecision({
    clientId: c.flow.clientId,
    contactId: c.contact.contactId,
    authorizationId: c.armed.record.id,
    status,
    reasonCode,
    annotations: decision?.kind === 'write' ? { ...decision.annotations, ...extra } : { gate_contract_version: GATE_CONTRACT_VERSION, ...extra },
    toAddressSha256: email !== null && isPlausibleEmail(email) ? addressSha256(email) : null,
    consentBasis: decision?.kind === 'write' ? decision.consentBasis : null,
    sourceRef: decision?.kind === 'write' ? decision.sourceRef : null,
    existing: c.row,
  })
  if (!written.ok) return result('write_failed', `${status}:${reasonCode}`)
  return result(status, reasonCode, c.row?.id ?? null)
}

/** A definite reason: final, except a full cap for a letter that waits for room (§7.3). */
function refuseFor(c: SendCtx, reasonCode: string, decision: ShadowDecision): Promise<SendOneResult> {
  const waits = reasonCode === 'frequency_full' && !c.flow.frequencyFullFinal
  return decide(c, waits ? 'blocked' : 'skipped', reasonCode, decision)
}

// ── a new letter ─────────────────────────────────────────────────────────────────────────────────────────

async function sendFresh(c: SendCtx): Promise<SendOneResult> {
  const ports = c.deps.createPorts({ clientId: c.flow.clientId, rule: c.armed.rule, now: c.now })
  const decision = await decideShadow({ contact: c.contact, rule: c.armed.rule, ports, mode: 'send' })
  if (decision.kind === 'defer') return decide(c, 'blocked', decision.reasonCode, null)
  if (decision.status === 'skipped') return refuseFor(c, decision.reasonCode ?? 'skipped', decision)
  const email = c.contact.primaryEmail
  if (email === null) return decide(c, 'skipped', 'bad_email', decision)
  const rendered = c.flow.render(null)
  // A missing name can still be filled in by a person: the guest waits (and is skipped as stale once too old).
  if (!rendered.ok) return decide(c, 'blocked', rendered.reason, decision)
  const problem = precheck(c, rendered.letter, email)
  if (problem !== null) return problem.stop ? result('stopped', problem.code, null, { stopRun: true }) : decide(c, 'blocked', problem.code, decision)
  return withLocks(c, email, null, async () => {
    // Read again with FRESH ports: the first ones keep the mailbox pages and batch lists they already fetched.
    const inside = c.deps.createPorts({ clientId: c.flow.clientId, rule: c.armed.rule, now: c.deps.now() })
    const evidence = await inside.evidence(c.contact)
    if (!evidence.ok) return decide(c, 'blocked', 'frequency_unverifiable', decision)
    const late = evidenceReason(c.contact, c.armed.rule, evidence.items)
    if (late !== null) return refuseFor(c, late, decision)
    const claim = await c.flow.ledger.claim(claimInput(c, rendered.letter, email, c.deps.newIdempotencyKey(), decision))
    return afterClaim(c, claim, rendered.letter, email)
  })
}

/** The full request, built with a placeholder id, must pass before anything is claimed (§16.8 ①). */
function precheck(c: SendCtx, letter: RenderedLetter, email: string): { stop: boolean; code: string } | null {
  const built = buildLetterRequest(letter, {
    account: c.armed.record.account,
    rule: c.armed.rule,
    clientId: c.flow.clientId,
    to: email,
    idempotencyKey: `precheck-${PRECHECK_SEND_ID}`,
    sendId: PRECHECK_SEND_ID,
    firstAttemptAt: c.now.toISOString(),
    attempt: 'first',
  }, c.deps.env)
  if (!built.ok) return { stop: true, code: built.code }
  const problem = resendRequestProblem(built.request)
  return problem === null ? null : { stop: false, code: 'request_invalid' }
}

function claimInput(c: SendCtx, letter: RenderedLetter, email: string, idempotencyKey: string, decision: ShadowDecision | null) {
  return {
    authorizationId: c.armed.record.id,
    contactId: c.contact.contactId,
    toAddressSha256: addressSha256(email),
    idempotencyKey,
    templateKey: c.armed.templateKey,
    templateVersion: c.armed.templateVersion,
    templateSha256: c.armed.templateSha256,
    renderedSha256: letter.renderedSha256,
    sourceRef: decision?.kind === 'write' ? decision.sourceRef : null,
    consentBasis: decision?.kind === 'write' ? decision.consentBasis : null,
  }
}

// ── a letter in flight (the run before did not finish it) ────────────────────────────────────────────────

async function takeOver(c: SendCtx, row: LifetimeRow): Promise<SendOneResult> {
  const email = c.contact.primaryEmail
  // A replay must carry the very same request: other authorization, other address or other content = never resend
  // (the row is left to the 20-hour rule and a person, §3.3 step 8).
  if (row.authorizationId !== c.armed.record.id || row.idempotencyKey === null || row.renderedSha256 === null) return result('in_flight', 'not_replayable', row.id)
  if (email === null || !isPlausibleEmail(email) || addressSha256(email) !== row.toAddressSha256) return result('in_flight', 'address_changed', row.id)
  const rendered = c.flow.render(row)
  if (!rendered.ok || rendered.letter.renderedSha256 !== row.renderedSha256) return result('in_flight', 'content_changed', row.id)
  const idempotencyKey = row.idempotencyKey
  return withLocks(c, email, row, async () => {
    const ports = c.deps.createPorts({ clientId: c.flow.clientId, rule: c.armed.rule, now: c.deps.now() })
    // The first attempt may never have reached the provider, so a replay can be the first letter: the guest's own state
    // (do not contact, unsubscribed, complained, bounced, suppressed, a skipped tag) is read again. Only "a person wrote
    // first" is not judged again (§4.2); the cap is, below, without counting this letter itself.
    const person = await decideShadow({ contact: c.contact, rule: c.armed.rule, ports, mode: 'send' })
    if (person.kind === 'defer') return noted(c, row, person.reasonCode)
    if (person.status === 'skipped' && person.reasonCode !== null && !EVIDENCE_REASONS.has(person.reasonCode)) return noted(c, row, person.reasonCode)
    const evidence = await ports.evidence(c.contact, { exemptSendId: row.id })
    if (!evidence.ok) return noted(c, row, 'frequency_unverifiable')
    if (evidence.items.length >= c.armed.rule.frequency_cap.max) return noted(c, row, 'frequency_full')
    const claim = await c.flow.ledger.claim(claimInput(c, rendered.letter, email, idempotencyKey, null))
    return afterClaim(c, claim, rendered.letter, email)
  })
}

async function noted(c: SendCtx, row: LifetimeRow, reasonCode: string): Promise<SendOneResult> {
  const written = await c.flow.ledger.noteBlock(row, reasonCode)
  return written.ok ? result('blocked', reasonCode, row.id) : result('write_failed', `note:${reasonCode}`, row.id)
}

async function withLocks(c: SendCtx, address: string, pending: LifetimeRow | null, work: () => Promise<SendOneResult>): Promise<SendOneResult> {
  const locks = c.deps.createLocks()
  const taken = await locks.take(c.flow.clientId, c.contact.contactId, address)
  if (!taken.ok || !taken.held) {
    const reason = taken.ok ? 'lock_busy' : 'lock_unreadable'
    return pending === null ? decide(c, 'blocked', reason, null) : noted(c, pending, reason)
  }
  try {
    return await work()
  } finally {
    await locks.release(c.flow.clientId, c.contact.contactId, address).catch(() => undefined)
  }
}

// ── claim, send, record ──────────────────────────────────────────────────────────────────────────────────

async function afterClaim(c: SendCtx, claim: ClaimRead, letter: RenderedLetter, email: string): Promise<SendOneResult> {
  if (!claim.ok) return result('write_failed', 'claim_failed')
  const id = claim.sendId
  switch (claim.outcome) {
    case 'claimed':
    case 'takeover':
      if (id === null || claim.idempotencyKey === null) return result('write_failed', 'claim_without_row')
      return deliver(c, id, claim.idempotencyKey, letter, email, claim.outcome === 'claimed' ? 'first' : 'replay')
    case 'in_flight':
      return result('in_flight', null, id)
    case 'exists_terminal':
      return result('already_done', null, id)
    case 'expired_unknown':
      return result('expired_unknown', 'expired_20h', id)
    case 'address_duplicate':
      return decide(c, 'skipped', 'address_duplicate', null)
    case 'cap_reached':
      // The day's cap is shared by every guest: nobody else can be claimed today either.
      return { ...(await decide(c, 'blocked', 'cap_reached', null)), stopRun: true }
    case 'rule_invalid':
      // The database cannot read the rule (its time zone): like the judgement's RULE_INVALID, the authorization goes.
      await c.deps.revokeAsSystem(c.armed.record, 'RULE_INVALID')
      return result('stopped', claim.outcome, id, { stopRun: true })
    case 'letter_not_authorized':
      // This letter is not in the list (any more): only this call stops; the listed letters may still go (P2-5).
      return result('stopped', claim.outcome, id)
    default:
      // auth_inactive, template_mismatch: the authorization no longer holds (checked inside the lock).
      return result('stopped', claim.outcome, id, { stopRun: true })
  }
}

async function deliver(c: SendCtx, sendId: string, idempotencyKey: string, letter: RenderedLetter, email: string, attempt: 'first' | 'replay'): Promise<SendOneResult> {
  const timeline = await c.deps.writeTouchpoint({
    clientId: c.flow.clientId,
    contactId: c.contact.contactId,
    triggeredSendId: sendId,
    triggerKey: c.flow.triggerKey,
    occurredAt: c.now.toISOString(),
    summary: c.flow.timelineSummary,
  })
  // No timeline record = the sales side would not see this letter: do not send (the next run takes the row over).
  if (!timeline.ok) return result('write_failed', 'timeline_failed', sendId)
  const read = await c.flow.ledger.rowById(c.flow.clientId, sendId)
  if (!read.ok || read.row === null) return result('read_failed', 'ledger_unreadable', sendId)
  const row = read.row
  // A takeover answered on a row claimed for another address (the guest's address changed in between): never send.
  if (row.toAddressSha256 !== addressSha256(email)) return result('in_flight', 'address_changed', sendId)
  // The link's issue time is the row's first attempt (written by the claim, never changed): every replay has the same link.
  const firstAttemptAt = row.firstAttemptAt
  if (firstAttemptAt === null) return result('read_failed', 'ledger_unreadable', sendId)
  const text = await c.flow.finalText(c, row, letter, attempt)
  if (!text.ok) return text.result
  const built = buildLetterRequest({ ...letter, text: text.text }, {
    account: c.armed.record.account,
    rule: c.armed.rule,
    clientId: c.flow.clientId,
    to: email,
    idempotencyKey,
    sendId,
    firstAttemptAt,
    attempt,
  }, c.deps.env)
  if (!built.ok) return notAttempted(c, row, built.code, attempt)
  const outcome = await c.deps.resend.send(built.request)
  return recordOutcome(c, row, outcome, attempt)
}

async function recordOutcome(c: SendCtx, row: LifetimeRow, outcome: ResendSendOutcome, attempt: 'first' | 'replay'): Promise<SendOneResult> {
  if (outcome.kind === 'sent') return recordSent(c, row, outcome.messageId)
  if (outcome.kind === 'not_attempted') return notAttempted(c, row, outcome.code, attempt)
  if (attempt === 'first' && outcome.kind === 'rejected') return failed(c, row, 'provider_rejected', 'rejected', false)
  if (attempt === 'first' && outcome.kind === 'account_error') return failed(c, row, 'provider_account_error', 'account_error', true)
  // Anything else (and every refusal of a replay) may have gone out: keep it pending, never send a second letter. The
  // row says so. A FIRST attempt that is unclear stops the run (the provider is in trouble, every further guest would
  // end up the same); an unclear replay only holds this letter (it may answer 409 until the 20 hours are up, 子牙 R2 P2-A).
  const marked = await onPending(c, row, (r) => c.flow.ledger.markUnknown(r))
  if (marked.kind === 'moved' && receiptAccepted(marked.row)) return result('sent', 'receipt_first', row.id, { providerImpact: 'PROVIDER_ACCEPTED' })
  return result('unknown_outcome', marked.kind === 'written' ? outcome.code : `${outcome.code}:not_marked`, row.id, { providerImpact: 'PROVIDER_UNKNOWN', stopRun: attempt === 'first' })
}

/** A receipt bound the row (it carries the provider's message id): the provider has the letter, whatever we were told. */
function receiptAccepted(row: LifetimeRow | null): boolean {
  return row !== null && row.providerMessageId !== null
}

type OnPending = { kind: 'written' } | { kind: 'moved'; row: LifetimeRow | null } | { kind: 'error' }

/**
 * A compare-and-set write on a row that should still be pending. "Changed" is read again: still pending (a note or a
 * takeover touched it) = try again on the fresh row; anything else = it moved on (a receipt), and the caller decides.
 */
export async function onPending(
  c: SendCtx,
  row: LifetimeRow,
  write: (r: LifetimeRow) => Promise<{ ok: true; result: 'updated' | 'changed' } | { ok: false; error: string }>,
  sameOwner = false,
): Promise<OnPending> {
  let current = row
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const w = await write(current)
    if (!w.ok) return { kind: 'error' }
    if (w.result === 'updated') return { kind: 'written' }
    const again = await c.flow.ledger.rowById(c.flow.clientId, current.id)
    if (!again.ok) return { kind: 'error' }
    if (again.row === null || again.row.status !== 'pending') return { kind: 'moved', row: again.row }
    // `sameOwner`: another run took the letter over meanwhile (its replay may be at the provider right now): not ours
    // to conclude any more (魏征 R2 P2-甲).
    if (sameOwner && again.row.attempts !== row.attempts) return { kind: 'moved', row: again.row }
    current = again.row
  }
  return { kind: 'error' }
}

async function recordSent(c: SendCtx, row: LifetimeRow, messageId: string): Promise<SendOneResult> {
  const accepted = { providerImpact: 'PROVIDER_ACCEPTED' as const }
  const sentAt = c.deps.now().toISOString()
  const written = await onPending(c, row, (r) => c.flow.ledger.markSent(r, { messageId, account: c.armed.record.account, sentAt }))
  if (written.kind === 'error') return result('write_failed', 'mark_sent_failed', row.id, accepted)
  // A receipt was faster and already moved the row on: fine if it carries the same message id (§16.10).
  if (written.kind === 'moved' && written.row?.providerMessageId !== messageId) return result('conflict', 'message_id_conflict', row.id, accepted)
  const replayed = await c.deps.replayReceipts(messageId)
  return result('sent', replayed.error === null ? null : 'receipt_replay_failed', row.id, accepted)
}

async function failed(c: SendCtx, row: LifetimeRow, reasonCode: string, outcome: 'rejected' | 'account_error' | 'not_attempted', stopRun: boolean): Promise<SendOneResult> {
  const written = await onPending(c, row, (r) => c.flow.ledger.markFailed(r, { reasonCode, account: c.armed.record.account }), true)
  if (written.kind === 'error') return result('write_failed', `failed:${reasonCode}`, row.id, { stopRun })
  // The row moved on before "failed" could be written (a receipt, or another run took it over): the letter's state is
  // not ours to call "not sent", so the timeline record stays as it is. A receipt that bound it = accepted (魏征 R2 P2-乙).
  if (written.kind === 'moved' && receiptAccepted(written.row)) return result('sent', `receipt_first:${reasonCode}`, row.id, { stopRun, providerImpact: 'PROVIDER_ACCEPTED' })
  if (written.kind === 'moved') return result('conflict', `${reasonCode}:row_moved`, row.id, { stopRun })
  // Not sent for certain: the timeline record no longer counts toward "7 days, 2 e-mails" (§16.8 ②⑤).
  const cancelled = await c.deps.cancelTouchpoint(c.flow.clientId, row.id)
  return result(outcome, cancelled.ok ? reasonCode : `${reasonCode}:timeline_not_cancelled`, row.id, { stopRun })
}

async function notAttempted(c: SendCtx, row: LifetimeRow, code: string, attempt: 'first' | 'replay'): Promise<SendOneResult> {
  // Our own setup is wrong (key, secret, origin): stop the run. Only a first attempt is certainly not sent.
  if (attempt === 'replay') return result('not_attempted', code, row.id, { stopRun: true })
  return failed(c, row, 'not_attempted', 'not_attempted', true)
}

/**
 * One guest, at most one letter: the per-contact step of real sending (design P2 §5.2 A–M). Never throws.
 *
 *   re-check (switches, authorization, trial, window) → the guest and its live row → a letter in flight is TAKEN OVER
 *   (same frozen inputs, attempt 'replay'), any other guest goes through the gates A–F (`decideShadow`, mode 'send')
 *   → render (H) → check the full request before claiming anything (§16.8 ①) → both locks (I) → inside them, the e-mail
 *   evidence again (J) → claim (K) → the timeline record (a failed write = no send, §16.8 ③) → send (L) → write the
 *   outcome with a compare-and-set, replay the receipts already stored for the message id → release the locks (M).
 *
 * 🔴 Only a FIRST attempt may conclude "not sent" (rejected, account error, not attempted): after a replay nothing is
 *    certain, the row stays pending and the claim function turns it into `unknown_outcome` after 20 hours (§6.1).
 * 🔴 The locks are taken and released inside this one step (Inngest may replay a step in another process, §5.2 I).
 */

import { resendRequestProblem, type ResendSendOutcome } from '@/lib/messaging/adapters/resend-email'
import { checkArmed, isWithinSendWindow, type Armed } from './send-arming'
import { buildLetterRequest, PRECHECK_SEND_ID, renderWelcomeLetter, type RenderedLetter } from './send-letter'
import { decideShadow, evidenceReason, isPlausibleEmail } from './shadow-gates'
import { addressSha256 } from './shadow-store'
import type { ClaimRead, LifetimeRow, SendContact, SendDeps, SendOneResult, SendOutcome, SendPlan } from './send-types'
import type { ShadowDecision } from './types'
import { GATE_CONTRACT_VERSION } from './rule'

type ArmedOk = Extract<Armed, { ok: true }>

/** Statuses after which no letter is ever tried again for the contact. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'skipped', 'unknown_outcome', 'sent', 'delivery_delayed', 'delivered', 'suppressed', 'failed', 'bounced', 'complained',
])

const TIMELINE_SUMMARY = 'ME 自动发出：欢迎信'

interface Ctx {
  plan: SendPlan
  deps: SendDeps
  armed: ArmedOk
  contact: SendContact
  /** The live row of the contact before this step: null, or `blocked` (a pending one goes to takeOver). */
  row: LifetimeRow | null
  now: Date
}

function result(outcome: SendOutcome, reason: string | null, sendId: string | null = null, extra: Partial<SendOneResult> = {}): SendOneResult {
  return { outcome, reason, sendId, stopRun: false, providerImpact: 'NONE', ...extra }
}

export async function sendOne(args: { plan: SendPlan; contactId: string; deps: SendDeps }): Promise<SendOneResult> {
  const { plan, contactId, deps } = args
  try {
    const now = deps.now()
    const armed = await checkArmed(deps, plan.clientId, now, plan.authorizationId)
    if (!armed.ok) return result('stopped', armed.status, null, { stopRun: true })
    if (!isWithinSendWindow(armed.rule, now)) return result('stopped', 'outside_send_window', null, { stopRun: true })
    const loaded = await deps.loadContact({ clientId: plan.clientId, contactId, sources: armed.rule.audience.sources })
    if (!loaded.ok) return result('read_failed', 'contact_unreadable')
    if (loaded.contact === null) return result('contact_missing', null)
    const rows = await deps.ledger.rowsFor(plan.clientId, [contactId])
    if (!rows.ok) return result('read_failed', 'ledger_unreadable')
    const row = rows.rows.find((r) => r.contactId === contactId) ?? null
    if (row !== null && TERMINAL_STATUSES.has(row.status)) return result('already_done', row.status, row.id)
    const ctx: Ctx = { plan, deps, armed, contact: loaded.contact, row: row?.status === 'blocked' ? row : null, now }
    if (row !== null && row.status === 'pending') return await takeOver(ctx, row)
    return await sendFresh(ctx)
  } catch (err) {
    console.error('[triggered-send] send step failed', err instanceof Error ? err.name : 'unknown')
    return result('read_failed', 'unexpected')
  }
}

// ── decisions that are not a claim ───────────────────────────────────────────────────────────────────────

async function decide(c: Ctx, status: 'blocked' | 'skipped', reasonCode: string, decision: ShadowDecision | null): Promise<SendOneResult> {
  const email = c.contact.primaryEmail
  const written = await c.deps.ledger.recordDecision({
    clientId: c.plan.clientId,
    contactId: c.contact.contactId,
    authorizationId: c.armed.record.id,
    status,
    reasonCode,
    annotations: decision?.kind === 'write' ? { ...decision.annotations } : { gate_contract_version: GATE_CONTRACT_VERSION },
    toAddressSha256: email !== null && isPlausibleEmail(email) ? addressSha256(email) : null,
    consentBasis: decision?.kind === 'write' ? decision.consentBasis : null,
    sourceRef: decision?.kind === 'write' ? decision.sourceRef : null,
    existing: c.row,
  })
  if (!written.ok) return result('write_failed', `${status}:${reasonCode}`)
  return result(status, reasonCode, c.row?.id ?? null)
}

// ── a new letter ─────────────────────────────────────────────────────────────────────────────────────────

async function sendFresh(c: Ctx): Promise<SendOneResult> {
  const ports = c.deps.createPorts({ clientId: c.plan.clientId, rule: c.armed.rule, now: c.now })
  const decision = await decideShadow({ contact: c.contact, rule: c.armed.rule, ports, mode: 'send' })
  if (decision.kind === 'defer') return decide(c, 'blocked', decision.reasonCode, null)
  if (decision.status === 'skipped') return decide(c, 'skipped', decision.reasonCode ?? 'skipped', decision)
  const email = c.contact.primaryEmail
  if (email === null) return decide(c, 'skipped', 'bad_email', decision)
  const rendered = renderWelcomeLetter(c.armed.template, c.contact.displayName, c.plan.sweepDay)
  if (!rendered.ok) return decide(c, rendered.reason === 'missing_first_name' ? 'skipped' : 'blocked', rendered.reason, decision)
  const problem = precheck(c, rendered.letter, email)
  if (problem !== null) return problem.stop ? result('stopped', problem.code, null, { stopRun: true }) : decide(c, 'blocked', problem.code, decision)
  return withLocks(c, email, null, async () => {
    const evidence = await ports.evidence(c.contact)
    if (!evidence.ok) return decide(c, 'blocked', 'frequency_unverifiable', decision)
    const late = evidenceReason(c.contact, c.armed.rule, evidence.items)
    if (late !== null) return decide(c, 'skipped', late, decision)
    const claim = await c.deps.ledger.claim(claimInput(c, rendered.letter, email, c.deps.newIdempotencyKey(), decision))
    return afterClaim(c, claim, rendered.letter, email)
  })
}

/** The full request, built with a placeholder id, must pass before anything is claimed (§16.8 ①). */
function precheck(c: Ctx, letter: RenderedLetter, email: string): { stop: boolean; code: string } | null {
  const built = buildLetterRequest(letter, {
    account: c.armed.record.account,
    rule: c.armed.rule,
    clientId: c.plan.clientId,
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

function claimInput(c: Ctx, letter: RenderedLetter, email: string, idempotencyKey: string, decision: ShadowDecision | null) {
  return {
    authorizationId: c.armed.record.id,
    contactId: c.contact.contactId,
    toAddressSha256: addressSha256(email),
    idempotencyKey,
    templateKey: c.armed.rule.send.template.key,
    templateVersion: c.armed.templateVersion,
    templateSha256: c.armed.templateSha256,
    renderedSha256: letter.renderedSha256,
    sourceRef: decision?.kind === 'write' ? decision.sourceRef : null,
    consentBasis: decision?.kind === 'write' ? decision.consentBasis : null,
  }
}

// ── a letter in flight (the run before did not finish it) ────────────────────────────────────────────────

async function takeOver(c: Ctx, row: LifetimeRow): Promise<SendOneResult> {
  const email = c.contact.primaryEmail
  // A replay must carry the very same request: other authorization, other address or other content = never resend
  // (the row is left to the 20-hour rule and a person, §3.3 step 8).
  if (row.authorizationId !== c.armed.record.id || row.idempotencyKey === null || row.renderedSha256 === null) return result('in_flight', 'not_replayable', row.id)
  if (email === null || !isPlausibleEmail(email) || addressSha256(email) !== row.toAddressSha256) return result('in_flight', 'address_changed', row.id)
  const rendered = renderWelcomeLetter(c.armed.template, c.contact.displayName, c.plan.sweepDay)
  if (!rendered.ok || rendered.letter.renderedSha256 !== row.renderedSha256) return result('in_flight', 'content_changed', row.id)
  const idempotencyKey = row.idempotencyKey
  return withLocks(c, email, row, async () => {
    const ports = c.deps.createPorts({ clientId: c.plan.clientId, rule: c.armed.rule, now: c.now })
    // Only the cap is checked again on a takeover; whether a person wrote first was decided at the claim (§4.2).
    const evidence = await ports.evidence(c.contact, { exemptSendId: row.id })
    if (!evidence.ok) return noted(c, row, 'frequency_unverifiable')
    if (evidence.items.length >= c.armed.rule.frequency_cap.max) return noted(c, row, 'frequency_full')
    const claim = await c.deps.ledger.claim(claimInput(c, rendered.letter, email, idempotencyKey, null))
    return afterClaim(c, claim, rendered.letter, email)
  })
}

async function noted(c: Ctx, row: LifetimeRow, reasonCode: string): Promise<SendOneResult> {
  const written = await c.deps.ledger.noteBlock(row, reasonCode)
  return written.ok ? result('blocked', reasonCode, row.id) : result('write_failed', `note:${reasonCode}`, row.id)
}

async function withLocks(c: Ctx, address: string, pending: LifetimeRow | null, work: () => Promise<SendOneResult>): Promise<SendOneResult> {
  const locks = c.deps.createLocks()
  const taken = await locks.take(c.plan.clientId, c.contact.contactId, address)
  if (!taken.ok || !taken.held) {
    const reason = taken.ok ? 'lock_busy' : 'lock_unreadable'
    return pending === null ? decide(c, 'blocked', reason, null) : noted(c, pending, reason)
  }
  try {
    return await work()
  } finally {
    await locks.release(c.plan.clientId, c.contact.contactId, address).catch(() => undefined)
  }
}

// ── claim, send, record ──────────────────────────────────────────────────────────────────────────────────

async function afterClaim(c: Ctx, claim: ClaimRead, letter: RenderedLetter, email: string): Promise<SendOneResult> {
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
    default:
      // auth_inactive, rule_invalid, template_mismatch: the authorization no longer holds (checked inside the lock).
      return result('stopped', claim.outcome, id, { stopRun: true })
  }
}

async function deliver(c: Ctx, sendId: string, idempotencyKey: string, letter: RenderedLetter, email: string, attempt: 'first' | 'replay'): Promise<SendOneResult> {
  const timeline = await c.deps.writeTouchpoint({
    clientId: c.plan.clientId,
    contactId: c.contact.contactId,
    triggeredSendId: sendId,
    triggerKey: 'welcome',
    occurredAt: c.now.toISOString(),
    summary: TIMELINE_SUMMARY,
  })
  // No timeline record = the sales side would not see this letter: do not send (the next run takes the row over).
  if (!timeline.ok) return result('write_failed', 'timeline_failed', sendId)
  const read = await c.deps.ledger.rowById(c.plan.clientId, sendId)
  if (!read.ok || read.row === null) return result('read_failed', 'ledger_unreadable', sendId)
  const row = read.row
  // The link's issue time is the row's first attempt (written by the claim, never changed): every replay has the same link.
  const firstAttemptAt = row.firstAttemptAt
  if (firstAttemptAt === null) return result('read_failed', 'ledger_unreadable', sendId)
  const built = buildLetterRequest(letter, {
    account: c.armed.record.account,
    rule: c.armed.rule,
    clientId: c.plan.clientId,
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

async function recordOutcome(c: Ctx, row: LifetimeRow, outcome: ResendSendOutcome, attempt: 'first' | 'replay'): Promise<SendOneResult> {
  if (outcome.kind === 'sent') return recordSent(c, row, outcome.messageId)
  if (outcome.kind === 'not_attempted') return notAttempted(c, row, outcome.code, attempt)
  if (attempt === 'first' && outcome.kind === 'rejected') return failed(c, row, 'provider_rejected', 'rejected', false)
  if (attempt === 'first' && outcome.kind === 'account_error') return failed(c, row, 'provider_account_error', 'account_error', true)
  // Anything else (and every refusal of a replay) may have gone out: keep it pending, never send a second letter.
  return result('unknown_outcome', outcome.code, row.id, { providerImpact: 'PROVIDER_UNKNOWN' })
}

async function recordSent(c: Ctx, row: LifetimeRow, messageId: string): Promise<SendOneResult> {
  const accepted = { providerImpact: 'PROVIDER_ACCEPTED' as const }
  const written = await c.deps.ledger.markSent(row, { messageId, account: c.armed.record.account, sentAt: c.now.toISOString() })
  if (!written.ok) return result('write_failed', 'mark_sent_failed', row.id, accepted)
  if (written.result === 'changed') {
    // A receipt was faster and already bound the row: fine if it carries the same message id (§16.10).
    const again = await c.deps.ledger.rowById(c.plan.clientId, row.id)
    if (!again.ok || again.row === null) return result('read_failed', 'ledger_unreadable', row.id, accepted)
    if (again.row.providerMessageId !== messageId) return result('conflict', 'message_id_conflict', row.id, accepted)
  }
  const replayed = await c.deps.replayReceipts(messageId)
  return result('sent', replayed.error === null ? null : 'receipt_replay_failed', row.id, accepted)
}

async function failed(c: Ctx, row: LifetimeRow, reasonCode: string, outcome: 'rejected' | 'account_error' | 'not_attempted', stopRun: boolean): Promise<SendOneResult> {
  const written = await c.deps.ledger.markFailed(row, { reasonCode, account: c.armed.record.account })
  if (!written.ok) return result('write_failed', `failed:${reasonCode}`, row.id, { stopRun })
  // Not sent for certain: the timeline record no longer counts toward "7 days, 2 e-mails" (§16.8 ②⑤).
  const cancelled = await c.deps.cancelTouchpoint(c.plan.clientId, row.id)
  return result(outcome, cancelled.ok ? reasonCode : `${reasonCode}:timeline_not_cancelled`, row.id, { stopRun })
}

async function notAttempted(c: Ctx, row: LifetimeRow, code: string, attempt: 'first' | 'replay'): Promise<SendOneResult> {
  // Our own setup is wrong (key, secret, origin): stop the run. Only a first attempt is certainly not sent.
  if (attempt === 'replay') return result('not_attempted', code, row.id, { stopRun: true })
  return failed(c, row, 'not_attempted', 'not_attempted', true)
}

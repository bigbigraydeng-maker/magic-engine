/**
 * Real sending of the welcome letter for ONE client, around the per-contact step (`send-one.ts`):
 *   prepareSend    - may anything go out now (switches, authorization, setup, the send window)? which guests are due
 *                    (letters in flight first)? Plain JSON, no personal data. This version sends trials only: the guests
 *                    are found by the allow-listed addresses themselves (a hand-made internal contact has no lead form),
 *                    and NO other guest is read or written (a trial must not freeze real guests as skipped, 魏征 P1-2).
 *   recordStale    - guests too old to welcome get their final `skipped:stale` row.
 *   finalizeSend   - add the per-contact results up into the receipt of the run log (`summary.send`).
 * The rehearsal (`shadow-sweep.ts`) runs before it as always; real sending never replaces it.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.1–5.2, §17 (P2-2c-2).
 */

import { classifyContactAge, localDay } from './candidates'
import { GATE_CONTRACT_VERSION } from './rule'
import { checkArmed, isWithinSendWindow } from './send-arming'
import { TERMINAL_STATUSES } from './send-one'
import type { LifetimeRow, ProviderImpact, SendContact, SendDeps, SendOneResult, SendPlan, SendPrepareResult, SendReceipt, SendStopStatus } from './send-types'
import type { ShadowContact } from './types'

/** A trial names at most 3 addresses; more contacts than this behind them is not a trial any more. */
export const MAX_TRIAL_CONTACTS = 10

export function emptySendReceipt(createdAt: string): SendReceipt {
  return {
    status: 'sent_run',
    authorization_id: null,
    tried: 0,
    by_outcome: {},
    by_reason: {},
    provider_impact: 'NONE',
    stopped: null,
    error: null,
    created_at: createdAt,
  }
}

function stopped(createdAt: string, status: SendStopStatus, error: string | null, authorizationId: string | null): SendPrepareResult {
  return { kind: 'stop', receipt: { ...emptySendReceipt(createdAt), status, error, authorization_id: authorizationId } }
}

/** Letters in flight first (so a cap reached later cannot starve them), then new guests, then the stale ones. */
function sortGuests(contacts: readonly ShadowContact[], rows: readonly LifetimeRow[], liveFrom: string, now: Date, timeZone: string, maxAgeDays: number) {
  const byContact = new Map(rows.map((r) => [r.contactId, r]))
  const pending: string[] = []
  const fresh: string[] = []
  const stale: string[] = []
  for (const contact of contacts) {
    const row = byContact.get(contact.contactId)
    if (row !== undefined && TERMINAL_STATUSES.has(row.status)) continue
    if (row?.status === 'pending') {
      pending.push(contact.contactId)
      continue
    }
    const age = classifyContactAge({ createdAt: contact.createdAt, proposedAt: liveFrom, now, timeZone, maxAgeDays })
    if (age === 'candidate') fresh.push(contact.contactId)
    else if (age === 'stale') stale.push(contact.contactId)
  }
  return { contactIds: [...pending, ...fresh], staleIds: stale }
}

/** Phase 1 of real sending. Never throws. */
export async function prepareSend(args: { clientId: string; dryRun: boolean; deps: SendDeps }): Promise<SendPrepareResult> {
  const { clientId, dryRun, deps } = args
  const now = deps.now()
  const at = now.toISOString()
  try {
    if (dryRun) return stopped(at, 'dry_run', null, null)
    const armed = await checkArmed(deps, clientId, now, null)
    if (!armed.ok) return stopped(at, armed.status, armed.detail, armed.authorizationId)
    const { record, rule } = armed
    if (!isWithinSendWindow(rule, now)) return stopped(at, 'outside_send_window', null, record.id)
    const sweepDay = localDay(now, rule.schedule.timezone)
    if (sweepDay === null || record.liveFrom === null || Number.isNaN(Date.parse(record.liveFrom))) return stopped(at, 'read_failed', 'no usable live_from or time zone', record.id)
    // Defence in depth: checkArmed already refuses an authorization for real guests.
    if (rule.recipient_allowlist === null) return stopped(at, 'formal_sending_not_enabled', null, record.id)
    const found = await trialGuests(deps, clientId, rule.recipient_allowlist, rule.audience.sources)
    if (!found.ok) return stopped(at, 'read_failed', found.error, record.id)
    const ids = found.contacts.map((c) => c.contactId)
    const rows = ids.length === 0 ? { ok: true as const, rows: [] } : await deps.ledger.rowsFor(clientId, ids)
    if (!rows.ok) return stopped(at, 'read_failed', rows.error, record.id)
    // Only guests that came in after the authorization's start (§5.1): classifyContactAge drops the earlier ones.
    const sorted = sortGuests(found.contacts, rows.rows, record.liveFrom, now, rule.schedule.timezone, rule.audience.max_age_days)
    if (sorted.contactIds.length > 0) {
      // Unreadable mailboxes = "no person wrote yet" cannot be trusted: the whole batch waits (§5.2 F).
      const mailbox = await deps.checkMailboxes(clientId, rule.human_mail.required_mailboxes)
      if (!mailbox.ok) return stopped(at, 'mailbox_unreadable', mailbox.detail, record.id)
    }
    return { kind: 'plan', plan: { clientId, authorizationId: record.id, sweepDay, contactIds: sorted.contactIds, staleIds: sorted.staleIds, createdAt: at } }
  } catch (err) {
    return stopped(at, 'read_failed', `unexpected: ${err instanceof Error ? err.name : 'unknown'}`, null)
  }
}

/** The contacts behind a trial's allow-listed addresses, read one by one with the same reader as each letter. */
async function trialGuests(deps: SendDeps, clientId: string, allowlist: readonly string[], sources: readonly string[]): Promise<{ ok: true; contacts: SendContact[] } | { ok: false; error: string }> {
  const found = await deps.findContactIdsByAddresses(clientId, allowlist)
  if (!found.ok) return found
  if (found.contactIds.length > MAX_TRIAL_CONTACTS) return { ok: false, error: 'more contacts behind the trial addresses than a trial can have' }
  const contacts: SendContact[] = []
  for (const contactId of found.contactIds) {
    const read = await deps.loadContact({ clientId, contactId, sources })
    if (!read.ok) return { ok: false, error: read.error }
    // Only the contact's own allow-listed primary address is ever written to (decideShadow checks it again).
    if (read.contact !== null && read.contact.primaryEmail !== null && allowlist.includes(read.contact.primaryEmail)) contacts.push(read.contact)
  }
  return { ok: true, contacts }
}

/** Guests too old to welcome: a final `skipped:stale` row, unless they already hold a final or pending one. Never throws. */
export async function recordStale(args: { plan: SendPlan; deps: SendDeps }): Promise<SendOneResult[]> {
  const { plan, deps } = args
  if (plan.staleIds.length === 0) return []
  try {
    const rows = await deps.ledger.rowsFor(plan.clientId, plan.staleIds)
    if (!rows.ok) return plan.staleIds.map(() => ({ outcome: 'read_failed', reason: 'ledger_unreadable', sendId: null, stopRun: false, providerImpact: 'NONE' }))
    const byContact = new Map(rows.rows.map((r) => [r.contactId, r]))
    const out: SendOneResult[] = []
    for (const contactId of plan.staleIds) {
      const row = byContact.get(contactId) ?? null
      if (row !== null && row.status !== 'blocked') {
        out.push({ outcome: 'already_done', reason: row.status, sendId: row.id, stopRun: false, providerImpact: 'NONE' })
        continue
      }
      const written = await deps.ledger.recordDecision({
        clientId: plan.clientId, contactId, authorizationId: plan.authorizationId, status: 'skipped', reasonCode: 'stale',
        annotations: { gate_contract_version: GATE_CONTRACT_VERSION }, toAddressSha256: null, consentBasis: null, sourceRef: null, existing: row,
      })
      out.push({ outcome: written.ok ? 'skipped' : 'write_failed', reason: 'stale', sendId: row?.id ?? null, stopRun: false, providerImpact: 'NONE' })
    }
    return out
  } catch {
    return plan.staleIds.map(() => ({ outcome: 'read_failed', reason: 'unexpected', sendId: null, stopRun: false, providerImpact: 'NONE' }))
  }
}

const IMPACT_RANK: Record<ProviderImpact, number> = { NONE: 0, PROVIDER_UNKNOWN: 1, PROVIDER_ACCEPTED: 2 }

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

/** Phase 3: the run's receipt. `results` in the order the guests were tried; the first that stopped the run names why. */
export function finalizeSend(plan: SendPlan, results: readonly SendOneResult[]): SendReceipt {
  const receipt: SendReceipt = { ...emptySendReceipt(plan.createdAt), authorization_id: plan.authorizationId }
  for (const r of results) {
    receipt.tried += 1
    bump(receipt.by_outcome, r.outcome)
    if (r.reason !== null) bump(receipt.by_reason, `${r.outcome}:${r.reason}`)
    if (IMPACT_RANK[r.providerImpact] > IMPACT_RANK[receipt.provider_impact]) receipt.provider_impact = r.providerImpact
    if (r.stopRun && receipt.stopped === null) receipt.stopped = `${r.outcome}:${r.reason ?? ''}`
  }
  return receipt
}

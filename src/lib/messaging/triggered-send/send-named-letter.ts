/**
 * One named letter of a letter list, to one guest, now: the entry the AI follow-up (76) calls when its own schedule
 * says this guest is due this letter (design 2026-11-17 §2, §7.3). Never throws. The sender does not decide WHO gets
 * WHICH letter WHEN (that is the caller's); it decides whether this letter may safely go now, sends it, and keeps the
 * receipt. The same letter to the same guest is claimed at most once ever (the database's unique key), so calling
 * again is safe.
 *
 *   the call itself (letter key, the caller's reference) → re-check (switches, the authorization of THIS trigger, the one
 *   letter's pinned template, trial, window) → the guest → not on the trial list = stop, nothing written → any letter of
 *   this guest pending for more than 20 hours is handed to the claim function (it turns into "outcome unknown") → this
 *   letter's row: final = `already_done` with its real status → the shared body (`send-core.ts`).
 *
 * What a named letter does differently from the welcome letter (its flow): its rows are `letter:<key>`, claimed by
 * `triggered_send_claim_letter`; it renders the first name and the catalogue link frozen in the authorization, for the
 * day of its first attempt (a replay renders the same letter, W6); a full 7-day cap is a WAIT (`blocked`), not final;
 * the gates the rule switches off are not judged (`rule.gates`); its body carries link tracking (`letter-body.ts`).
 * 🔴 This version still sends trials only (`formal_sending_not_enabled` in `send-arming.ts`): no real guest gets one.
 */

import { localDay } from './candidates'
import { letterFinalText, REQUEST_REF_ANNOTATION } from './letter-body'
import { checkArmed, isWithinSendWindow } from './send-arming'
import { decide, result, sendToGuest, TERMINAL_STATUSES, type ArmedOk, type SendCtx, type SendFlow } from './send-core'
import { renderNamedLetter } from './send-letter'
import { gatesOf, type LetterEntry } from './rule'
import type { LetterLedger, LetterRow, LetterStatusesRead, NamedLetterDeps, NamedLetterRequest, NamedLetterResult, SendContact } from './send-types'
import { isTriggerKey, LETTER_KEY_RE, triggerProfile } from './trigger-scope'

/** The caller's own record id: an id-like string, never an address or a name. */
const REQUEST_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/
/** A pending letter older than this is handed to the claim function (its own limit is 20 hours; a margin for clocks). */
const STALE_PENDING_MS = 20 * 3_600_000 + 5 * 60_000
const DAY_MS = 86_400_000
/** A rendered fingerprint no letter can have (see `expireStalePending`). */
const NEVER_MATCHING_RENDER = '0'.repeat(64)

function requestProblem(req: NamedLetterRequest): string | null {
  if (typeof req.letterKey !== 'string' || !LETTER_KEY_RE.test(req.letterKey)) return 'letter_not_authorized'
  if (typeof req.requestRef !== 'string' || !REQUEST_REF_RE.test(req.requestRef)) return 'request_ref_invalid'
  return null
}

function inAllowlist(armed: ArmedOk, contact: SendContact): boolean {
  const list = armed.rule.recipient_allowlist
  return list === null || (contact.primaryEmail !== null && list.includes(contact.primaryEmail))
}

function labelOf(armed: ArmedOk): string {
  const key = armed.record.triggerKey
  return isTriggerKey(key) ? triggerProfile(key).label : key
}

export async function sendNamedLetter(req: NamedLetterRequest, deps: NamedLetterDeps): Promise<NamedLetterResult> {
  try {
    const bad = requestProblem(req)
    // The caller's own mistake for this one call: other guests are not affected (stopRun stays false).
    if (bad !== null) return result('stopped', bad, null)
    const now = deps.now()
    // First, before the authorization or the trial list (P2-3): a letter of this guest pending for more than 20 hours is
    // turned into "outcome unknown" even when the authorization is gone or the guest is no longer on the list.
    const rows = await currentRows(deps, req, now)
    if (!rows.ok) return result('read_failed', 'ledger_unreadable')
    const armed = await checkArmed(deps, req.clientId, now, null, req.letterKey)
    // A letter the PM did not list stops only this call; anything else about the authorization stops the day.
    if (!armed.ok) return result('stopped', armed.status, null, { stopRun: armed.status !== 'letter_not_authorized' })
    // A letter the PM did not list: only this call stops (the listed letters of other guests may still go out).
    if (armed.letter === null) return result('stopped', 'letter_not_authorized', null)
    if (!isWithinSendWindow(armed.rule, now)) return result('stopped', 'outside_send_window', null, { stopRun: true })
    const loaded = await deps.loadContact({ clientId: req.clientId, contactId: req.contactId, sources: armed.rule.audience.sources })
    if (!loaded.ok) return result('read_failed', 'contact_unreadable')
    if (loaded.contact === null) return result('contact_missing', null)
    // A trial: a guest who is not on its list is not this authorization's business. Nothing is written, so the guest is
    // not marked off for good while the trial runs (W2).
    if (!inAllowlist(armed, loaded.contact)) return result('stopped', 'not_in_allowlist', null)
    return await toGuest(req, deps, { armed, letter: armed.letter, contact: loaded.contact, rows: rows.rows }, now)
  } catch (err) {
    console.error('[triggered-send] named letter failed', err instanceof Error ? err.name : 'unknown')
    return result('read_failed', 'unexpected')
  }
}

interface Guest {
  armed: ArmedOk
  letter: LetterEntry
  contact: SendContact
  /** The guest's letter rows, read (after the 20-hour hand-over) at the start of the call. */
  rows: readonly LetterRow[]
}

async function toGuest(req: NamedLetterRequest, deps: NamedLetterDeps, g: Guest, now: Date): Promise<NamedLetterResult> {
  const { armed, letter, contact } = g
  const row = g.rows.find((r) => r.letterKey === req.letterKey) ?? null
  if (row !== null && TERMINAL_STATUSES.has(row.status)) return { ...result('already_done', row.status, row.id), rowStatus: row.status }
  const ledger = deps.letters(req.letterKey)
  const flow = letterFlow(req, deps, armed, letter, contact, ledger, now)
  const ctx: SendCtx = { flow, deps, armed, contact, row: row?.status === 'blocked' ? row : null, now }
  if (row?.status !== 'pending' && isStale(armed, contact, now)) return decide(ctx, 'skipped', 'stale', null)
  return withRowStatus(deps, req, await sendToGuest(ctx, row))
}

/** The guest's letter rows, after handing any letter pending for more than 20 hours to the claim function (§7.4). */
async function currentRows(deps: NamedLetterDeps, req: NamedLetterRequest, now: Date): Promise<{ ok: true; rows: LetterRow[] } | { ok: false }> {
  const first = await deps.letterRows(req.clientId, req.contactId)
  if (!first.ok) return { ok: false }
  const expired = await expireStalePending(deps, first.rows, now)
  if (!expired) return first
  const again = await deps.letterRows(req.clientId, req.contactId)
  return again.ok ? again : { ok: false }
}

/**
 * The claim function turns a pending letter older than 20 hours into `unknown_outcome` before anything else (it does
 * so even when the authorization is gone). It is handed the row's own frozen inputs; its answer is not needed here.
 *
 * 🔴 The rendered fingerprint passed is all zeros, never the row's own (P2-4): if the database's clock says the row is
 *    NOT yet 20 hours old, the function goes on, and at its step 10 a pending row whose lease ran out would be TAKEN
 *    OVER (lease renewed, attempts + 1) when the fingerprint matches. Zeros never match a real one, so that step answers
 *    `in_flight` and changes nothing; every earlier step either changes nothing or is the 20-hour hand-over we want.
 */
async function expireStalePending(deps: NamedLetterDeps, rows: readonly LetterRow[], now: Date): Promise<boolean> {
  let handed = false
  for (const r of rows) {
    const at = r.firstAttemptAt === null ? Number.NaN : Date.parse(r.firstAttemptAt)
    if (r.status !== 'pending' || Number.isNaN(at) || now.getTime() - at <= STALE_PENDING_MS) continue
    const { authorizationId, toAddressSha256, idempotencyKey, templateKey, templateVersion, templateSha256 } = r
    if (authorizationId === null || toAddressSha256 === null || idempotencyKey === null || templateKey === null || templateVersion === null || templateSha256 === null) continue
    handed = true
    await deps.letters(r.letterKey).claim({ authorizationId, contactId: r.contactId, toAddressSha256, idempotencyKey, templateKey, templateVersion, templateSha256, renderedSha256: NEVER_MATCHING_RENDER, sourceRef: null, consentBasis: null })
  }
  return handed
}

/** Only when the rule judges it (`gates.stale`): a lead older than the audience's age limit. */
function isStale(armed: ArmedOk, contact: SendContact, now: Date): boolean {
  if (!gatesOf(armed.rule).stale) return false
  const createdMs = Date.parse(contact.createdAt)
  return !Number.isNaN(createdMs) && now.getTime() - createdMs > armed.rule.audience.max_age_days * DAY_MS
}

function letterFlow(req: NamedLetterRequest, deps: NamedLetterDeps, armed: ArmedOk, letter: LetterEntry, contact: SendContact, ledger: LetterLedger, now: Date): SendFlow {
  const timeZone = armed.rule.schedule.timezone
  return {
    clientId: req.clientId,
    ledger,
    triggerKey: armed.record.triggerKey,
    timelineSummary: `ME 自动发出：${labelOf(armed)} · ${req.letterKey}`,
    frequencyFullFinal: false,
    render: (pending) => {
      // A replay renders for the day of its first attempt, so a day going by cannot change the letter (W6).
      const day = localDay(pending?.firstAttemptAt ?? now, timeZone)
      if (day === null) return { ok: false, reason: 'render_failed' }
      const rendered = renderNamedLetter(armed.template, contact.displayName, day, letter.context)
      return rendered.ok ? rendered : { ok: false, reason: rendered.reason }
    },
    extraAnnotations: { [REQUEST_REF_ANNOTATION]: req.requestRef },
    finalText: (c, row, rendered) => letterFinalText({ deps, ledger, requestRef: req.requestRef }, c, row, rendered),
  }
}

/** The claim said the letter was already handled: say how (the caller must not read it as "sent"). */
async function withRowStatus(deps: NamedLetterDeps, req: NamedLetterRequest, out: NamedLetterResult): Promise<NamedLetterResult> {
  if (out.outcome !== 'already_done' || out.sendId === null) return out
  const rows = await deps.letterRows(req.clientId, req.contactId)
  const row = rows.ok ? rows.rows.find((r) => r.id === out.sendId) : undefined
  return row === undefined ? out : { ...out, rowStatus: row.status }
}

/**
 * Read-only: every letter of this guest the sender has a row for, with its status (§7.3, Z8). The caller reads this
 * instead of the table. A letter with no row has not been decided yet. Never throws.
 */
export async function letterStatuses(clientId: string, contactId: string, deps: Pick<NamedLetterDeps, 'letterRows'>): Promise<LetterStatusesRead> {
  try {
    const rows = await deps.letterRows(clientId, contactId)
    if (!rows.ok) return rows
    const letters = rows.rows
      .map((r) => ({ letterKey: r.letterKey, status: r.status, sentAt: r.sentAt, sendId: r.id }))
      .sort((a, b) => (a.letterKey < b.letterKey ? -1 : a.letterKey > b.letterKey ? 1 : 0))
    return { ok: true, letters }
  } catch (err) {
    return { ok: false, error: `letter statuses: ${err instanceof Error ? err.name : 'error'}` }
  }
}

/**
 * `resolve_unknown`: the PM settles a welcome letter whose outcome nobody could tell (`unknown_outcome`: the provider
 * call ended in a way that may still have sent it, and the 20 hours to replay it ran out), after looking in the
 * provider's dashboard or asking the guest (design P2 §4.2 row 2, §17.4, §17.7).
 *
 *  - 「已发出」→ `sent` (`reason_code='sent_confirmed'`, `provider_impact='PROVIDER_ACCEPTED'`). `sent_at` stays empty:
 *    the weekly per-guest cap then counts the letter from the LATEST moment it could have gone (first attempt + 20 hours,
 *    `frequency-sources-prod.ts`), so it never leaves the window early, and a later real receipt fills in the real time.
 *  - 「没发出」→ `failed` (`reason_code='not_sent_confirmed'`) and the letter's timeline line is marked cancelled. The
 *    address stays taken on purpose (the ledger's address index keeps `failed + not_sent_confirmed`), and the letter
 *    still counts toward the weekly cap: this guest is never welcomed automatically again, a salesperson writes if needed.
 *    A late real receipt may still move the row on (the one way back the table allows); the timeline line is then NOT
 *    changed back here: the page shows the row with a warning, and the daily reconciliation (§17 之三) restores it.
 *
 * Only an `unknown_outcome` row of this client's welcome letter, exactly as the page showed it (`updated_at`): a row a
 * receipt moved on meanwhile is refused and the page reads again. `not_sent_confirmed` is written on no other step (§13).
 * Preview unless `confirm: true`; the preview also says whether the letter has a timeline line at all (a letter without
 * one never reached the provider: the sender writes the line first and does not send when it cannot). WHO may call it is
 * the route's business (the approver list, like authorizing). Sends nothing and calls no provider.
 *
 * No event (CLAUDE.md §3): one synchronous write without an outside side effect, and nothing downstream needs waking.
 * The machine-readable receipt is the ledger row itself (`annotations.resolution`: outcome, who, when, request id).
 * Restore condition: when another flow must act on a resolution (e.g. a todo or the daily reconciliation pushing work),
 * emit `crm.triggered_send.outcome_resolved` from here after the write.
 */

import { z } from 'zod'
import { AUTHORIZATION_UUID_SCHEMA, done, refuse, type Actor, type CommandResult } from './authorization-core'
import { NOT_SENT_CONFIRMED, SENT_CONFIRMED } from './receipt'
import type { TouchpointCancel } from './send-touchpoint'
import type { CasWrite } from './send-types'

export { SENT_CONFIRMED }
export const RESOLUTION_OUTCOMES = ['sent', 'not_sent'] as const
export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number]

export const ResolveUnknownCommandSchema = z
  .object({
    client_id: AUTHORIZATION_UUID_SCHEMA,
    send_id: AUTHORIZATION_UUID_SCHEMA,
    outcome: z.enum(RESOLUTION_OUTCOMES),
    /** The row's `updated_at` exactly as the page showed it: the PM settles the letter he saw, not a newer state. */
    seen_updated_at: z.string().min(1).max(64),
    confirm: z.boolean().default(false),
  })
  .strict()
export type ResolveUnknownCommand = z.infer<typeof ResolveUnknownCommandSchema>

/** A live ledger row as this command reads it (welcome letter, `dedupe_scope='lifetime'`, this client). */
export interface ResolvableRow {
  id: string
  clientId: string
  status: string
  reasonCode: string | null
  firstAttemptAt: string | null
  annotations: Record<string, unknown>
  updatedAt: string
}

export interface Resolution {
  outcome: ResolutionOutcome
  by: string
  by_user_id: string
  at: string
  request_id: string
}

export interface ResolveDeps {
  load(clientId: string, sendId: string): Promise<{ ok: true; row: ResolvableRow | null } | { ok: false; error: string }>
  /** Compare-and-set from `unknown_outcome` at the `updated_at` that was read: 'changed' = something moved it on. */
  write(row: ResolvableRow, patch: Record<string, unknown>): Promise<CasWrite>
  /** Marks the letter's timeline line cancelled (idempotent; `updated: 0` = there was none). */
  cancelTimeline(clientId: string, sendId: string): Promise<TouchpointCancel>
  /** Whether the letter has its timeline line (`null` = could not tell). */
  timelinePresent(clientId: string, sendId: string): Promise<boolean | null>
  now(): Date
  newRequestId(): string
}

/** What follows each answer (the page words it before the PM confirms). */
export const CONSEQUENCE: Readonly<Record<ResolutionOutcome, string>> = {
  sent: 'COUNTED_AS_SENT',
  not_sent: 'NEVER_WELCOMED_AUTOMATICALLY_AGAIN',
}

/**
 * What happened to the timeline line: only 「没发出」 changes it. `receipt_arrived` = a receipt moved the row on right
 * after the answer was written (the letter did go): the line is left as it was.
 */
export type TimelineResult = 'cancelled' | 'none' | 'failed' | 'unchanged' | 'receipt_arrived'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The answer a person already gave on this row, if any (only this command writes `annotations.resolution`). */
export function resolutionOf(annotations: unknown): Resolution | null {
  const r = isRecord(annotations) ? annotations.resolution : undefined
  if (!isRecord(r) || (r.outcome !== 'sent' && r.outcome !== 'not_sent')) return null
  return { outcome: r.outcome, by: text(r.by), by_user_id: text(r.by_user_id), at: text(r.at), request_id: text(r.request_id) }
}

function sendView(row: ResolvableRow): Record<string, unknown> {
  return { id: row.id, status: row.status, reason_code: row.reasonCode, updated_at: row.updatedAt }
}

function patchFor(row: ResolvableRow, resolution: Resolution): Record<string, unknown> {
  const annotations = { ...row.annotations, resolution }
  if (resolution.outcome === 'sent') return { status: 'sent', reason_code: SENT_CONFIRMED, provider_impact: 'PROVIDER_ACCEPTED', annotations }
  return { status: 'failed', reason_code: NOT_SENT_CONFIRMED, annotations }
}

function stillNotSent(row: ResolvableRow): boolean {
  return row.status === 'failed' && row.reasonCode === NOT_SENT_CONFIRMED
}

async function cancelTimeline(deps: ResolveDeps, clientId: string, sendId: string): Promise<TimelineResult> {
  const cancelled = await deps.cancelTimeline(clientId, sendId).catch((): TouchpointCancel => ({ ok: false, error: 'threw' }))
  if (!cancelled.ok) return 'failed'
  return cancelled.updated > 0 ? 'cancelled' : 'none'
}

/** The row as it is now (`null` = gone or unreadable). */
async function reload(deps: ResolveDeps, clientId: string, sendId: string): Promise<ResolvableRow | null> {
  const read = await deps.load(clientId, sendId).catch(() => null)
  return read === null || !read.ok ? null : read.row
}

/** 「没发出」 written: the timeline line is cancelled only while the row still says so (a receipt may have just moved it on). */
async function afterNotSent(deps: ResolveDeps, clientId: string, sendId: string): Promise<TimelineResult> {
  const now = await reload(deps, clientId, sendId)
  if (now !== null && !stillNotSent(now)) return 'receipt_arrived'
  return cancelTimeline(deps, clientId, sendId)
}

/**
 * The row was settled before. The same answer again (a double click, two tabs, or a retry after the timeline line could
 * not be changed) is fine and retries that line while the row still says 「没发出」; the other answer is refused: a
 * mistaken mark is corrected by a person in the database, not by flipping it here.
 */
async function answeredBefore(deps: ResolveDeps, row: ResolvableRow, earlier: Resolution, command: ResolveUnknownCommand): Promise<CommandResult> {
  if (earlier.outcome !== command.outcome) return refuse(409, 'ALREADY_RESOLVED', { send: sendView(row), resolution: earlier })
  const timeline: TimelineResult = command.confirm && stillNotSent(row) ? await cancelTimeline(deps, row.clientId, row.id) : 'unchanged'
  return done({ mode: 'ALREADY_RESOLVED', send: sendView(row), resolution: earlier, timeline })
}

async function preview(deps: ResolveDeps, row: ResolvableRow, command: ResolveUnknownCommand): Promise<CommandResult> {
  const timelinePresent = await deps.timelinePresent(row.clientId, row.id).catch(() => null)
  return done({ mode: 'PREVIEW', send: sendView(row), outcome: command.outcome, consequence: CONSEQUENCE[command.outcome], timeline_present: timelinePresent })
}

async function confirmAnswer(deps: ResolveDeps, row: ResolvableRow, actor: Actor, command: ResolveUnknownCommand): Promise<CommandResult> {
  const resolution: Resolution = { outcome: command.outcome, by: actor.email, by_user_id: actor.userId, at: deps.now().toISOString(), request_id: deps.newRequestId() }
  const written = await deps.write(row, patchFor(row, resolution))
  if (!written.ok) return refuse(500, 'RESOLVE_FAILED')
  if (written.result === 'changed') {
    const now = await reload(deps, row.clientId, row.id)
    const theirs = now === null ? null : resolutionOf(now.annotations)
    // Another tab gave the same answer a moment earlier: that is this answer, already written.
    if (now !== null && theirs !== null && theirs.outcome === command.outcome) return answeredBefore(deps, now, theirs, { ...command, confirm: false })
    return refuse(409, 'SEND_CHANGED', now === null ? { current_unreadable: true } : { send: sendView(now) })
  }
  const timeline: TimelineResult = command.outcome === 'not_sent' ? await afterNotSent(deps, row.clientId, row.id) : 'unchanged'
  return done({ mode: 'RESOLVED', send_id: row.id, outcome: command.outcome, consequence: CONSEQUENCE[command.outcome], resolution, timeline })
}

export async function resolveUnknownCommand(deps: ResolveDeps, clientId: string, actor: Actor, command: ResolveUnknownCommand): Promise<CommandResult> {
  const loaded = await deps.load(clientId, command.send_id)
  if (!loaded.ok) return refuse(500, 'SEND_UNREADABLE')
  const row = loaded.row
  if (row === null || row.clientId !== clientId) return refuse(404, 'SEND_NOT_FOUND')
  const earlier = resolutionOf(row.annotations)
  if (earlier !== null) return answeredBefore(deps, row, earlier, command)
  if (row.status !== 'unknown_outcome') return refuse(409, 'NOT_UNKNOWN', { send: sendView(row) })
  if (row.updatedAt !== command.seen_updated_at) return refuse(409, 'SEND_CHANGED', { send: sendView(row) })
  if (!command.confirm) return preview(deps, row, command)
  return confirmAnswer(deps, row, actor, command)
}

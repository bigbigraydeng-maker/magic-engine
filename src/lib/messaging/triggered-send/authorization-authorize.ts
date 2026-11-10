/**
 * Authorize a proposal (§4.3): the PM approves exactly the version he looked at.
 *
 * Fail-closed, in this order:
 *  - the request names the proposal's own rule and template fingerprints (what the page showed); any difference = refused;
 *  - the stored rule still parses as a sendable rule at today's gate version, and still has the fingerprint it was
 *    written with; the template's CURRENT version is still the one bound into the proposal and still sendable;
 *  - a proposal for real leads (no recipient allow-list) needs five consistent rehearsal days (§5.4); a controlled
 *    trial (allow-list of internal addresses) does not;
 *  - a preview unless `confirm: true`;
 *  - the authorization in force (if any) is revoked first (`SUPERSEDED`): a gap with no authorization is the safe way;
 *  - the database stamps the approval time; the window sent with it leaves a margin for clock skew;
 *  - armed (`activated_at`) only after the authorization event went out; if the event or the arming fails, this exact
 *    row is revoked again (`AUTHORIZE_FAILED`) and the response says whether that worked.
 * The sales path's own weekly cap (127) being wider than the rule's is shown in red but does not block (§4.3).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3, §13 (plan: §17).
 */

import { z } from 'zod'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import {
  AUTHORIZATION_SHA256_SCHEMA,
  AUTHORIZATION_UUID_SCHEMA,
  changeEvent,
  checkSendableRule,
  done,
  factsOf,
  recordView,
  refuse,
  revokeAsSystem,
  type Actor,
  type CommandDeps,
  type CommandResult,
  type SalesCapRead,
} from './authorization-commands'
import type { AuthorizationRecord } from './authorization-store'
import type { RehearsalEvidence } from './rehearsal-evidence'
import type { SendableRule, TriggeredSendRule } from './rule'

export const AuthorizeCommandSchema = z
  .object({
    client_id: AUTHORIZATION_UUID_SCHEMA,
    authorization_id: AUTHORIZATION_UUID_SCHEMA,
    rule_sha256: AUTHORIZATION_SHA256_SCHEMA,
    template_sha256: AUTHORIZATION_SHA256_SCHEMA,
    /** Also welcome leads that arrived up to this many hours before the approval (the cut-over gap; CHECK allows 36). */
    backfill_hours: z.number().int().min(0).max(35).default(0),
    expires_in_days: z.number().int().min(1).max(90).default(90),
    confirm: z.boolean().default(false),
  })
  .strict()
export type AuthorizeCommand = z.infer<typeof AuthorizeCommandSchema>

/**
 * The database stamps `authorized_at` with its own clock and the CHECKs compare against that stamp. There is no
 * database-time read in this code base, so the window is computed from the server clock with margins: an app clock
 * up to a minute ahead (`live_from`) or an hour ahead (`expires_at`) still fits (deviation from §13, written in §17).
 */
export const CLOCK_MARGIN_MS = 60_000
export const EXPIRY_MARGIN_MS = 60 * 60_000

export function authorizationWindow(now: Date, backfillHours: number, expiresInDays: number): { liveFrom: string; expiresAt: string } {
  return {
    liveFrom: new Date(now.getTime() - CLOCK_MARGIN_MS - backfillHours * 3_600_000).toISOString(),
    expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000 - EXPIRY_MARGIN_MS).toISOString(),
  }
}

/** Red text, never a block: the sales path is 127's. Compared with the rule's own cap (the snapshot is what ME uses). */
export function salesCapWarning(read: SalesCapRead, rule: TriggeredSendRule): string | null {
  if (read.kind === 'unknown') return 'SALES_FREQUENCY_CAP_UNKNOWN'
  if (read.cap === null) return 'SALES_FREQUENCY_CAP_OFF'
  if (read.cap.max > rule.frequency_cap.max || read.cap.windowDays < rule.frequency_cap.window_days) return 'SALES_FREQUENCY_CAP_WIDER'
  return null
}

type Verified =
  | { ok: true; rule: SendableRule; template: EmailTemplateVersion; rehearsal: RehearsalEvidence | null }
  | { ok: false; result: CommandResult }

function no(status: number, error: string, extra: Record<string, unknown> = {}): Verified {
  return { ok: false, result: refuse(status, error, extra) }
}

async function verifyProposal(deps: CommandDeps, record: AuthorizationRecord, command: AuthorizeCommand): Promise<Verified> {
  if (record.ruleSha256 !== command.rule_sha256) return no(409, 'RULE_CHANGED')
  if (record.templateVersion === null || record.templateSha256 === null) return no(422, 'PROPOSAL_HAS_NO_TEMPLATE')
  if (record.templateSha256 !== command.template_sha256) return no(409, 'TEMPLATE_MISMATCH')
  const checked = await checkSendableRule(deps, record.clientId, record.rule, record.account)
  if (!checked.ok) return checked
  if (checked.ruleSha256 !== record.ruleSha256) return no(422, 'RULE_INVALID', { detail: 'the stored rule does not match its fingerprint' })
  if (checked.templateVersion !== record.templateVersion || checked.templateSha256 !== record.templateSha256) {
    return no(409, 'TEMPLATE_CHANGED')
  }
  if (checked.rule.recipient_allowlist !== null) return { ok: true, rule: checked.rule, template: checked.template, rehearsal: null }
  const read = await deps.loadRehearsal(record.clientId, checked.rule)
  if (!read.ok) return no(503, 'REHEARSAL_UNREADABLE')
  if (read.evidence.consecutiveDays < read.evidence.requiredDays) {
    return no(422, 'REHEARSAL_NOT_READY', { consecutive_days: read.evidence.consecutiveDays, required_days: read.evidence.requiredDays })
  }
  return { ok: true, rule: checked.rule, template: checked.template, rehearsal: read.evidence }
}

async function warningsFor(deps: CommandDeps, clientId: string, rule: TriggeredSendRule): Promise<string[]> {
  let read: SalesCapRead
  try {
    read = await deps.loadSalesFrequencyCap(clientId)
  } catch {
    read = { kind: 'unknown' }
  }
  const warning = salesCapWarning(read, rule)
  return warning === null ? [] : [warning]
}

function writeFailure(code: string): CommandResult {
  if (code === 'not_open') return refuse(409, 'PROPOSAL_NOT_OPEN')
  if (code === 'authorized_exists') return refuse(409, 'AUTHORIZED_EXISTS')
  if (code === '23514') return refuse(500, 'AUTHORIZE_WINDOW_REFUSED', { hint: 'server and database clocks disagree; retry' })
  return refuse(500, 'AUTHORIZE_FAILED')
}

async function rollBack(deps: CommandDeps, record: AuthorizationRecord, error: string, reason: string): Promise<CommandResult> {
  let outcome: 'revoked' | 'not_open' | 'failed'
  try {
    outcome = await revokeAsSystem(deps, record, 'AUTHORIZE_FAILED', reason)
  } catch {
    outcome = 'failed'
  }
  const rollback = outcome === 'failed' ? 'FAILED' : 'OK'
  return refuse(500, error, {
    rollback,
    ...(rollback === 'FAILED' ? { hint: 'the authorization could not be revoked again and may be in force: revoke it on the page' } : {}),
  })
}

/** Event first, then arming; a failure in between revokes this exact row (never a newer one). */
async function arm(deps: CommandDeps, record: AuthorizationRecord, preview: Record<string, unknown>): Promise<CommandResult> {
  try {
    await deps.emit(changeEvent(deps, factsOf(record), 'authorized', 'person'))
  } catch {
    return rollBack(deps, record, 'AUTHORIZATION_EVENT_NOT_SENT', 'authorization event could not be sent')
  }
  let armed: Awaited<ReturnType<CommandDeps['store']['activate']>>
  try {
    armed = await deps.store.activate(record.id)
  } catch {
    return rollBack(deps, record, 'AUTHORIZATION_NOT_ACTIVATED', 'authorization could not be armed')
  }
  if (!armed.ok) {
    if (armed.code === 'not_open') return refuse(409, 'REVOKED_DURING_ARMING')
    return rollBack(deps, record, 'AUTHORIZATION_NOT_ACTIVATED', 'authorization could not be armed')
  }
  return done({ mode: 'AUTHORIZED', authorization: recordView(armed.record), preview })
}

export async function authorizeCommand(deps: CommandDeps, clientId: string, actor: Actor, command: AuthorizeCommand): Promise<CommandResult> {
  const loaded = await deps.store.load(command.authorization_id)
  if (!loaded.ok) return refuse(500, 'AUTHORIZATION_UNREADABLE')
  const record = loaded.record
  if (record === null || record.clientId !== clientId) return refuse(404, 'PROPOSAL_NOT_FOUND')
  if (record.revokedAt !== null) return refuse(409, 'PROPOSAL_REVOKED')
  if (record.authorizedAt !== null) return refuse(409, 'ALREADY_AUTHORIZED')
  const verified = await verifyProposal(deps, record, command)
  if (!verified.ok) return verified.result
  const open = await deps.store.loadOpen(clientId)
  if (!open.ok) return refuse(500, 'AUTHORIZATIONS_UNREADABLE')
  const replaces = open.open.authorized !== null && open.open.authorized.id !== record.id ? open.open.authorized : null
  const window = authorizationWindow(deps.now(), command.backfill_hours, command.expires_in_days)
  const preview = {
    authorization_id: record.id,
    trial: verified.rule.recipient_allowlist !== null,
    live_from: window.liveFrom,
    expires_at: window.expiresAt,
    daily_cap: record.dailyCap,
    replaces_authorization_id: replaces?.id ?? null,
    rehearsal: verified.rehearsal,
    warnings: await warningsFor(deps, clientId, verified.rule),
  }
  if (!command.confirm) return done({ mode: 'PREVIEW', authorization: 'NOT_AUTHORIZED', preview })
  if (!deps.canEmit()) return refuse(503, 'EVENTS_NOT_CONFIGURED')
  if (replaces !== null && (await revokeAsSystem(deps, replaces, 'SUPERSEDED', 'replaced by a newly authorized proposal')) === 'failed') {
    return refuse(500, 'OLD_AUTHORIZATION_NOT_REVOKED')
  }
  const written = await deps.store.authorize({ id: record.id, byEmail: actor.email, byUserId: actor.userId, ...window })
  if (!written.ok) return writeFailure(written.code)
  return arm(deps, written.record, preview)
}

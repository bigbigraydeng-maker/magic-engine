/**
 * Authorize a proposal (§4.3): the PM approves exactly the version he looked at.
 *
 * Fail-closed, in this order:
 *  - the request names the proposal's own rule and template fingerprints (what the page showed); any difference = refused;
 *  - every check of `assessProposal` (rule, gate, account, trial recipients, template still the bound one, mailboxes,
 *    five consistent rehearsal days for real leads, events configured): the same function the status page uses;
 *  - a preview unless `confirm: true`;
 *  - right before touching anything the proposal is read again and must still be open;
 *  - the authorization in force (if any) is revoked first (`system:SUPERSEDED`): the table allows one in force, and a gap
 *    is the safe way. From here on, every answer says that the old one was stopped (`replaced_authorization_revoked`);
 *  - the database stamps the approval time; the window sent with it leaves a margin for clock skew;
 *  - armed (`activated_at`) only after the authorization event went out; if the event or the arming fails, this exact
 *    row is revoked again (`AUTHORIZE_FAILED`) and the answer says whether that worked.
 * Who may call it (the PM himself) is the route's door. Warnings (red text) never block.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3, §13 (plan: §17, §17.2).
 */

import { z } from 'zod'
import { assessProposal } from './authorization-assess'
import {
  AUTHORIZATION_SHA256_SCHEMA,
  AUTHORIZATION_UUID_SCHEMA,
  changeEvent,
  done,
  factsOf,
  isWelcomeEmail,
  recordView,
  refuse,
  revokeAsSystem,
  type Actor,
  type CommandDeps,
  type CommandResult,
} from './authorization-core'
import type { AuthorizationRecord } from './authorization-store'

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
 * up to a minute ahead (`live_from`) or an hour ahead (`expires_at`) still fits (deviation from §13, written in §17.1).
 */
export const CLOCK_MARGIN_MS = 60_000
export const EXPIRY_MARGIN_MS = 60 * 60_000

export function authorizationWindow(now: Date, backfillHours: number, expiresInDays: number): { liveFrom: string; expiresAt: string } {
  return {
    liveFrom: new Date(now.getTime() - CLOCK_MARGIN_MS - backfillHours * 3_600_000).toISOString(),
    expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000 - EXPIRY_MARGIN_MS).toISOString(),
  }
}

type Stopped = Record<string, unknown>

function writeFailure(code: string, stopped: Stopped): CommandResult {
  if (code === 'not_open') return refuse(409, 'PROPOSAL_NOT_OPEN', stopped)
  if (code === 'authorized_exists') return refuse(409, 'AUTHORIZED_EXISTS', stopped)
  if (code === '23514') return refuse(500, 'AUTHORIZE_WINDOW_REFUSED', stopped)
  return refuse(500, 'AUTHORIZE_FAILED', stopped)
}

async function rollBack(deps: CommandDeps, record: AuthorizationRecord, error: string, reason: string, stopped: Stopped): Promise<CommandResult> {
  let outcome: 'revoked' | 'not_open' | 'failed'
  try {
    outcome = await revokeAsSystem(deps, record, 'AUTHORIZE_FAILED', reason)
  } catch {
    outcome = 'failed'
  }
  // Rolled back = this proposal is revoked too: authorizing it again needs a new proposal.
  return refuse(500, error, { rollback: outcome === 'failed' ? 'FAILED' : 'OK', ...stopped })
}

/** Event first, then arming; a failure in between revokes this exact row (never a newer one). */
async function arm(deps: CommandDeps, record: AuthorizationRecord, preview: Record<string, unknown>, stopped: Stopped): Promise<CommandResult> {
  try {
    await deps.emit(changeEvent(deps, factsOf(record), 'authorized', 'person'))
  } catch {
    return rollBack(deps, record, 'AUTHORIZATION_EVENT_NOT_SENT', 'authorization event could not be sent', stopped)
  }
  let armed: Awaited<ReturnType<CommandDeps['store']['activate']>>
  try {
    armed = await deps.store.activate(record.id)
  } catch {
    return rollBack(deps, record, 'AUTHORIZATION_NOT_ACTIVATED', 'authorization could not be armed', stopped)
  }
  if (!armed.ok) {
    if (armed.code === 'not_open') return refuse(409, 'REVOKED_DURING_ARMING', stopped)
    return rollBack(deps, record, 'AUTHORIZATION_NOT_ACTIVATED', 'authorization could not be armed', stopped)
  }
  return done({ mode: 'AUTHORIZED', authorization: recordView(armed.record), preview, ...stopped })
}

interface Confirm {
  actor: Actor
  record: AuthorizationRecord
  replaces: AuthorizationRecord | null
  window: { liveFrom: string; expiresAt: string }
  preview: Record<string, unknown>
}

async function confirmAuthorization(deps: CommandDeps, c: Confirm): Promise<CommandResult> {
  // Read the proposal again right before touching the authorization in force: it must still be open.
  const again = await deps.store.load(c.record.id)
  if (!again.ok) return refuse(500, 'AUTHORIZATION_UNREADABLE')
  if (again.record === null || again.record.revokedAt !== null || again.record.authorizedAt !== null) return refuse(409, 'PROPOSAL_NOT_OPEN')
  let stopped: Stopped = {}
  if (c.replaces !== null) {
    const outcome = await revokeAsSystem(deps, c.replaces, 'SUPERSEDED', `replaced by proposal ${c.record.id}`)
    if (outcome === 'failed') return refuse(500, 'OLD_AUTHORIZATION_NOT_REVOKED')
    if (outcome === 'revoked') stopped = { replaced_authorization_revoked: true, replaced_authorization_id: c.replaces.id }
  }
  const written = await deps.store.authorize({ id: c.record.id, byEmail: c.actor.email, byUserId: c.actor.userId, ...c.window })
  if (!written.ok) return writeFailure(written.code, stopped)
  return arm(deps, written.record, c.preview, stopped)
}

export async function authorizeCommand(deps: CommandDeps, clientId: string, actor: Actor, command: AuthorizeCommand): Promise<CommandResult> {
  const loaded = await deps.store.load(command.authorization_id)
  if (!loaded.ok) return refuse(500, 'AUTHORIZATION_UNREADABLE')
  const record = loaded.record
  if (record === null || record.clientId !== clientId || !isWelcomeEmail(record)) return refuse(404, 'PROPOSAL_NOT_FOUND')
  if (record.revokedAt !== null) return refuse(409, 'PROPOSAL_REVOKED')
  if (record.authorizedAt !== null) return refuse(409, 'ALREADY_AUTHORIZED')
  if (record.ruleSha256 !== command.rule_sha256) return refuse(409, 'RULE_CHANGED')
  if (record.templateSha256 !== null && record.templateSha256 !== command.template_sha256) return refuse(409, 'TEMPLATE_MISMATCH')
  const assessment = await assessProposal(deps, record)
  if (assessment.problem !== null) return assessment.problem
  const open = await deps.store.loadOpen(clientId)
  if (!open.ok) return refuse(500, 'AUTHORIZATIONS_UNREADABLE')
  const replaces = open.open.authorized !== null && open.open.authorized.id !== record.id ? open.open.authorized : null
  const window = authorizationWindow(deps.now(), command.backfill_hours, command.expires_in_days)
  const allowlist = assessment.rule?.recipient_allowlist ?? null
  const preview = {
    authorization_id: record.id,
    trial: allowlist !== null,
    trial_recipients: allowlist,
    live_from: window.liveFrom,
    backfill_hours: command.backfill_hours,
    expires_at: window.expiresAt,
    daily_cap: record.dailyCap,
    replaces_authorization_id: replaces?.id ?? null,
    rehearsal: assessment.rehearsal !== null && assessment.rehearsal.ok ? assessment.rehearsal.evidence : null,
    warnings: assessment.warnings,
  }
  if (!command.confirm) return done({ mode: 'PREVIEW', authorization: 'NOT_AUTHORIZED', preview })
  return confirmAuthorization(deps, { actor, record, replaces, window, preview })
}

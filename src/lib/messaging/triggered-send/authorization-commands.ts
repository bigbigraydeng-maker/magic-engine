/**
 * Two of the commands of the welcome letter's standing authorization (§4.3): propose and revoke. Authorize is in
 * `authorization-authorize.ts`, the read-only status in `authorization-status.ts`, the shared checks in
 * `authorization-assess.ts`, the shared ports and helpers in `authorization-core.ts`.
 *
 * Who may call them is decided by the routes alone (`authorization-http.ts`); everything here takes the caller as
 * given and only checks the content. Every write command is a preview unless `confirm: true`. Nothing here sends a
 * letter: an authorization is a database row that the sender reads.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §4.3, §8 (plan: §17).
 */

import { z } from 'zod'
import { checkSendableRule } from './authorization-assess'
import {
  AUTHORIZATION_UUID_SCHEMA,
  changeEvent,
  done,
  emitBestEffort,
  factsOf,
  isWelcomeEmail,
  recordView,
  refuse,
  revokeAsSystem,
  type Actor,
  type ChangeFacts,
  type CommandDeps,
  type CommandResult,
} from './authorization-core'

export const ProposeCommandSchema = z
  .object({
    client_id: AUTHORIZATION_UUID_SCHEMA,
    /** The Resend account the letters go out from (e.g. `cts`); its key is `RESEND_API_KEY_<ACCOUNT>`. */
    account: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
    daily_cap: z.number().int().min(1).max(50),
    rule: z.unknown(),
    confirm: z.boolean().default(false),
  })
  .strict()
export type ProposeCommand = z.infer<typeof ProposeCommandSchema>

export const RevokeCommandSchema = z
  .object({
    client_id: AUTHORIZATION_UUID_SCHEMA,
    authorization_id: AUTHORIZATION_UUID_SCHEMA,
    reason: z.string().trim().min(1).max(300),
  })
  .strict()
export type RevokeCommand = z.infer<typeof RevokeCommandSchema>

// ── propose ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Writes a proposal: what the PM will later approve exactly as written (the rule, its fingerprint, and the template's
 * current version and fingerprint). An open proposal is replaced (`system:SUPERSEDED`); the authorization in force,
 * if any, is not touched: only authorizing the new proposal replaces it.
 */
export async function proposeCommand(deps: CommandDeps, clientId: string, actor: Actor, command: ProposeCommand): Promise<CommandResult> {
  const checked = await checkSendableRule(deps, clientId, command.rule, command.account)
  if (!checked.ok) return checked.result
  const open = await deps.store.loadOpen(clientId)
  if (!open.ok) return refuse(500, 'AUTHORIZATIONS_UNREADABLE')
  const replaced = open.open.proposal
  const proposal = {
    account: command.account,
    rule: checked.rule,
    rule_sha256: checked.ruleSha256,
    template_key: checked.rule.send.template.key,
    template_version: checked.templateVersion,
    template_sha256: checked.templateSha256,
    daily_cap: command.daily_cap,
    replaces_proposal_id: replaced?.id ?? null,
  }
  if (!command.confirm) return done({ mode: 'PREVIEW', proposal })

  if (replaced !== null) {
    const superseded = await revokeAsSystem(deps, replaced, 'SUPERSEDED', 'replaced by a new proposal')
    if (superseded === 'failed') return refuse(500, 'OLD_PROPOSAL_NOT_REVOKED')
  }
  const requestId = deps.newRequestId()
  const inserted = await deps.store.insertProposal({
    requestId,
    clientId,
    triggerKey: 'welcome',
    channel: 'email',
    account: command.account,
    rule: checked.rule,
    ruleSha256: checked.ruleSha256,
    templateVersion: checked.templateVersion,
    templateSha256: checked.templateSha256,
    dailyCap: command.daily_cap,
    proposedByEmail: actor.email,
  })
  if (!inserted.ok) {
    // The old proposal had to go first (one open proposal per client): say so, the rehearsal stops until a new one is in.
    const extra = { replaced_proposal_revoked: replaced !== null }
    return inserted.code === 'proposal_conflict' ? refuse(409, 'PROPOSAL_CONFLICT', extra) : refuse(500, 'PROPOSAL_NOT_WRITTEN', extra)
  }
  const facts: ChangeFacts = {
    requestId,
    id: inserted.id,
    clientId,
    ruleSha256: checked.ruleSha256,
    templateVersion: checked.templateVersion,
    templateSha256: checked.templateSha256,
    dailyCap: command.daily_cap,
    liveFrom: null,
    expiresAt: null,
  }
  const eventStatus = await emitBestEffort(deps, changeEvent(deps, facts, 'proposed', 'person'))
  return done({ mode: 'PROPOSED', authorization_id: inserted.id, proposal, event_status: eventStatus })
}

// ── revoke ───────────────────────────────────────────────────────────────────────────────────────────────

/** What is open for this client right now: a revoke on a stale page must not leave the PM believing it stopped. */
async function currentlyOpen(deps: CommandDeps, clientId: string): Promise<Record<string, unknown>> {
  const open = await deps.store.loadOpen(clientId)
  if (!open.ok) return { current_unreadable: true }
  return {
    current_authorization: open.open.authorized === null ? null : recordView(open.open.authorized),
    current_proposal: open.open.proposal === null ? null : recordView(open.open.proposal),
  }
}

/**
 * The emergency brake: one database write. Always possible for an open row of this client, whatever its rule or
 * template; the event is best-effort and never undoes the revocation. Takes effect from the next letter on. When the
 * row was already revoked, the answer names what is open now (an older page may show a row a newer one replaced).
 */
export async function revokeCommand(deps: CommandDeps, clientId: string, actor: Actor, command: RevokeCommand): Promise<CommandResult> {
  const loaded = await deps.store.load(command.authorization_id)
  if (!loaded.ok) return refuse(500, 'AUTHORIZATION_UNREADABLE')
  const record = loaded.record
  if (record === null || record.clientId !== clientId || !isWelcomeEmail(record)) return refuse(404, 'AUTHORIZATION_NOT_FOUND')
  if (record.revokedAt !== null) {
    return refuse(409, 'ALREADY_REVOKED', { authorization: recordView(record), ...(await currentlyOpen(deps, clientId)) })
  }
  const revoked = await deps.store.revoke({ id: record.id, by: actor.email, reason: command.reason })
  if (!revoked.ok) {
    if (revoked.code === 'not_open') return refuse(409, 'ALREADY_REVOKED', await currentlyOpen(deps, clientId))
    return refuse(500, 'REVOKE_FAILED')
  }
  const eventStatus = await emitBestEffort(deps, changeEvent(deps, factsOf(revoked.record), 'revoked', 'person'))
  return done({ mode: 'REVOKED', authorization: recordView(revoked.record), event_status: eventStatus })
}

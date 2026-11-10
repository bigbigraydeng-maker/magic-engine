/**
 * The commands of the welcome letter's standing authorization (§4.3): propose and revoke here, authorize in
 * `authorization-authorize.ts`, the read-only status in `authorization-status.ts`.
 *
 * Who may call them is decided by the routes alone (a global administrator, never a scoped admin or a portal user);
 * everything here takes the caller as given and only checks the content. Every command is a preview unless
 * `confirm: true`. Nothing here sends a letter: an authorization is a database row that the sender reads.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §4.3, §8 (plan: §17).
 */

import { z } from 'zod'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import {
  buildAuthorizationChangedEvent,
  type AuthorizationChange,
  type AuthorizationChangedEvent,
} from '@/lib/inngest/triggered-send-events'
import { resendAccountKeyEnvName } from '@/lib/messaging/adapters/resend-email'
import type { AuthorizationRecord, NewProposal, OpenAuthorizations, StoreError } from './authorization-store'
import type { RehearsalRead } from './rehearsal-evidence'
import { GATE_CONTRACT_VERSION, parseSendRule, ruleSha256, type SendableRule, type TriggeredSendRule } from './rule'
import { checkAutomatedTemplate } from './welcome-template'

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'invalid id')
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/, 'invalid fingerprint')

export const ProposeCommandSchema = z
  .object({
    client_id: UUID,
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
    client_id: UUID,
    authorization_id: UUID,
    reason: z.string().trim().min(1).max(300),
  })
  .strict()
export type RevokeCommand = z.infer<typeof RevokeCommandSchema>

export { UUID as AUTHORIZATION_UUID_SCHEMA, SHA256 as AUTHORIZATION_SHA256_SCHEMA }

// ── ports ────────────────────────────────────────────────────────────────────────────────────────────────

export interface AuthorizationStorePort {
  loadOpen(clientId: string): Promise<{ ok: true; open: OpenAuthorizations } | StoreError>
  load(id: string): Promise<{ ok: true; record: AuthorizationRecord | null } | StoreError>
  insertProposal(p: NewProposal): Promise<{ ok: true; id: string } | StoreError>
  revoke(input: { id: string; by: string; reason: string }): Promise<{ ok: true; record: AuthorizationRecord } | StoreError>
  authorize(input: {
    id: string
    byEmail: string
    byUserId: string
    liveFrom: string
    expiresAt: string
  }): Promise<{ ok: true; record: AuthorizationRecord } | StoreError>
  activate(id: string): Promise<{ ok: true; record: AuthorizationRecord } | StoreError>
}

export type TemplateRead = { ok: true; template: EmailTemplateVersion | null } | { ok: false }
/** The sales (127) path's weekly cap: `null` cap = no cap at all; `unknown` = not readable or not set the new way. */
export type SalesCapRead = { kind: 'cap'; cap: { max: number; windowDays: number } | null } | { kind: 'unknown' }

export interface CommandDeps {
  store: AuthorizationStorePort
  loadTemplate(clientId: string, key: string): Promise<TemplateRead>
  loadSalesFrequencyCap(clientId: string): Promise<SalesCapRead>
  loadRehearsal(clientId: string, rule: TriggeredSendRule): Promise<RehearsalRead>
  emit(event: AuthorizationChangedEvent): Promise<void>
  /**
   * Whether events can be sent at all (configured). Authorizing replaces the authorization in force BEFORE the new one
   * is written (one in force at a time) and rolls the new one back when its event fails: without this check a missing
   * event key would turn every click into "the old one is gone and nothing is armed".
   */
  canEmit(): boolean
  now(): Date
  newRequestId(): string
}

/** The logged-in person the route let through. */
export interface Actor {
  email: string
  userId: string
}

export interface CommandResult {
  status: number
  body: Record<string, unknown>
}

export function refuse(status: number, error: string, extra: Record<string, unknown> = {}): CommandResult {
  return { status, body: { success: false, error, ...extra } }
}

export function done(body: Record<string, unknown>): CommandResult {
  return { status: 200, body: { success: true, no_send: true, provider_impact: 'NONE', ...body } }
}

// ── shared checks and views ──────────────────────────────────────────────────────────────────────────────

export type SendableCheck =
  | { ok: true; rule: SendableRule; ruleSha256: string; template: EmailTemplateVersion; templateVersion: number; templateSha256: string }
  | { ok: false; result: CommandResult }

/** A rule may be proposed for sending: it parses with its send block, at today's gate version, with a sendable template. */
export async function checkSendableRule(deps: CommandDeps, clientId: string, raw: unknown, account: string): Promise<SendableCheck> {
  const parsed = parseSendRule(raw)
  if (!parsed.ok) return { ok: false, result: refuse(422, 'RULE_INVALID', { detail: parsed.error }) }
  const rule = parsed.rule
  if (rule.gate_contract_version !== GATE_CONTRACT_VERSION) {
    return { ok: false, result: refuse(422, 'GATE_VERSION_MISMATCH', { rule_gate: rule.gate_contract_version, code_gate: GATE_CONTRACT_VERSION }) }
  }
  if (resendAccountKeyEnvName(account) === null) return { ok: false, result: refuse(422, 'ACCOUNT_INVALID') }
  const read = await deps.loadTemplate(clientId, rule.send.template.key)
  if (!read.ok) return { ok: false, result: refuse(503, 'TEMPLATE_UNREADABLE') }
  const check = checkAutomatedTemplate(read.template)
  if (!check.ok || read.template === null) {
    return { ok: false, result: refuse(422, 'TEMPLATE_NOT_SENDABLE', { reason: check.ok ? 'template_missing' : check.reason }) }
  }
  return { ok: true, rule, ruleSha256: ruleSha256(rule), template: read.template, templateVersion: check.version, templateSha256: check.sha256 }
}

/** What the responses show of a row (the rule itself is shown by the status view, with its summary). */
export function recordView(r: AuthorizationRecord): Record<string, unknown> {
  return {
    id: r.id,
    account: r.account,
    rule_sha256: r.ruleSha256,
    template_version: r.templateVersion,
    template_sha256: r.templateSha256,
    daily_cap: r.dailyCap,
    proposed_by_email: r.proposedByEmail,
    proposed_at: r.proposedAt,
    authorized_by_email: r.authorizedByEmail,
    authorized_at: r.authorizedAt,
    live_from: r.liveFrom,
    expires_at: r.expiresAt,
    activated_at: r.activatedAt,
    revoked_at: r.revokedAt,
    revoked_by: r.revokedBy,
    revoked_reason: r.revokedReason,
  }
}

export interface ChangeFacts {
  requestId: string
  id: string
  clientId: string
  ruleSha256: string
  templateVersion: number | null
  templateSha256: string | null
  dailyCap: number
  liveFrom: string | null
  expiresAt: string | null
}

export function factsOf(r: AuthorizationRecord): ChangeFacts {
  return {
    requestId: r.requestId,
    id: r.id,
    clientId: r.clientId,
    ruleSha256: r.ruleSha256,
    templateVersion: r.templateVersion,
    templateSha256: r.templateSha256,
    dailyCap: r.dailyCap,
    liveFrom: r.liveFrom,
    expiresAt: r.expiresAt,
  }
}

export function changeEvent(deps: CommandDeps, facts: ChangeFacts, change: AuthorizationChange, actor: string): AuthorizationChangedEvent {
  return buildAuthorizationChangedEvent({
    request_id: facts.requestId,
    authorization_id: facts.id,
    client_id: facts.clientId,
    change,
    actor,
    rule_sha256: facts.ruleSha256,
    template_version: facts.templateVersion,
    template_sha256: facts.templateSha256,
    daily_cap: facts.dailyCap,
    live_from: facts.liveFrom,
    expires_at: facts.expiresAt,
    now: deps.now(),
  })
}

/** Best-effort receipt for a change that holds without it (a proposal arms nothing; a revocation must never depend on it). */
export async function emitBestEffort(deps: CommandDeps, event: AuthorizationChangedEvent): Promise<'sent' | 'failed'> {
  try {
    await deps.emit(event)
    return 'sent'
  } catch {
    return 'failed'
  }
}

/** Revoke one open row as the system (`system:<code>`); a row that is no longer open is fine. */
export async function revokeAsSystem(
  deps: CommandDeps,
  record: AuthorizationRecord,
  code: string,
  reason: string,
): Promise<'revoked' | 'not_open' | 'failed'> {
  const revoked = await deps.store.revoke({ id: record.id, by: `system:${code}`, reason })
  if (!revoked.ok) return revoked.code === 'not_open' ? 'not_open' : 'failed'
  await emitBestEffort(deps, changeEvent(deps, factsOf(revoked.record), 'revoked', code))
  return 'revoked'
}

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
    // The old proposal had to go first (one open proposal per client); say so, so the page can ask for a retry.
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

/**
 * The emergency brake: one database write. Always possible for an open row of this client, whatever its rule or
 * template; the event is best-effort and never undoes the revocation. Takes effect from the next letter on.
 */
export async function revokeCommand(deps: CommandDeps, clientId: string, actor: Actor, command: RevokeCommand): Promise<CommandResult> {
  const loaded = await deps.store.load(command.authorization_id)
  if (!loaded.ok) return refuse(500, 'AUTHORIZATION_UNREADABLE')
  const record = loaded.record
  if (record === null || record.clientId !== clientId) return refuse(404, 'AUTHORIZATION_NOT_FOUND')
  if (record.revokedAt !== null) return refuse(409, 'ALREADY_REVOKED', { authorization: recordView(record) })
  const revoked = await deps.store.revoke({ id: record.id, by: actor.email, reason: command.reason })
  if (!revoked.ok) return revoked.code === 'not_open' ? refuse(409, 'ALREADY_REVOKED') : refuse(500, 'REVOKE_FAILED')
  const eventStatus = await emitBestEffort(deps, changeEvent(deps, factsOf(revoked.record), 'revoked', 'person'))
  return done({ mode: 'REVOKED', authorization: recordView(revoked.record), event_status: eventStatus })
}

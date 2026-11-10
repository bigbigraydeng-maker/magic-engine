/**
 * What the authorization commands share: the ports they run on, their result shape, the view of a row, and the
 * authorization events (`crm.triggered_send.authorization_changed`, §8). No command logic here.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §4.3, §8 (plan: §17).
 */

import { z } from 'zod'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import {
  buildAuthorizationChangedEvent,
  type AuthorizationChange,
  type AuthorizationChangedEvent,
} from '@/lib/inngest/triggered-send-events'
import type { AuthorizationRecord, NewProposal, OpenAuthorizations, StoreError } from './authorization-store'
import type { RehearsalRead } from './rehearsal-evidence'
import type { TriggeredSendRule } from './rule'
import type { MailboxCheck } from './types'

export const AUTHORIZATION_UUID_SCHEMA = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'invalid id')
export const AUTHORIZATION_SHA256_SCHEMA = z.string().regex(/^[0-9a-f]{64}$/, 'invalid fingerprint')

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
export type EnvReader = (name: string) => string | undefined

export interface CommandDeps {
  store: AuthorizationStorePort
  loadTemplate(clientId: string, key: string): Promise<TemplateRead>
  loadSalesFrequencyCap(clientId: string): Promise<SalesCapRead>
  loadRehearsal(clientId: string, rule: TriggeredSendRule): Promise<RehearsalRead>
  /** §5.2 F: the mailboxes the "has a salesperson written already" check reads must all be connected. */
  checkMailboxes(clientId: string, required: readonly string[]): Promise<MailboxCheck>
  emit(event: AuthorizationChangedEvent): Promise<void>
  /**
   * Whether events can be sent at all (configured). Authorizing replaces the authorization in force BEFORE the new one
   * is written (one in force at a time) and rolls the new one back when its event fails: without this check a missing
   * event key would turn every click into "the old one is gone and nothing is armed".
   */
  canEmit(): boolean
  /** Deploy settings read by name (never logged): the trial domains. */
  env: EnvReader
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

/** The welcome letter's rows only: another trigger or channel is not this page's business (once the table allows more). */
export function isWelcomeEmail(r: AuthorizationRecord): boolean {
  return r.triggerKey === 'welcome' && r.channel === 'email'
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

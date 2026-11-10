/**
 * Reads and writes of `triggered_send_authorizations` (rule snapshot + standing authorization).
 *
 * The table's own triggers carry the rules; this file only phrases the writes so they fit them:
 *  - a new row is always a proposal (every lifecycle column empty);
 *  - authorizing writes who/when/from/until once; the database stamps `authorized_at` itself and its CHECKs bound
 *    `live_from` (≤ now, ≥ now − 36 h) and `expires_at` (> now, ≤ now + 90 days);
 *  - arming (`activated_at`) is a separate, later statement, written only after the authorization event went out;
 *  - revoking writes once and always works; a revoked proposal can never be authorized;
 *  - at most one open proposal and one authorized row per client, trigger and channel (unique indexes).
 * Every write is conditional on the state it expects, so a stale page or a double click changes nothing.
 * Errors are passed on as codes only: the details of a failed write can echo the whole row.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §4.3 (plan: §17).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const TABLE = 'triggered_send_authorizations'
const COLUMNS =
  'id, request_id, client_id, trigger_key, channel, account, rule, rule_sha256, template_version, template_sha256, daily_cap, proposed_by_email, proposed_at, authorized_by_email, authorized_at, live_from, expires_at, activated_at, revoked_at, revoked_by, revoked_reason'

export interface AuthorizationRecord {
  id: string
  requestId: string
  clientId: string
  triggerKey: string
  channel: string
  account: string
  rule: unknown
  ruleSha256: string
  templateVersion: number | null
  templateSha256: string | null
  dailyCap: number
  proposedByEmail: string
  proposedAt: string
  authorizedByEmail: string | null
  authorizedAt: string | null
  liveFrom: string | null
  expiresAt: string | null
  activatedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  revokedReason: string | null
}

interface DbRow {
  id: string
  request_id: string
  client_id: string
  trigger_key: string
  channel: string
  account: string
  rule: unknown
  rule_sha256: string
  template_version: number | null
  template_sha256: string | null
  daily_cap: number
  proposed_by_email: string
  proposed_at: string
  authorized_by_email: string | null
  authorized_at: string | null
  live_from: string | null
  expires_at: string | null
  activated_at: string | null
  revoked_at: string | null
  revoked_by: string | null
  revoked_reason: string | null
}

export type StoreError = { ok: false; code: string }

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown'
}

function toRecord(r: DbRow): AuthorizationRecord {
  return {
    id: r.id,
    requestId: r.request_id,
    clientId: r.client_id,
    triggerKey: r.trigger_key,
    channel: r.channel,
    account: r.account,
    rule: r.rule,
    ruleSha256: r.rule_sha256,
    templateVersion: r.template_version,
    templateSha256: r.template_sha256,
    dailyCap: r.daily_cap,
    proposedByEmail: r.proposed_by_email,
    proposedAt: r.proposed_at,
    authorizedByEmail: r.authorized_by_email,
    authorizedAt: r.authorized_at,
    liveFrom: r.live_from,
    expiresAt: r.expires_at,
    activatedAt: r.activated_at,
    revokedAt: r.revoked_at,
    revokedBy: r.revoked_by,
    revokedReason: r.revoked_reason,
  }
}

export interface OpenAuthorizations {
  /** Not authorized, not revoked. */
  proposal: AuthorizationRecord | null
  /** Authorized, not revoked (it may still be unarmed or expired: judge it). */
  authorized: AuthorizationRecord | null
}

export async function loadOpenAuthorizations(
  db: SupabaseClient,
  key: { clientId: string; triggerKey: 'welcome'; channel: 'email' },
): Promise<{ ok: true; open: OpenAuthorizations } | StoreError> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq('client_id', key.clientId)
    .eq('trigger_key', key.triggerKey)
    .eq('channel', key.channel)
    .is('revoked_at', null)
    .limit(3)
  if (error) return { ok: false, code: codeOf(error) }
  const rows = ((data as DbRow[] | null) ?? []).map(toRecord)
  return {
    ok: true,
    open: {
      proposal: rows.find((r) => r.authorizedAt === null) ?? null,
      authorized: rows.find((r) => r.authorizedAt !== null) ?? null,
    },
  }
}

export async function loadAuthorization(db: SupabaseClient, id: string): Promise<{ ok: true; record: AuthorizationRecord | null } | StoreError> {
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return { ok: false, code: codeOf(error) }
  return { ok: true, record: data === null ? null : toRecord(data as DbRow) }
}

export interface NewProposal {
  requestId: string
  clientId: string
  triggerKey: 'welcome'
  channel: 'email'
  account: string
  rule: unknown
  ruleSha256: string
  templateVersion: number
  templateSha256: string
  dailyCap: number
  proposedByEmail: string
}

/**
 * Insert a proposal. Both unique keys (the request id, and "one open proposal per client, trigger and channel") answer
 * `proposal_conflict`: a retry of the same request, or another proposal written in between.
 */
export async function insertProposal(db: SupabaseClient, p: NewProposal): Promise<{ ok: true; id: string } | StoreError> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      request_id: p.requestId,
      client_id: p.clientId,
      trigger_key: p.triggerKey,
      channel: p.channel,
      account: p.account,
      rule: p.rule,
      rule_sha256: p.ruleSha256,
      template_version: p.templateVersion,
      template_sha256: p.templateSha256,
      daily_cap: p.dailyCap,
      proposed_by_email: p.proposedByEmail,
    })
    .select('id')
    .single()
  if (error) {
    const code = codeOf(error)
    if (code === '23505') return { ok: false, code: 'proposal_conflict' }
    return { ok: false, code }
  }
  return { ok: true, id: (data as { id: string }).id }
}

/**
 * Every row of one client's trigger, newest first, with just what the rehearsal evidence needs: which rule each
 * proposal carried (shadow rows point at the proposal they were decided under). Bounded: a client has a handful.
 */
export async function listAuthorizationRules(
  db: SupabaseClient,
  key: { clientId: string; triggerKey: 'welcome'; channel: 'email' },
): Promise<{ ok: true; rows: Array<{ id: string; rule: unknown; proposedAt: string }> } | StoreError> {
  const { data, error } = await db
    .from(TABLE)
    .select('id, rule, proposed_at')
    .eq('client_id', key.clientId)
    .eq('trigger_key', key.triggerKey)
    .eq('channel', key.channel)
    .order('proposed_at', { ascending: false })
    .limit(200)
  if (error) return { ok: false, code: codeOf(error) }
  const rows = (data as Array<{ id: string; rule: unknown; proposed_at: string }> | null) ?? []
  return { ok: true, rows: rows.map((r) => ({ id: r.id, rule: r.rule, proposedAt: r.proposed_at })) }
}

/** Revoke an open row. Writes once; a row already revoked is reported as `not_open`, never written again. */
export async function revokeAuthorization(
  db: SupabaseClient,
  input: { id: string; by: string; reason: string },
): Promise<{ ok: true; record: AuthorizationRecord } | StoreError> {
  // The table allows 1–300 characters or nothing: an empty reason is stored as "no reason", never as a CHECK failure.
  const reason = input.reason.trim().slice(0, 300)
  const { data, error } = await db
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.by, revoked_reason: reason.length > 0 ? reason : null })
    .eq('id', input.id)
    .is('revoked_at', null)
    .select(COLUMNS)
  if (error) return { ok: false, code: codeOf(error) }
  const rows = (data as DbRow[] | null) ?? []
  return rows.length === 1 ? { ok: true, record: toRecord(rows[0]) } : { ok: false, code: 'not_open' }
}

/**
 * Authorize an open proposal. `authorized_at` is stamped by the database; `liveFrom` and `expiresAt` must sit inside
 * the table's CHECKs against that stamp (the caller leaves a margin for clock skew). A CHECK violation = `23514`.
 */
export async function authorizeProposal(
  db: SupabaseClient,
  input: { id: string; byEmail: string; byUserId: string; liveFrom: string; expiresAt: string },
): Promise<{ ok: true; record: AuthorizationRecord } | StoreError> {
  const { data, error } = await db
    .from(TABLE)
    .update({
      authorized_by_email: input.byEmail,
      authorized_by_user_id: input.byUserId,
      authorized_at: new Date().toISOString(),
      live_from: input.liveFrom,
      expires_at: input.expiresAt,
    })
    .eq('id', input.id)
    .is('authorized_at', null)
    .is('revoked_at', null)
    .select(COLUMNS)
  if (error) {
    const code = codeOf(error)
    return { ok: false, code: code === '23505' ? 'authorized_exists' : code }
  }
  const rows = (data as DbRow[] | null) ?? []
  return rows.length === 1 ? { ok: true, record: toRecord(rows[0]) } : { ok: false, code: 'not_open' }
}

/** Arm an authorized row, after its authorization event went out. The database stamps the time. */
export async function activateAuthorization(db: SupabaseClient, id: string): Promise<{ ok: true; record: AuthorizationRecord } | StoreError> {
  const { data, error } = await db
    .from(TABLE)
    .update({ activated_at: new Date().toISOString() })
    .eq('id', id)
    .is('activated_at', null)
    .is('revoked_at', null)
    .not('authorized_at', 'is', null)
    .select(COLUMNS)
  if (error) return { ok: false, code: codeOf(error) }
  const rows = (data as DbRow[] | null) ?? []
  return rows.length === 1 ? { ok: true, record: toRecord(rows[0]) } : { ok: false, code: 'not_open' }
}

/**
 * The daily check's reads and writes (`reconcile.ts` decides). Built inside the Inngest step (CLAUDE.md §7).
 *
 * Writes only two things, both guarded:
 *  - an overdue pending letter → `unknown_outcome` (`expired_20h`), compare-and-set on the row's `updated_at` and
 *    `status = 'pending'`, the same move the claim function makes;
 *  - our own breaker → the client's authorized authorizations (every trigger) revoked as the system.
 * A read that fails or comes back full never trips the breaker: it is reported, nothing is revoked on half the data.
 * Results carry ids, codes and counts only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { revokeAsSystem } from './authorization-core'
import { createAuthorizationDeps } from './authorization-deps-prod'
import { loadOpenAuthorizations } from './authorization-store'
import { BREAKER_WINDOW_MS, EXPIRED_REASON, judgeHealth, overduePending, type BreakerVerdict, type ReconcileRow } from './reconcile'
import { EMAIL_CHANNEL, SHADOW_SCOPE, TRIGGER_KEYS } from './trigger-scope'

const TABLE = 'triggered_sends'
const MAX_ROWS = 5000
const COLUMNS = 'id, client_id, dedupe_scope, status, reason_code, bounce_kind, first_attempt_at, lease_expires_at, updated_at'

interface DbRow {
  id: string
  client_id: string
  dedupe_scope: string
  status: string
  reason_code: string | null
  bounce_kind: string | null
  first_attempt_at: string | null
  lease_expires_at: string | null
  updated_at: string
}

export type RowsRead = { ok: true; rows: ReconcileRow[] } | { ok: false; error: string }

/** Real letters still pending (any age) or handed over in the last 30 days. */
export async function loadReconcileRows(db: SupabaseClient, now: Date): Promise<RowsRead> {
  const since = new Date(now.getTime() - BREAKER_WINDOW_MS).toISOString()
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .neq('dedupe_scope', SHADOW_SCOPE)
    .or(`status.eq.pending,first_attempt_at.gte.${since}`)
    .order('first_attempt_at', { ascending: false, nullsFirst: true })
    .limit(MAX_ROWS)
  if (error) return { ok: false, error: `ledger read: ${error.code ?? error.message}` }
  const rows = (data as DbRow[] | null) ?? []
  if (rows.length >= MAX_ROWS) return { ok: false, error: `ledger read: ${MAX_ROWS} rows or more, not judged on part of them` }
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      dedupeScope: r.dedupe_scope,
      status: r.status,
      reasonCode: r.reason_code,
      bounceKind: r.bounce_kind,
      firstAttemptAt: r.first_attempt_at,
      leaseExpiresAt: r.lease_expires_at,
      updatedAt: r.updated_at,
    })),
  }
}

export interface ExpireResult {
  expired: string[]
  /** Rows that moved before the write (a receipt or a claim got there first): fine, left as they are. */
  moved: string[]
  errors: string[]
}

/** Overdue pending letters → unknown outcome. Each write is compare-and-set; a moved row is left alone. */
export async function expireOverdue(db: SupabaseClient, rows: readonly ReconcileRow[], now: Date): Promise<ExpireResult> {
  const out: ExpireResult = { expired: [], moved: [], errors: [] }
  for (const row of overduePending(rows, now)) {
    const { data, error } = await db
      .from(TABLE)
      .update({ status: 'unknown_outcome', provider_impact: 'PROVIDER_UNKNOWN', reason_code: EXPIRED_REASON })
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('updated_at', row.updatedAt)
      .select('id')
    if (error) out.errors.push(`${row.id}: ${error.code ?? error.message}`)
    else if (((data as unknown[] | null) ?? []).length === 1) out.expired.push(row.id)
    else out.moved.push(row.id)
  }
  return out
}

export interface BreakerResult {
  clientId: string
  verdict: BreakerVerdict
  revoked: string[]
  errors: string[]
}

async function revokeClient(db: SupabaseClient, clientId: string, code: string, reason: string): Promise<{ revoked: string[]; errors: string[] }> {
  const revoked: string[] = []
  const errors: string[] = []
  for (const trigger of TRIGGER_KEYS) {
    const read = await loadOpenAuthorizations(db, { clientId, triggerKey: trigger, channel: EMAIL_CHANNEL })
    if (!read.ok) {
      errors.push(`${trigger}: authorization read ${read.code}`)
      continue
    }
    const record = read.open.authorized
    if (record === null) continue
    const done = await revokeAsSystem(createAuthorizationDeps(db, trigger), record, code, `daily check: ${reason}`).catch(() => 'failed' as const)
    if (done === 'revoked') revoked.push(record.id)
    else if (done === 'failed') errors.push(`${trigger}: revoke failed`)
  }
  return { revoked, errors }
}

/** Judge each client that has real letters; revoke where the breaker trips. */
export async function runBreaker(db: SupabaseClient, rows: readonly ReconcileRow[], now: Date): Promise<BreakerResult[]> {
  const byClient = new Map<string, ReconcileRow[]>()
  for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r])
  const out: BreakerResult[] = []
  for (const [clientId, clientRows] of byClient) {
    const verdict = judgeHealth(clientRows, now)
    if (!verdict.trip) {
      out.push({ clientId, verdict, revoked: [], errors: [] })
      continue
    }
    out.push({ clientId, verdict, ...(await revokeClient(db, clientId, verdict.code, verdict.reason)) })
  }
  return out
}

/** The breaker for the client of one letter (after a bounce or complaint receipt). Never throws. */
export async function checkClientBreaker(db: SupabaseClient, sendId: string, now: Date): Promise<{ tripped: boolean; error: string | null }> {
  try {
    const own = await db.from(TABLE).select('client_id').eq('id', sendId).maybeSingle()
    if (own.error || own.data === null) return { tripped: false, error: `letter read: ${own.error?.code ?? 'missing'}` }
    const clientId = (own.data as { client_id: string }).client_id
    const rows = await loadReconcileRows(db, now)
    if (!rows.ok) return { tripped: false, error: rows.error }
    const [result] = await runBreaker(db, rows.rows.filter((r) => r.clientId === clientId), now)
    if (result === undefined) return { tripped: false, error: null }
    return { tripped: result.verdict.trip, error: result.errors.length > 0 ? result.errors.join('; ') : null }
  } catch (err) {
    return { tripped: false, error: err instanceof Error ? err.message : 'breaker check failed' }
  }
}

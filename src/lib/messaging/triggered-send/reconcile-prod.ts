/**
 * The daily check's reads and writes (`reconcile.ts` decides). Built inside the Inngest step (CLAUDE.md §7).
 *
 * Writes only two things, both guarded:
 *  - an overdue pending letter → `unknown_outcome` (`expired_20h`), compare-and-set on the row's `updated_at` and
 *    `status = 'pending'`, the same move the claim function makes;
 *  - our own breaker → an authorized authorization revoked as the system, judged on ITS OWN stop lines
 *    (`rule.send.health_breaker`) over the letters of its trigger handed over since it was switched on.
 * Rows are read in pages until the end (PostgREST answers at most 1000 rows per request and says nothing about the
 * rest: `fetchAll`, review 魏征 P0-1). A read that fails trips nothing: it is reported, nothing is revoked on half the data.
 * Results carry ids, codes and counts only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { revokeAsSystem } from './authorization-core'
import { createAuthorizationDeps } from './authorization-deps-prod'
import { loadOpenAuthorizations, type AuthorizationRecord } from './authorization-store'
import {
  EXPIRED_REASON,
  MAX_BREAKER_WINDOW_MS,
  STRICTEST_LIMITS,
  judgeHealth,
  overduePending,
  type BreakerLimits,
  type BreakerVerdict,
  type ReconcileRow,
} from './reconcile'
import { parseSendBlock } from './send-rule'
import { EMAIL_CHANNEL, SHADOW_SCOPE, TRIGGER_KEYS } from './trigger-scope'

const TABLE = 'triggered_sends'
const COLUMNS = 'id, client_id, trigger_key, dedupe_scope, status, reason_code, bounce_kind, first_attempt_at, lease_expires_at, updated_at'

interface DbRow {
  id: string
  client_id: string
  trigger_key: string
  dedupe_scope: string
  status: string
  reason_code: string | null
  bounce_kind: string | null
  first_attempt_at: string | null
  lease_expires_at: string | null
  updated_at: string
}

export type RowsRead = { ok: true; rows: ReconcileRow[] } | { ok: false; error: string }

function toRow(r: DbRow): ReconcileRow {
  return {
    id: r.id,
    clientId: r.client_id,
    triggerKey: r.trigger_key,
    dedupeScope: r.dedupe_scope,
    status: r.status,
    reasonCode: r.reason_code,
    bounceKind: r.bounce_kind,
    firstAttemptAt: r.first_attempt_at,
    leaseExpiresAt: r.lease_expires_at,
    updatedAt: r.updated_at,
  }
}

/** Real letters still pending (any age) or handed over in the longest breaker window; one client or all. Every page. */
export async function loadReconcileRows(db: SupabaseClient, now: Date, clientId: string | null = null): Promise<RowsRead> {
  const since = new Date(now.getTime() - MAX_BREAKER_WINDOW_MS).toISOString()
  try {
    const rows = await fetchAll<DbRow>((from, to) => {
      let q = db.from(TABLE).select(COLUMNS).neq('dedupe_scope', SHADOW_SCOPE).or(`status.eq.pending,first_attempt_at.gte.${since}`)
      if (clientId !== null) q = q.eq('client_id', clientId)
      return q.order('id', { ascending: true }).range(from, to)
    })
    // A row inserted between two pages shifts the next page by one: the same row can come back twice. One row per id,
    // or one complaint would count as two and trip the breaker (魏征 R2 P2).
    const byId = new Map(rows.map((r) => [r.id, r]))
    return { ok: true, rows: [...byId.values()].map(toRow) }
  } catch (err) {
    return { ok: false, error: `ledger read: ${err instanceof Error ? err.message : 'failed'}` }
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
  triggerKey: string
  authorizationId: string
  verdict: BreakerVerdict
  revoked: boolean
  errors: string[]
}

/** The stop lines the PM approved; the strictest allowed values when the rule cannot be read (and say so). */
export function limitsOf(record: AuthorizationRecord): { limits: BreakerLimits; error: string | null } {
  const rule = record.rule
  const send = typeof rule === 'object' && rule !== null ? (rule as { send?: unknown }).send : undefined
  const parsed = parseSendBlock(send)
  if (parsed.ok) return { limits: parsed.send.health_breaker, error: null }
  return { limits: STRICTEST_LIMITS, error: `rule unreadable (${parsed.error}), judged on the strictest stop lines` }
}

async function judgeAuthorization(
  db: SupabaseClient,
  record: AuthorizationRecord,
  rows: readonly ReconcileRow[],
  now: Date,
): Promise<BreakerResult> {
  const { limits, error } = limitsOf(record)
  const startedAt = record.activatedAt ?? record.authorizedAt ?? now.toISOString()
  const own = rows.filter((r) => r.clientId === record.clientId && r.triggerKey === record.triggerKey)
  // An unreadable rule is itself the reason to stop (as the sender says it, 子牙 R2 P2): no breaker wording for it.
  const judged = judgeHealth(own, limits, startedAt, now)
  const verdict: BreakerVerdict =
    error !== null && judged.trip ? { ...judged, code: 'RULE_INVALID', reason: '授权里存的发信规则读不懂了' } : judged
  const base = { clientId: record.clientId, triggerKey: record.triggerKey, authorizationId: record.id, verdict, revoked: false, errors: error === null ? [] : [error] }
  if (!verdict.trip) return base
  const done = await revokeAsSystem(createAuthorizationDeps(db, record.triggerKey as (typeof TRIGGER_KEYS)[number]), record, verdict.code, `daily check: ${verdict.reason}`).catch(() => 'failed' as const)
  if (done === 'failed') return { ...base, errors: [...base.errors, 'revoke failed'] }
  return { ...base, revoked: done === 'revoked' }
}

/** Judge every authorized authorization of the clients that have real letters; revoke the ones whose own lines trip. */
export async function runBreaker(db: SupabaseClient, rows: readonly ReconcileRow[], now: Date): Promise<BreakerResult[]> {
  const out: BreakerResult[] = []
  for (const clientId of new Set(rows.map((r) => r.clientId))) {
    for (const trigger of TRIGGER_KEYS) {
      const read = await loadOpenAuthorizations(db, { clientId, triggerKey: trigger, channel: EMAIL_CHANNEL })
      if (!read.ok) {
        out.push({ clientId, triggerKey: trigger, authorizationId: '', verdict: { trip: false, sent: 0, hardBounces: 0, complaints: 0 }, revoked: false, errors: [`authorization read ${read.code}`] })
        continue
      }
      if (read.open.authorized !== null) out.push(await judgeAuthorization(db, read.open.authorized, rows, now))
    }
  }
  return out
}

/** The breaker for the client of one letter (after a bounce or complaint receipt): reads only that client. Never throws. */
export async function checkClientBreaker(db: SupabaseClient, sendId: string, now: Date): Promise<{ tripped: boolean; error: string | null }> {
  try {
    const own = await db.from(TABLE).select('client_id').eq('id', sendId).maybeSingle()
    if (own.error || own.data === null) return { tripped: false, error: `letter read: ${own.error?.code ?? 'missing'}` }
    const clientId = (own.data as { client_id: string }).client_id
    const rows = await loadReconcileRows(db, now, clientId)
    if (!rows.ok) return { tripped: false, error: rows.error }
    const results = await runBreaker(db, rows.rows, now)
    const errors = results.flatMap((r) => r.errors)
    return { tripped: results.some((r) => r.verdict.trip), error: errors.length > 0 ? errors.join('; ') : null }
  } catch (err) {
    return { tripped: false, error: err instanceof Error ? err.message : 'breaker check failed' }
  }
}

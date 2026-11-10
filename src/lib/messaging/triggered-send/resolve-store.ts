/**
 * The database side of `resolve_unknown` (`resolve-unknown.ts`): read one live welcome-letter row of a client, write the
 * PM's answer as a compare-and-set from `unknown_outcome` at the `updated_at` that was read (a receipt that moved the
 * row on wins), and mark the letter's timeline line cancelled. The table's own guards still apply (status only forward,
 * write-once columns, `failed` reason written once). Errors are returned as codes only (a failed write may echo the row).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.2, §13, §17.4.
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvableRow, ResolveDeps } from './resolve-unknown'
import { cancelSendTouchpoint, WELCOME_NOT_SENT_TIMELINE_LINE } from './send-touchpoint'

const TABLE = 'triggered_sends'
const COLUMNS = 'id, client_id, status, reason_code, first_attempt_at, annotations, updated_at'

interface DbRow {
  id: string
  client_id: string
  status: string
  reason_code: string | null
  first_attempt_at: string | null
  annotations: unknown
  updated_at: string
}

function codeOf(error: { code?: unknown }): string {
  return typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'error'
}

function toRow(r: DbRow): ResolvableRow {
  const annotations = typeof r.annotations === 'object' && r.annotations !== null && !Array.isArray(r.annotations) ? (r.annotations as Record<string, unknown>) : {}
  return {
    id: r.id,
    clientId: r.client_id,
    status: r.status,
    reasonCode: r.reason_code,
    firstAttemptAt: r.first_attempt_at,
    annotations,
    updatedAt: r.updated_at,
  }
}

export function createResolveDeps(db: SupabaseClient): ResolveDeps {
  return {
    async load(clientId, sendId) {
      const { data, error } = await db
        .from(TABLE)
        .select(COLUMNS)
        .eq('client_id', clientId)
        .eq('id', sendId)
        .eq('trigger_key', 'welcome')
        .eq('channel', 'email')
        .eq('dedupe_scope', 'lifetime')
        .maybeSingle()
      if (error) return { ok: false, error: `ledger read: ${codeOf(error)}` }
      return { ok: true, row: data === null ? null : toRow(data as DbRow) }
    },
    async write(row, patch) {
      const { data, error } = await db
        .from(TABLE)
        .update(patch)
        .eq('id', row.id)
        .eq('client_id', row.clientId)
        .eq('status', 'unknown_outcome')
        .eq('updated_at', row.updatedAt)
        .select('id')
      if (error) return { ok: false, error: `ledger update: ${codeOf(error)}` }
      return { ok: true, result: (data ?? []).length === 1 ? 'updated' : 'changed' }
    },
    cancelTimeline: (clientId, sendId) =>
      cancelSendTouchpoint(db, { clientId, triggeredSendId: sendId, triggerKey: 'welcome', summary: WELCOME_NOT_SENT_TIMELINE_LINE }),
    now: () => new Date(),
    newRequestId: () => randomUUID(),
  }
}

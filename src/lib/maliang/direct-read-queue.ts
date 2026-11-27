/**
 * Ordering for the in-process 马良 sweep.
 * An order that cannot be read stays without a verdict, so the created_at
 * query would keep it at the head. A failed read stamps output (no new column)
 * and sorts after orders that have not been tried. Three failed reads in a row
 * set skipped; the sweep and the daily todo both read that flag.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const DIRECT_READ_ATTEMPT_LIMIT = 3
export const DIRECT_READ_KEY = 'maliang_direct_read'
/** Rows loaded per run so skipped heads do not hide the rest of the queue. */
export const MALIANG_DIRECT_PREFETCH = 50

export interface DirectReadRecord {
  attempts: number
  attempted_at: string
  last_reason: string
  skipped: boolean
}

export interface DirectReadQueueRow {
  created_at: string
  output: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function readDirectReadRecord(output: unknown): DirectReadRecord | null {
  if (!isRecord(output)) return null
  const raw = output[DIRECT_READ_KEY]
  if (!isRecord(raw)) return null
  const { attempts, attempted_at: attemptedAt, last_reason: lastReason } = raw
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 1) return null
  if (typeof attemptedAt !== 'string' || attemptedAt.length === 0) return null
  if (typeof lastReason !== 'string') return null
  return { attempts, attempted_at: attemptedAt, last_reason: lastReason, skipped: raw.skipped === true }
}

export function directReadNotSkippedFilter(): string {
  const key = `output->${DIRECT_READ_KEY}->>skipped`
  return `${key}.is.null,${key}.neq.true`
}

export function orderDirectReadQueue<T extends DirectReadQueueRow>(rows: readonly T[]): T[] {
  return rows.filter((row) => readDirectReadRecord(row.output)?.skipped !== true).slice().sort(compareDirectReadOrder)
}

function compareDirectReadOrder(a: DirectReadQueueRow, b: DirectReadQueueRow): number {
  const ka = readDirectReadRecord(a.output)?.attempted_at ?? ''
  const kb = readDirectReadRecord(b.output)?.attempted_at ?? ''
  if (ka !== kb) return ka < kb ? -1 : 1
  if (a.created_at === b.created_at) return 0
  return a.created_at < b.created_at ? -1 : 1
}

/** Next stamp after one failed read. Does not write a review verdict. */
export function applyDirectReadFailure(
  output: unknown,
  reason: string,
  now: Date,
): { output: Record<string, unknown>; record: DirectReadRecord } {
  const base = isRecord(output) ? { ...output } : {}
  const prev = readDirectReadRecord(base)
  if (prev?.skipped) return { output: base, record: prev }
  const attempts = (prev?.attempts ?? 0) + 1
  const record: DirectReadRecord = {
    attempts,
    attempted_at: now.toISOString(),
    last_reason: reason.slice(0, 300),
    skipped: attempts >= DIRECT_READ_ATTEMPT_LIMIT,
  }
  return { output: { ...base, [DIRECT_READ_KEY]: record }, record }
}

function hasMaliangCheck(output: unknown): boolean {
  return isRecord(output) && output.maliang_check != null
}

/**
 * Persist one failed read on the order's existing output object.
 * A finished verdict is left alone. Already-stopped orders are not rewritten.
 */
export async function recordDirectReadFailure(
  supabase: SupabaseClient,
  workOrderId: string,
  reason: string,
  now = new Date(),
): Promise<DirectReadRecord | null> {
  const fresh = await supabase.from('content_work_orders').select('status, output').eq('id', workOrderId).maybeSingle()
  if (fresh.error) throw new Error(fresh.error.message.slice(0, 300))
  if (!fresh.data) return null
  const row = fresh.data as { status?: unknown; output?: unknown }
  if (row.status !== 'in_review' || hasMaliangCheck(row.output)) return null
  const prev = readDirectReadRecord(row.output)
  if (prev?.skipped) return prev
  const next = applyDirectReadFailure(row.output, reason, now)
  const updated = await supabase
    .from('content_work_orders')
    .update({ output: next.output, updated_at: now.toISOString() })
    .eq('id', workOrderId)
    .eq('status', 'in_review')
  if (updated.error) throw new Error(updated.error.message.slice(0, 300))
  if (next.record.skipped) {
    console.warn(`[maliang-direct-sweep] stopped retrying ${workOrderId} after ${next.record.attempts} unread attempts: ${next.record.last_reason}`)
  }
  return next.record
}

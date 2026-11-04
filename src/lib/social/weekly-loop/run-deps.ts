import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSocialFactSource } from './fact-aliases'
import { sumWeeklyMaliangSpend } from './maliang-backfill'
import { writeReelSchedule } from './schedule-writer'
import { WEEKLY_LOOP_JOB, type FactCheckWriteOutcome, type WeeklyLoopClient, type WeeklyLoopDeps, type WeeklyLoopOrderRow } from './run'

export const WEEKLY_LOOP_ORDER_CAP = 50

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A client is in the loop only when publishing_calendar_config.weekly_loop.enabled is exactly true. */
export function weeklyLoopEnabled(config: unknown): boolean {
  if (!isRecord(config)) return false
  const weeklyLoop = config.weekly_loop
  if (!isRecord(weeklyLoop)) return false
  return weeklyLoop.enabled === true
}

export function parseOrderRow(row: unknown): WeeklyLoopOrderRow | null {
  if (!isRecord(row)) return null
  const { id, status, created_at, updated_at } = row
  if (
    typeof id !== 'string' ||
    typeof status !== 'string' ||
    typeof created_at !== 'string' ||
    typeof updated_at !== 'string'
  ) {
    return null
  }
  return {
    id,
    status,
    created_at,
    updated_at,
    angle: row.angle ?? null,
    brief: row.brief ?? null,
    output: row.output ?? null,
    review_ref: row.review_ref ?? null,
    published_ref: row.published_ref ?? null,
  }
}

export async function listWeeklyLoopClients(
  db: SupabaseClient,
): Promise<Array<{ id: string; config: unknown }>> {
  const { data, error } = await db
    .from('clients')
    .select('id, publishing_calendar_config')
    .eq('publishing_calendar_config->weekly_loop->>enabled', 'true')
  if (error) throw new Error(`clients_read_failed: ${error.message}`)
  const rows: unknown[] = Array.isArray(data) ? data : []
  const out: Array<{ id: string; config: unknown }> = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = row.id
    if (typeof id !== 'string') continue
    const config = row.publishing_calendar_config ?? null
    if (!weeklyLoopEnabled(config)) continue
    out.push({ id, config })
  }
  return out
}

export async function loadWeeklyLoopClientConfig(
  db: SupabaseClient,
  clientId: string,
): Promise<unknown> {
  const { data, error } = await db
    .from('clients')
    .select('publishing_calendar_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error(`client_read_failed: ${error.message}`)
  if (!isRecord(data)) return null
  return data.publishing_calendar_config ?? null
}

/** 马良 money already spent for this client by the weekly loop since `since` (from the run receipts). Throws when unreadable. */
export async function loadWeeklyMaliangSpend(
  db: SupabaseClient,
  clientId: string,
  since: Date,
): Promise<number> {
  const { data, error } = await db
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', WEEKLY_LOOP_JOB)
    .gte('started_at', since.toISOString())
    .eq('summary->>client_id', clientId)
    .order('started_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`maliang_spend_read_failed: ${error.message}`)
  const rows: unknown[] = Array.isArray(data) ? data : []
  return sumWeeklyMaliangSpend(rows.map((row) => (isRecord(row) ? row.summary : null)))
}

/**
 * Books 马良 money on this run's own log row before the model is called, so a run that dies
 * part-way still counts against the week. Overwritten later by the run's final receipt (same total).
 * Throws when the row is missing or the write fails: the caller must then not call the model.
 */
export async function reserveWeeklyMaliangSpend(
  db: SupabaseClient,
  input: { runId: string; clientId: string; spentUsd: number },
): Promise<void> {
  const { data, error } = await db
    .from('cron_run_logs')
    .update({
      summary: { kind: 'client_run', client_id: input.clientId, maliang_backfill: { spent_usd: input.spentUsd, reserved: true } },
    })
    .eq('id', input.runId)
    .eq('job_name', WEEKLY_LOOP_JOB)
    .eq('status', 'running')
    .select('id')
  if (error) throw new Error(`maliang_spend_reserve_failed: ${error.message}`)
  if (!Array.isArray(data) || data.length !== 1) throw new Error('maliang_spend_reserve_failed: run row not found')
}

export function createWeeklyLoopDbDeps(db: SupabaseClient): WeeklyLoopDeps {
  return {
    async loadClient(clientId: string): Promise<WeeklyLoopClient | null> {
      const { data, error } = await db
        .from('clients')
        .select('id, name, industry, publishing_calendar_config')
        .eq('id', clientId)
        .maybeSingle()
      if (error) throw new Error(`client_read_failed: ${error.message}`)
      if (!isRecord(data)) return null
      const name = typeof data.name === 'string' ? data.name : ''
      const industry = typeof data.industry === 'string' ? data.industry : null
      const config = data.publishing_calendar_config ?? null
      return { id: clientId, name, industry, config } satisfies WeeklyLoopClient
    },

    async loadOrders(
      clientId: string,
    ): Promise<{ rows: WeeklyLoopOrderRow[]; truncated: boolean }> {
      const { data, error } = await db
        .from('content_work_orders')
        .select('id, status, created_at, updated_at, angle, brief, output, review_ref, published_ref')
        .eq('client_id', clientId)
        .in('status', ['approved', 'published', 'in_review'])
        // Already-public reels can never be scheduled; drop them in the query so they do not eat the read cap.
        .or('published_ref->>video_state.is.null,published_ref->>video_state.neq.PUBLISHED')
        .order('created_at', { ascending: false })
        .limit(WEEKLY_LOOP_ORDER_CAP + 1)
      if (error) throw new Error(`orders_read_failed: ${error.message}`)
      const rows: unknown[] = Array.isArray(data) ? data : []
      const truncated = rows.length > WEEKLY_LOOP_ORDER_CAP
      const parsed: WeeklyLoopOrderRow[] = []
      for (const row of rows.slice(0, WEEKLY_LOOP_ORDER_CAP)) {
        const parsedRow = parseOrderRow(row)
        if (parsedRow !== null) parsed.push(parsedRow)
      }
      return { rows: parsed, truncated }
    },

    loadFactSource(clientId: string, today: string) {
      return loadSocialFactSource(db, clientId, today)
    },

    async writeFactCheck(input: {
      clientId: string
      id: string
      readUpdatedAt: string
      output: Record<string, unknown>
    }): Promise<FactCheckWriteOutcome> {
      const { data, error } = await db
        .from('content_work_orders')
        .update({ output: input.output, updated_at: new Date().toISOString() })
        .eq('id', input.id)
        .eq('client_id', input.clientId)
        .eq('updated_at', input.readUpdatedAt)
        .select('id')
      if (error) return 'failed'
      if (Array.isArray(data) && data.length === 1) return 'written'
      return 'conflict'
    },

    writeSchedule(args) {
      return writeReelSchedule(db, args)
    },
  }
}

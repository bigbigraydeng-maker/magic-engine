/**
 * Batch purge for `cron_run_logs` — same rules as `public.cron_run_logs_purge()` in
 * migration 20260907000001, but deletes in chunks so a single statement cannot hit
 * Postgres statement timeout on a large table.
 *
 * ① Noise: completed 7+ days ago, no summary/error/counts, not the latest row per job_name.
 * ② Expired: started_at older than 180 days (hard cap).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const NOISE_RETENTION_DAYS = 7
export const EXPIRED_RETENTION_DAYS = 180
export const PURGE_BATCH_SIZE = 3_000
/** Leave headroom under route `maxDuration` (120s) for abandon + finish. */
export const PURGE_TIME_BUDGET_MS = 95_000

export interface CronRunLogsPurgeResult {
  purged_noise: number
  purged_expired: number
  remaining: number
  oldest_started_at: string | null
  stopped_early?: boolean
  stop_reason?: 'time_budget'
}

interface PurgeOptions {
  now?: Date
  batchSize?: number
  timeBudgetMs?: number
  deadlineMs?: number
}

type CandidateRow = {
  id: string
  job_name: string
  started_at: string
  processed: number | null
  completed_count: number | null
  failed_count: number | null
}

function msDays(days: number): number {
  return days * 24 * 60 * 60 * 1000
}

function isEmptyCounts(row: Pick<CandidateRow, 'processed' | 'completed_count' | 'failed_count'>): boolean {
  return (row.processed ?? 0) === 0 && (row.completed_count ?? 0) === 0 && (row.failed_count ?? 0) === 0
}

function pastDeadline(deadlineMs: number): boolean {
  return Date.now() >= deadlineMs
}

async function latestStartedAtByJob(
  supabase: SupabaseClient,
  jobNames: readonly string[],
): Promise<Map<string, string>> {
  const latest = new Map<string, string>()
  const unique = [...new Set(jobNames)]
  await Promise.all(
    unique.map(async (jobName) => {
      const { data, error } = await supabase
        .from('cron_run_logs')
        .select('started_at')
        .eq('job_name', jobName)
        .order('started_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(error.message)
      const startedAt = (data?.[0] as { started_at: string } | undefined)?.started_at
      if (startedAt) latest.set(jobName, startedAt)
    }),
  )
  return latest
}

function idsEligibleNoise(
  rows: readonly CandidateRow[],
  latestByJob: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = []
  for (const row of rows) {
    if (!isEmptyCounts(row)) continue
    const latest = latestByJob.get(row.job_name)
    if (!latest) continue
    if (Date.parse(row.started_at) < Date.parse(latest)) out.push(row.id)
  }
  return out
}

interface NoiseBatchOutcome {
  deleted: number
  /** When every row in the batch was ineligible, advance the scan past this timestamp. */
  skipPastStartedAt: string | null
}

async function purgeNoiseBatch(
  supabase: SupabaseClient,
  noiseBeforeIso: string,
  batchSize: number,
  scanAfterStartedAt?: string,
): Promise<NoiseBatchOutcome> {
  let query = supabase
    .from('cron_run_logs')
    .select('id, job_name, started_at, processed, completed_count, failed_count')
    .lt('started_at', noiseBeforeIso)
    .eq('status', 'completed')
    .is('summary', null)
    .is('error_message', null)
    .order('started_at', { ascending: true })
    .limit(batchSize)

  if (scanAfterStartedAt) {
    query = query.gt('started_at', scanAfterStartedAt)
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as CandidateRow[]
  if (rows.length === 0) return { deleted: 0, skipPastStartedAt: null }

  const latestByJob = await latestStartedAtByJob(
    supabase,
    rows.map((r) => r.job_name),
  )
  const ids = idsEligibleNoise(rows, latestByJob)
  if (ids.length === 0) {
    return { deleted: 0, skipPastStartedAt: rows[rows.length - 1]!.started_at }
  }

  const { error: delErr } = await supabase.from('cron_run_logs').delete().in('id', ids)
  if (delErr) throw new Error(delErr.message)
  return { deleted: ids.length, skipPastStartedAt: null }
}

async function purgeExpiredBatch(
  supabase: SupabaseClient,
  expiredBeforeIso: string,
  batchSize: number,
): Promise<number> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('id')
    .lt('started_at', expiredBeforeIso)
    .order('started_at', { ascending: true })
    .limit(batchSize)

  if (error) throw new Error(error.message)
  const ids = (data ?? []).map((r) => (r as { id: string }).id)
  if (ids.length === 0) return 0

  const { error: delErr } = await supabase.from('cron_run_logs').delete().in('id', ids)
  if (delErr) throw new Error(delErr.message)
  return ids.length
}

async function readTableFootprint(supabase: SupabaseClient): Promise<{
  remaining: number
  oldest_started_at: string | null
}> {
  const [countRes, oldestRes] = await Promise.all([
    supabase.from('cron_run_logs').select('*', { count: 'exact', head: true }),
    supabase.from('cron_run_logs').select('started_at').order('started_at', { ascending: true }).limit(1),
  ])
  if (countRes.error) throw new Error(countRes.error.message)
  if (oldestRes.error) throw new Error(oldestRes.error.message)
  const oldestRow = (oldestRes.data ?? [])[0] as { started_at: string } | undefined
  return {
    remaining: countRes.count ?? 0,
    oldest_started_at: oldestRow?.started_at ?? null,
  }
}

/**
 * Purge until work is done or `timeBudgetMs` elapses. Hitting the budget is success:
 * caller should surface `stopped_early` + `remaining`, not treat it as failure.
 */
export async function purgeCronRunLogsBatched(
  supabase: SupabaseClient,
  options: PurgeOptions = {},
): Promise<CronRunLogsPurgeResult> {
  const now = options.now ?? new Date()
  const batchSize = options.batchSize ?? PURGE_BATCH_SIZE
  const timeBudgetMs = options.timeBudgetMs ?? PURGE_TIME_BUDGET_MS
  const deadlineMs = options.deadlineMs ?? Date.now() + timeBudgetMs

  const noiseBeforeIso = new Date(now.getTime() - msDays(NOISE_RETENTION_DAYS)).toISOString()
  const expiredBeforeIso = new Date(now.getTime() - msDays(EXPIRED_RETENTION_DAYS)).toISOString()

  let purged_noise = 0
  let purged_expired = 0
  let stopped_early = false

  // ① Noise rows (same order as DB function).
  let noiseScanAfter: string | undefined
  for (;;) {
    if (pastDeadline(deadlineMs)) {
      stopped_early = true
      break
    }
    const batch = await purgeNoiseBatch(supabase, noiseBeforeIso, batchSize, noiseScanAfter)
    if (batch.deleted === 0 && batch.skipPastStartedAt === null) break
    if (batch.deleted === 0 && batch.skipPastStartedAt) {
      noiseScanAfter = batch.skipPastStartedAt
      continue
    }
    purged_noise += batch.deleted
    noiseScanAfter = undefined
  }

  if (!stopped_early) {
    for (;;) {
      if (pastDeadline(deadlineMs)) {
        stopped_early = true
        break
      }
      const n = await purgeExpiredBatch(supabase, expiredBeforeIso, batchSize)
      purged_expired += n
      if (n === 0) break
    }
  }

  const footprint = await readTableFootprint(supabase)
  return {
    purged_noise,
    purged_expired,
    remaining: footprint.remaining,
    oldest_started_at: footprint.oldest_started_at,
    ...(stopped_early ? { stopped_early: true, stop_reason: 'time_budget' as const } : {}),
  }
}
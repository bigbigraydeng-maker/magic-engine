/**
 * 进程在收尾之前被重启时，`cron_run_logs` 会永远停在 `running`。
 * 每天的清理任务把「开跑已经超过预计时长两倍」的这些行收成 `abandoned`。
 *
 * 预计时长见 `expected-duration.ts`。不知道的任务用 2 小时。
 * 状态约束的迁移还没应用时，改写成 `failed` 且 error 以 `abandoned:` 开头，
 * 不能把行留在 running。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { abandonAfterMs } from './expected-duration'

export const ABANDONED_ERROR_PREFIX = 'abandoned:'

/**
 * `cron_run_logs.duration_ms` 是 Postgres integer（4 字节）。
 * 大约 24.8 天的毫秒数就会超过上限，再往这列写会整行失败。
 */
export const CRON_DURATION_MS_MAX = 2_147_483_647

const ABANDONED_MESSAGE =
  `${ABANDONED_ERROR_PREFIX} still running past 2× expected duration (process likely restarted before finish)`

/**
 * 开跑到现在过了多少毫秒，并且能放进 `duration_ms`。
 * 很老的孤儿行差值会超过整数上限；夹到上限后仍能收口，时长记成「至少这么久」。
 */
export function durationMsForRunLog(startedAtIso: string, now: Date): number {
  const started = Date.parse(startedAtIso)
  if (!Number.isFinite(started)) return 0
  const raw = now.getTime() - started
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return raw > CRON_DURATION_MS_MAX ? CRON_DURATION_MS_MAX : Math.trunc(raw)
}

export interface OpenRunRow {
  id: string
  job_name: string
  started_at: string
}

export function isAbandonedMarker(
  status: string | null | undefined,
  errorMessage: string | null | undefined,
): boolean {
  if (status === 'abandoned') return true
  return (errorMessage ?? '').startsWith(ABANDONED_ERROR_PREFIX)
}

/** 还在 running、且开跑早于该任务的放弃线。 */
export function selectAbandonedRuns(rows: readonly OpenRunRow[], now: Date): OpenRunRow[] {
  return rows.filter((row) => {
    const started = Date.parse(row.started_at)
    if (Number.isNaN(started)) return false
    return now.getTime() - started > abandonAfterMs(row.job_name)
  })
}

function isStatusCheckViolation(error: { message?: string; code?: string }): boolean {
  const message = error.message ?? ''
  return error.code === '23514' || message.includes('cron_run_logs_status_check')
}

async function closeOne(
  supabase: SupabaseClient,
  row: OpenRunRow,
  now: Date,
): Promise<string | null> {
  const patch = {
    status: 'abandoned' as const,
    finished_at: now.toISOString(),
    error_message: ABANDONED_MESSAGE,
    duration_ms: durationMsForRunLog(row.started_at, now),
  }
  const first = await supabase.from('cron_run_logs').update(patch).eq('id', row.id).eq('status', 'running')
  if (!first.error) return null
  if (!isStatusCheckViolation(first.error)) return first.error.message

  const retry = await supabase
    .from('cron_run_logs')
    .update({ ...patch, status: 'failed' })
    .eq('id', row.id)
    .eq('status', 'running')
  return retry.error ? retry.error.message : null
}

/**
 * 标掉过期的 running 行。返回改了几行；查询或写入失败时 `error` 有原文，
 * 调用方必须把它写成这次清理自己的失败，不能当成清完了。
 */
export async function abandonStaleRunningRuns(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ abandoned: number; error?: string }> {
  // 已知任务里最短的放弃线是 2 分钟（maxDuration 60s × 2）。更年轻的行一定还在预算内。
  const cutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('id, job_name, started_at')
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .limit(2000)

  if (error) return { abandoned: 0, error: error.message }

  const stale = selectAbandonedRuns((data ?? []) as OpenRunRow[], now)
  let abandoned = 0
  for (const row of stale) {
    const writeError = await closeOne(supabase, row, now)
    if (writeError) return { abandoned, error: writeError }
    abandoned += 1
  }
  return { abandoned }
}

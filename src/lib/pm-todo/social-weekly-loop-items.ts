/**
 * 今日待办里的「社媒每周出稿」栏。
 *
 * 只读 cron_run_logs 里 social-weekly-draft 的回执翻成待办，不自己现算。
 * 只认「写库模式」的客户回执（manual_tasks_delivered = true，或写库模式下整轮跑挂了 status = 'failed'）；演练回执里的待办只给 PM 预览，不进清单。
 * 同一客户只看最新一份写库回执：最新那份没有待办 = 已经好了；最新那份跑挂了 = 出「本周排期没跑完整」，不再显示更早的旧待办。
 *
 * 🔴 本文件一行写库都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import {
  WEEKLY_LOOP_JOB,
  buildRunIncompleteTask,
  type WeeklyLoopManualTask,
} from '@/lib/social/weekly-loop/run'

export const WEEKLY_LOOP_TODO_KIND = 'social_weekly_loop_needs_human' as const
/** Weekly job: look back a little over a week. */
export const WEEKLY_LOOP_TODO_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000

export interface WeeklyLoopRunRow {
  started_at: string
  summary: unknown
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'zero_eligible',
  'all_filtered',
  'fact_source_unreadable',
  'unreviewed_by_maliang',
  'run_incomplete',
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isManualTask(v: unknown): v is WeeklyLoopManualTask {
  if (!isRecord(v)) return false
  if (!isNonEmptyString(v.code) || !KNOWN_CODES.has(v.code)) return false
  if (!isNonEmptyString(v.what)) return false
  if (!isNonEmptyString(v.how)) return false
  if (!isNonEmptyString(v.href)) return false
  return true
}

export function readDeliveredTasks(
  summary: unknown,
): { clientId: string; tasks: WeeklyLoopManualTask[] } | null {
  if (!isRecord(summary)) return null
  if (summary.kind !== 'client_run') return null
  if (summary.mode !== 'write') return null
  if (!isNonEmptyString(summary.client_id)) return null
  const failed = summary.status === 'failed'
  if (summary.manual_tasks_delivered !== true && !failed) return null
  if (!Array.isArray(summary.manual_tasks) && !failed) return null
  const raw: unknown[] = Array.isArray(summary.manual_tasks) ? summary.manual_tasks : []
  const tasks = raw.filter(isManualTask)
  if (failed && !tasks.some((t) => t.code === 'run_incomplete')) {
    const reason = isNonEmptyString(summary.error) ? summary.error : 'failed'
    tasks.push(buildRunIncompleteTask(summary.client_id, [reason]))
  }
  return { clientId: summary.client_id, tasks }
}

export function buildWeeklyLoopTodoItems(
  rows: readonly WeeklyLoopRunRow[],
  nameOf: (id: string) => string,
): ManualItem[] {
  const out: ManualItem[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const delivered = readDeliveredTasks(row.summary)
    if (delivered === null) continue
    if (seen.has(delivered.clientId)) continue
    seen.add(delivered.clientId)
    for (const task of delivered.tasks) {
      out.push({
        kind: WEEKLY_LOOP_TODO_KIND,
        client_id: delivered.clientId,
        client_name: nameOf(delivered.clientId),
        what: task.what,
        how: task.how,
        href: task.href,
      })
    }
  }
  return out
}

export async function pushWeeklyLoopItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date = new Date(),
): Promise<void> {
  let rows: WeeklyLoopRunRow[]
  try {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('started_at, summary')
      .eq('job_name', WEEKLY_LOOP_JOB)
      .gte('started_at', new Date(now.getTime() - WEEKLY_LOOP_TODO_LOOKBACK_MS).toISOString())
      .order('started_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)
    rows = Array.isArray(data) ? (data as WeeklyLoopRunRow[]) : []
  } catch {
    items.push({
      kind: WEEKLY_LOOP_TODO_KIND,
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: '社媒每周出稿的回执今天没读出来，这一栏可能不全。',
      how: '这条不用你动手，是我们这边的欠账。',
      href: 'https://app.inngest.com',
    })
    return
  }
  items.push(...buildWeeklyLoopTodoItems(rows, nameOf))
}

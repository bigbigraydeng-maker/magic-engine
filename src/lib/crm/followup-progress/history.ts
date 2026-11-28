/**
 * Earlier days' numbers for one client, read from the daily snapshot's receipts (`cron_run_logs.summary`, written by
 * `inngest/functions/crm-followup-progress-daily`). Read-only.
 *
 * The job name is repeated here as a literal on purpose: this file is imported by a page, and importing the Inngest
 * function to get one string would pull the whole function into the page bundle. A test pins the two together.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FOLLOWUP_GROUPS, type FollowupGroup, type GroupCounts } from './groups'

export const FOLLOWUP_PROGRESS_JOB_NAME = 'crm-followup-progress-daily'

export interface DayPoint {
  /** When that day's snapshot was taken. */
  at: string
  counts: GroupCounts
}

function isCounts(v: unknown): v is GroupCounts {
  if (typeof v !== 'object' || v === null) return false
  const g = (v as { groups?: unknown }).groups
  if (typeof g !== 'object' || g === null) return false
  return FOLLOWUP_GROUPS.every((k) => typeof (g as Record<string, unknown>)[k] === 'number')
}

/** One client's point out of one run's receipt; null when that run has no usable numbers for the client. */
export function pointFromSummary(summary: unknown, clientId: string): DayPoint | null {
  const results = (summary as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return null
  for (const r of results as Array<Record<string, unknown>>) {
    if (r?.client_id !== clientId || r.ok !== true) continue
    if (typeof r.created_at !== 'string' || !isCounts(r.counts)) return null
    return { at: r.created_at, counts: r.counts }
  }
  return null
}

/** Snapshots of the last `days` days, newest first. Throws on a read error. */
export async function loadHistory(sb: SupabaseClient, clientId: string, now: Date, days = 35): Promise<DayPoint[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const { data, error } = await sb.from('cron_run_logs').select('started_at, summary')
    .eq('job_name', FOLLOWUP_PROGRESS_JOB_NAME).in('status', ['completed', 'partial']).gte('started_at', since)
    .order('started_at', { ascending: false }).limit(days * 3)
  if (error) throw new Error(error.message)
  const out: DayPoint[] = []
  for (const row of (data ?? []) as Array<{ summary: unknown }>) {
    const p = pointFromSummary(row.summary, clientId)
    if (p) out.push(p)
  }
  return out
}

/** The newest snapshot at least `daysAgo` days (minus 6 hours of slack) older than now; null when there is none. */
export function pointDaysAgo(history: readonly DayPoint[], now: Date, daysAgo: number): DayPoint | null {
  const cutoff = now.getTime() - daysAgo * 86_400_000 + 6 * 3_600_000
  for (const p of history) if (Date.parse(p.at) <= cutoff) return p
  return null
}

/** Change in one group since an earlier point; null when there is no earlier point. */
export function delta(now: GroupCounts, then: DayPoint | null, group: FollowupGroup): number | null {
  return then === null ? null : now.groups[group] - then.counts.groups[group]
}

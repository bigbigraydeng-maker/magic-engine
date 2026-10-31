/**
 * Client weekly browsing summary — dispatch / work logic (pure + injected deps).
 *
 * Same two-stage shape as ai-tracker/weekly-fanout.ts: a cheap dispatcher decides WHO
 * gets a report this week, then one worker per client builds it. Nothing here imports
 * a provider client; callers inject them so tests can run without network.
 *
 * 🔴 Roster is an explicit allowlist: a client is only included when
 *    `seo_config.client_weekly_report_enabled` is true. Default = nobody.
 *    Client status is deliberately NOT part of the roster rule — the flag is the
 *    only gate, so a client can be tested before its status is reviewed.
 *
 * 🔴 Fail-closed delivery: the worker can only produce an internal review draft
 *    (see deliver.ts). A report never reaches a client from this pipeline.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isoWeekKey } from '@/lib/flywheel/seo-weekly'
import type { WeeklyReportInput, WeeklySummary } from './build'
import { buildWeeklySummary } from './build'
import type { DraftReceipt } from './deliver'

export { isoWeekKey }

export const CLIENT_WEEKLY_REPORT_DUE_EVENT = 'client-weekly-report/due'

/** NZ Thursday 08:30 — reports land in the inbox the morning before a Friday send. */
export const CLIENT_WEEKLY_REPORT_CRON = '30 8 * * 4'
export const CLIENT_WEEKLY_REPORT_TZ = 'Pacific/Auckland'
export const CLIENT_WEEKLY_REPORT_JOB = 'client-weekly-report'
export const CLIENT_WEEKLY_REPORT_FLAG = 'client_weekly_report_enabled'

export interface WeeklyRosterEntry {
  readonly clientId: string
}

export type WeeklyRosterResult =
  | { readonly ok: true; readonly entries: readonly WeeklyRosterEntry[] }
  | { readonly ok: false; readonly reason: string }

export async function loadWeeklyReportRoster(supabase: SupabaseClient): Promise<WeeklyRosterResult> {
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .contains('seo_config', { [CLIENT_WEEKLY_REPORT_FLAG]: true })
  if (error) return { ok: false, reason: error.message }
  const entries = (data ?? []).flatMap((row): WeeklyRosterEntry[] => {
    const id = (row as { id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? [{ clientId: id }] : []
  })
  return { ok: true, entries }
}

export function weeklyReportEventId(clientId: string, weekKey: string, attempt?: string): string {
  const base = `client-weekly-report-${weekKey}-${clientId}`
  return attempt ? `${base}-${attempt}` : base
}

export interface WeeklyReportDueData {
  readonly client_id: string
  readonly week_key: string
}

export type ParsedWeeklyDue =
  | { readonly ok: true; readonly value: WeeklyReportDueData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

export function parseWeeklyReportDue(raw: unknown): ParsedWeeklyDue {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  if (typeof d.client_id !== 'string' || !UUID_RE.test(d.client_id)) return { ok: false, reason: 'invalid_client_id' }
  if (typeof d.week_key !== 'string' || !WEEK_KEY_RE.test(d.week_key)) return { ok: false, reason: 'invalid_week_key' }
  return { ok: true, value: { client_id: d.client_id, week_key: d.week_key } }
}

export interface WeeklyReportOutcome {
  readonly client_id: string
  readonly week_key: string
  readonly status: 'sent_to_internal_review' | 'no_data' | 'client_not_found' | 'send_failed'
  readonly gsc_read: boolean
  readonly ga4_read: boolean
  readonly leads_read: boolean
  readonly receipt: DraftReceipt | null
  readonly no_client_send: true
}

export interface WeeklyReportDeps {
  gather: (clientId: string) => Promise<WeeklyReportInput | null>
  send: (summary: WeeklySummary, requestId: string) => Promise<DraftReceipt>
}

/**
 * One client's work. A report whose GSC and GA4 reads BOTH failed is not sent: an
 * "everything unreadable" draft would be noise, and the failure must show up as a
 * failed run instead (never a quiet success).
 */
export async function runOneWeeklyReport(
  due: WeeklyReportDueData,
  deps: WeeklyReportDeps,
): Promise<WeeklyReportOutcome> {
  const base = { client_id: due.client_id, week_key: due.week_key, no_client_send: true as const }
  const input = await deps.gather(due.client_id)
  if (!input) {
    return { ...base, status: 'client_not_found', gsc_read: false, ga4_read: false, leads_read: false, receipt: null }
  }
  const reads = { gsc_read: input.gsc !== null, ga4_read: input.ga4 !== null, leads_read: input.leadsInWindow !== null }
  if (!reads.gsc_read && !reads.ga4_read) {
    return { ...base, status: 'no_data', ...reads, receipt: null }
  }
  const receipt = await deps.send(buildWeeklySummary(input), `${due.week_key}-${due.client_id}`)
  return {
    ...base,
    status: receipt.status === 'sent_to_internal_review' ? 'sent_to_internal_review' : 'send_failed',
    ...reads,
    receipt,
  }
}

/**
 * CRM — the weekly follow-up report.
 *
 * Every Monday morning, for each client on the recipient table: read the guest book (`crm/followup-progress/load`),
 * compare with the snapshot of a week ago (`history`), list who to ring first, and send one email.
 *
 * ## Who gets it — an authorisation gate
 *
 * 1. Recipients come only from the literal table `WEEKLY_REPORT_RECIPIENTS` in this file (client id → mailboxes).
 *    Not an environment variable, not a default address: the report names guests, so a wrong address is a leak,
 *    and adding one must go through code review. A client not on the table is read and receipted, never mailed.
 *    CTS → hello@magicengine.cloud only: PM 2026-11-28 "先只发 hello@". Sending to the client's own team is a
 *    separate decision by the PM, made after reading a few editions.
 * 2. Brake: `FOLLOWUP_WEEKLY_REPORT_PAUSED=true` reads and receipts, sends nothing.
 *
 * ## Why Inngest
 *
 * One read step and one send step per client. A send that succeeded is memoised, so a retry cannot send a second
 * copy; the mail service also dedupes on the idempotency key (job + client + week).
 *
 * ## Seen when it dies
 *
 * One `cron_run_logs` row per run (`job_name = crm-followup-weekly-report`), the whole receipt in `summary`;
 * `onFailure` closes a row left "running". Registered in `cron/registry`.
 *
 * The receipt holds counts and recipients. No guest name, email or phone.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { localDayStartMs } from '@/lib/crm/day-list'
import { dayLabel } from '@/lib/crm/enquiry-daily-render'
import { loadFollowupProgress } from '@/lib/crm/followup-progress/load'
import { loadHistory } from '@/lib/crm/followup-progress/history'
import { buildWeeklyReport, listedContactIds, type WeeklyReport } from '@/lib/crm/followup-progress/weekly-report'
import { countAiReady, loadContactNames } from '@/lib/crm/followup-progress/weekly-report-load'
import { sendWeeklyFollowupReport } from '@/lib/crm/followup-progress/weekly-report-send'

export const WEEKLY_REPORT_JOB = 'crm-followup-weekly-report'
export const WEEKLY_REPORT_TZ = 'Pacific/Auckland'
/** Mondays 08:00, after the 06:30 daily snapshot. */
export const WEEKLY_REPORT_CRON = '0 8 * * 1'

/** CTS Tours NZ. */
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

/** The authorisation table. Literal on purpose — see gate 1 in the file header. */
export const WEEKLY_REPORT_RECIPIENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [CTS_CLIENT_ID]: Object.freeze(['hello@magicengine.cloud']),
})

export const PAUSED_REASON = '已暂停（FOLLOWUP_WEEKLY_REPORT_PAUSED=true）'

export type WeeklyReportEnv = Record<string, string | undefined>

export function weeklyReportPaused(env: WeeklyReportEnv): boolean {
  return env.FOLLOWUP_WEEKLY_REPORT_PAUSED === 'true'
}

/** One client's receipt for one week. No guest in it. */
export interface WeeklyClientReceipt {
  readonly client_id: string
  readonly client_name: string | null
  readonly day: string
  readonly in_scope: number
  readonly new_leads: number
  readonly awaiting_reply: number
  readonly ai_ready: number | null
  readonly sent: boolean
  readonly reason?: string
  readonly recipients: string[]
  readonly provider_message_id?: string
  /** true = nothing left the building for this client (paused / not sent). */
  readonly no_publish: boolean
  readonly created_at: string
}

export interface WeeklyReportReceipt {
  readonly job: string
  readonly paused: boolean
  readonly clients_scanned: number
  readonly emails_sent: number
  readonly results: WeeklyClientReceipt[]
}

export interface WeeklyReportDeps {
  supabase: SupabaseClient
  loadClientName(sb: SupabaseClient, clientId: string): Promise<string | null>
  loadProgress: typeof loadFollowupProgress
  loadHistory: typeof loadHistory
  loadNames: typeof loadContactNames
  countAiReady: typeof countAiReady
  send: typeof sendWeeklyFollowupReport
  env?: WeeklyReportEnv
}

/** The smallest shape of `step.run`, so tests can pass a fake. */
export interface WeeklyReportStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

async function readClientName(sb: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await sb.from('clients').select('name').eq('id', clientId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { name?: string | null } | null)?.name ?? null
}

/** Everything one client's report needs. The AI count failing does not lose the report: it is left out. */
async function buildFor(deps: WeeklyReportDeps, clientId: string, day: string, now: Date): Promise<WeeklyReport> {
  const [clientName, detail, history] = await Promise.all([
    deps.loadClientName(deps.supabase, clientId),
    deps.loadProgress(deps.supabase, clientId, now),
    deps.loadHistory(deps.supabase, clientId, now),
  ])
  const names = await deps.loadNames(deps.supabase, clientId, listedContactIds(detail))
  const aiReady = await deps.countAiReady(deps.supabase, clientId, now, deps.env ?? process.env).catch(() => null)
  return buildWeeklyReport({ clientName: clientName ?? 'This client', day, detail, history, names, aiReady, now })
}

/** One client: read (a retried step), then send (a memoised step). Never throws. */
async function runForClient(step: WeeklyReportStep, deps: WeeklyReportDeps, clientId: string, paused: boolean, now: Date): Promise<WeeklyClientReceipt> {
  const dayStartMs = localDayStartMs(now, WEEKLY_REPORT_TZ)
  const day = dayLabel(dayStartMs, WEEKLY_REPORT_TZ)
  const recipients = [...(WEEKLY_REPORT_RECIPIENTS[clientId] ?? [])]
  const base = { client_id: clientId, day, recipients, no_publish: true, created_at: now.toISOString() }
  const empty = { client_name: null, in_scope: 0, new_leads: 0, awaiting_reply: 0, ai_ready: null }
  let report: WeeklyReport
  try {
    report = await step.run(`read-${clientId}`, () => buildFor(deps, clientId, day, now))
  } catch (err) {
    return { ...base, ...empty, sent: false, reason: errText(err, '取数时出现未知错误') }
  }
  const counts = {
    client_name: report.clientName,
    in_scope: report.counts.inScope,
    new_leads: report.newLeads.total,
    awaiting_reply: report.awaitingReply.total,
    ai_ready: report.aiReady,
  }
  if (paused) return { ...base, ...counts, sent: false, reason: PAUSED_REASON }
  return step.run(`send-${clientId}`, async () => {
    const r = await deps.send({
      report,
      timeZone: WEEKLY_REPORT_TZ,
      recipients,
      idempotencyKey: `${WEEKLY_REPORT_JOB}:${clientId}:${new Date(dayStartMs).toISOString()}`,
    })
    return {
      ...base,
      ...counts,
      sent: r.sent,
      no_publish: !r.sent,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.messageId ? { provider_message_id: r.messageId } : {}),
      recipients: r.recipients,
    }
  })
}

/** The run itself, apart from the Inngest wiring, so tests call it directly. */
export async function runFollowupWeeklyReport(step: WeeklyReportStep, deps: WeeklyReportDeps, now: Date = new Date()): Promise<WeeklyReportReceipt> {
  const paused = weeklyReportPaused(deps.env ?? process.env)
  const started = await step.run('log-start', async () => ({ runId: await startCronRunId(WEEKLY_REPORT_JOB), startedAt: Date.now() }))
  const run = cronRunHandle(WEEKLY_REPORT_JOB, started.runId, started.startedAt)
  const clientIds = Object.keys(WEEKLY_REPORT_RECIPIENTS).sort()
  const results: WeeklyClientReceipt[] = []
  for (const clientId of clientIds) results.push(await runForClient(step, deps, clientId, paused, now))
  const receipt: WeeklyReportReceipt = {
    job: WEEKLY_REPORT_JOB,
    paused,
    clients_scanned: clientIds.length,
    emails_sent: results.filter((r) => r.sent).length,
    results,
  }
  await step.run('log-finish', async () => {
    await run.finish({
      processed: receipt.clients_scanned,
      completed: receipt.emails_sent,
      // Paused is an expected "not sent"; anything else not sent is a failure.
      failed: results.filter((r) => !r.sent && r.reason !== PAUSED_REASON).length,
      summary: { ...receipt },
    })
    return null
  })
  return receipt
}

/** Dependency-injected build, for tests. */
export function createFollowupWeeklyReportFunction(deps: WeeklyReportDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}${WEEKLY_REPORT_JOB}`,
      name: 'CRM — 每周跟进报告（上周动静、本周先打谁）',
      // Safe to retry: `send-<clientId>` is memoised once it succeeds, and the mail service dedupes on the key.
      retries: 2,
      concurrency: { limit: 1 },
      onFailure: async ({ event, error }) => {
        const message = error?.message
          || (event.data as { error?: { message?: string } } | undefined)?.error?.message
          || '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(WEEKLY_REPORT_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
      },
    },
    // TZ= is required: without it Inngest reads the cron in UTC and it drifts at daylight saving.
    { cron: `TZ=${WEEKLY_REPORT_TZ} ${WEEKLY_REPORT_CRON}` },
    async ({ step }): Promise<WeeklyReportReceipt> => {
      const nowIso = await step.run('clock', async () => new Date().toISOString())
      return runFollowupWeeklyReport(
        { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> },
        deps,
        new Date(nowIso),
      )
    },
  )
}

/** Production instance. */
export const crmFollowupWeeklyReport = createFollowupWeeklyReportFunction({
  supabase: supabaseAdmin,
  loadClientName: readClientName,
  loadProgress: loadFollowupProgress,
  loadHistory,
  loadNames: loadContactNames,
  countAiReady,
  send: sendWeeklyFollowupReport,
})

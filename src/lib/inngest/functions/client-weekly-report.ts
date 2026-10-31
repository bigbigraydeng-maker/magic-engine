/**
 * Magic Engine 2.0 · Inngest cloud consumer: client weekly browsing summary.
 *
 * Two functions (shape copied from ai-visibility-weekly.ts):
 *   · `cloud-client-weekly-report-fanout` — weekly cron; finds clients with
 *     `seo_config.client_weekly_report_enabled = true` and sends one event each.
 *     Calls no provider and spends no money.
 *   · `cloud-client-weekly-report-run-one` — one client: read GSC/GA4/leads, build the
 *     Chinese summary, send it to the INTERNAL inbox as a review draft.
 *
 * 🔴 No client send exists in this pipeline. Sending to a client needs a separate,
 *    explicitly authorised step that has not been built.
 * 🔴 Receipts: every run writes a cron_run_logs row (job `client-weekly-report`) with
 *    client_id, week_key, per-source read status, send status and no_client_send=true.
 * 🔴 Duplicate triggers can only produce another internal draft (free, no client
 *    impact), so there is no extra "already sent" gate beyond the event id.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { gatherWeeklyReportInput } from '@/lib/client-weekly-report/gather'
import { sendWeeklyReportDraftToInternalReview } from '@/lib/client-weekly-report/deliver'
import {
  CLIENT_WEEKLY_REPORT_CRON,
  CLIENT_WEEKLY_REPORT_DUE_EVENT,
  CLIENT_WEEKLY_REPORT_JOB,
  CLIENT_WEEKLY_REPORT_TZ,
  isoWeekKey,
  loadWeeklyReportRoster,
  parseWeeklyReportDue,
  runOneWeeklyReport,
  weeklyReportEventId,
  type WeeklyReportDeps,
  type WeeklyRosterEntry,
} from '@/lib/client-weekly-report/fanout'

export interface WeeklyReportFanOutReceipt {
  readonly job: string
  readonly week_key: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly no_client_send: true
  readonly error: string | null
  readonly created_at: string
}

export function buildWeeklyReportEvents(
  entries: readonly WeeklyRosterEntry[],
  weekKey: string,
  attempt?: string,
): Array<{ id: string; name: string; data: { client_id: string; week_key: string } }> {
  return entries.map((e) => ({
    id: weeklyReportEventId(e.clientId, weekKey, attempt),
    name: CLIENT_WEEKLY_REPORT_DUE_EVENT,
    data: { client_id: e.clientId, week_key: weekKey },
  }))
}

export function createWeeklyReportFanOutFunction(deps: {
  loadRoster: typeof loadWeeklyReportRoster
  supabase: typeof supabaseAdmin
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}client-weekly-report-fanout`,
      name: 'Client weekly report: dispatch one job per enabled client',
      concurrency: { limit: 1 },
      retries: 2,
    },
    { cron: `TZ=${CLIENT_WEEKLY_REPORT_TZ} ${CLIENT_WEEKLY_REPORT_CRON}` },
    async ({ step }): Promise<WeeklyReportFanOutReceipt> => {
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(CLIENT_WEEKLY_REPORT_JOB),
        startedAt: Date.now(),
        weekKey: isoWeekKey(new Date()),
        createdAt: new Date().toISOString(),
      }))
      const run = cronRunHandle(CLIENT_WEEKLY_REPORT_JOB, started.runId, started.startedAt)
      const base = {
        job: CLIENT_WEEKLY_REPORT_JOB,
        week_key: started.weekKey,
        no_client_send: true as const,
        created_at: started.createdAt,
      }

      const roster = await step.run('load-roster', async () => deps.loadRoster(deps.supabase))
      if (!roster.ok) {
        await step.run('log-finish-roster-failed', async () => {
          await run.finish({ failed: 1, error: roster.reason })
          return null
        })
        return { ...base, status: 'roster_failed', clients_dispatched: 0, error: roster.reason }
      }

      const events = buildWeeklyReportEvents(roster.entries, started.weekKey)
      if (events.length === 0) {
        await step.run('log-finish-empty', async () => {
          await run.finish({ processed: 0, completed: 0, failed: 0, summary: { week_key: started.weekKey } })
          return null
        })
        return { ...base, status: 'roster_empty', clients_dispatched: 0, error: null }
      }

      await step.sendEvent('dispatch-weekly-reports', events)
      await step.run('log-finish-dispatched', async () => {
        await run.finish({
          processed: events.length,
          completed: events.length,
          failed: 0,
          summary: { week_key: started.weekKey, counts_are: 'dispatched_not_built', clients_dispatched: events.length },
        })
        return null
      })
      return { ...base, status: 'dispatched', clients_dispatched: events.length, error: null }
    },
  )
}

export function createWeeklyReportRunOneFunction(deps: WeeklyReportDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}client-weekly-report-run-one`,
      name: 'Client weekly report: build and send one internal review draft',
      concurrency: { limit: 1, key: 'event.data.client_id' },
      retries: 0,
    },
    { event: CLIENT_WEEKLY_REPORT_DUE_EVENT },
    async ({ event, step }) => {
      const parsed = parseWeeklyReportDue(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const due = parsed.value
      const started = await step.run(`report-log-start-${due.week_key}-${due.client_id}`, async () => ({
        runId: await startCronRunId(CLIENT_WEEKLY_REPORT_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(CLIENT_WEEKLY_REPORT_JOB, started.runId, started.startedAt)
      const result = await step.run(`report-${due.week_key}-${due.client_id}`, async () => runOneWeeklyReport(due, deps))
      await step.run(`report-log-finish-${due.week_key}-${due.client_id}`, async () => {
        const ok = result.status === 'sent_to_internal_review'
        await run.finish({
          processed: 1,
          completed: ok ? 1 : 0,
          failed: ok ? 0 : 1,
          summary: {
            client_id: result.client_id,
            week_key: result.week_key,
            status: result.status,
            gsc_read: result.gsc_read,
            ga4_read: result.ga4_read,
            leads_read: result.leads_read,
            request_id: result.receipt?.requestId ?? null,
            no_client_send: true,
          },
          error: ok ? undefined : `weekly_report_${result.status}`,
        })
        return null
      })
      return result
    },
  )
}

export const clientWeeklyReportFanOut = createWeeklyReportFanOutFunction({
  loadRoster: loadWeeklyReportRoster,
  supabase: supabaseAdmin,
})

export const clientWeeklyReportRunOne = createWeeklyReportRunOneFunction({
  gather: (clientId) => gatherWeeklyReportInput(clientId),
  send: (summary, requestId) => sendWeeklyReportDraftToInternalReview(summary, requestId),
})

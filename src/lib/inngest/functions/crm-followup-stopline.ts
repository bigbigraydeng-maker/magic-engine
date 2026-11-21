/**
 * Inngest: catalogue follow-up stop line, every morning before today's to-do mail.
 *
 * Takes "AI 跟进中" off guests who booked, must not be contacted, reached a stopping stage, came back, or talked with
 * a staff member (lib/crm/ai-takeover/stop-line.ts). The only write is the takeover event log and its mirror column;
 * no email, no stage change. Receipt → cron_run_logs + event STOPLINE_EVENT.
 *
 * Switch: env CRM_FOLLOWUP_STOPLINE = 'off' (do nothing) | 'dry_run' (decide, write nothing) | anything else = live.
 * Manual run: send STOPLINE_EVENT_DUE with data { dryRun: true } to decide without writing.
 * 🔴 After deploying a new function, Sync `/api/inngest` in the Inngest dashboard once, or it silently never runs.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import {
  STOPLINE_EVENT,
  STOPLINE_EVENT_DUE,
  STOPLINE_JOB,
  runStopline,
  type StoplineReceipt,
} from '@/lib/crm/ai-takeover/stop-line-run'

/** NZ 07:30, before today's to-do mail (08:00), so a guest taken back today is not listed as "nobody is following". */
export const STOPLINE_CRON = '30 7 * * *'
export const STOPLINE_TZ = 'Pacific/Auckland'

export function stoplineMode(env: Record<string, string | undefined>, requestedDryRun: boolean): 'off' | 'dry_run' | 'live' {
  const v = (env.CRM_FOLLOWUP_STOPLINE ?? '').trim().toLowerCase()
  if (v === 'off') return 'off'
  if (v === 'dry_run' || requestedDryRun) return 'dry_run'
  return 'live'
}

export const crmFollowupStopline = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}crm-followup-stopline`,
    name: 'CRM catalogue follow-up: take AI takeover off guests who are back with staff',
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const message = error?.message || '未知错误'
      const ts = (event as { ts?: number }).ts
      await failOpenCronRuns(STOPLINE_JOB, `重试耗尽后仍失败：${message}`, { startedBefore: new Date(typeof ts === 'number' ? ts : Date.now()) })
    },
  },
  [{ cron: `TZ=${STOPLINE_TZ} ${STOPLINE_CRON}` }, { event: STOPLINE_EVENT_DUE }],
  async ({ event, step }): Promise<StoplineReceipt | { skipped: 'off' }> => {
    const requested = (event?.data as { dryRun?: unknown } | undefined)?.dryRun === true
    const mode = stoplineMode(process.env, requested)
    if (mode === 'off') return { skipped: 'off' }

    const started = await step.run('start-run', async () => ({ runId: await startCronRunId(STOPLINE_JOB), startedAt: Date.now() }))
    const receipt = await step.run('check-and-stop', () => runStopline(supabaseAdmin, { dryRun: mode === 'dry_run' }))
    await step.run('emit-receipt', async () => {
      await inngest.send({ id: receipt.request_id, name: STOPLINE_EVENT, data: receipt })
    })
    await step.run('finish-run', async () => {
      // Counted in guests. A client that could not be read has no guest count; it is named in `error`,
      // which makes the run log partial instead of a silent "completed".
      const guests = receipt.clients.reduce((n, c) => n + c.in_takeover, 0)
      const failed = receipt.clients.reduce((n, c) => n + c.stopped.filter((s) => s.write === 'failed').length, 0)
      const unreadable = receipt.clients.filter((c) => c.error !== null).map((c) => `${c.client_id}: ${c.error}`)
      await cronRunHandle(STOPLINE_JOB, started.runId, started.startedAt).finish({
        processed: guests,
        completed: guests - failed,
        failed: failed + unreadable.length,
        summary: { ...receipt },
        ...(receipt.error || unreadable.length > 0 ? { error: [receipt.error, ...unreadable].filter(Boolean).join('; ') } : {}),
      })
    })
    return receipt
  },
)

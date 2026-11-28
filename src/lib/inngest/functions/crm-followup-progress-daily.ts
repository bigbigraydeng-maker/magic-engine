/**
 * CRM — the daily follow-up progress snapshot.
 *
 * Every morning, for each client that is taking enquiries: sort the whole guest book into follow-up groups
 * (`crm/followup-progress/groups.ts`), count what happened in the last 7 days, and keep the numbers as that day's
 * receipt. The page "跟进进度" reads these receipts to show how each group moved since yesterday and last week.
 *
 * ## What it does not do
 *
 * It sends nothing and changes no guest. Every receipt carries `no_publish: true`. Reports to a client's team and
 * routing guests into lists are later steps, each behind its own approval.
 *
 * ## Why Inngest
 *
 * One step per client, so one client's failed read does not lose the others, and a retry does not redo finished
 * clients. The clock is a step too: a retry past midnight still belongs to the day it started.
 *
 * ## Seen when it dies
 *
 * One `cron_run_logs` row per run (`job_name = crm-followup-progress-daily`) with the whole receipt in `summary`;
 * `onFailure` closes a row left "running". Registered in `cron/registry`.
 *
 * The receipt holds counts only: no guest name, email or phone.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { loadActiveEnquiryClients, type DigestClient } from '@/lib/crm/enquiry-daily-load'
import { loadFollowupProgress, type WeekActivity } from '@/lib/crm/followup-progress/load'
import type { GroupCounts } from '@/lib/crm/followup-progress/groups'

export const FOLLOWUP_PROGRESS_JOB = 'crm-followup-progress-daily'
export const FOLLOWUP_PROGRESS_TZ = 'Pacific/Auckland'
/** 06:30, before the morning digests and before staff start. */
export const FOLLOWUP_PROGRESS_CRON = '30 6 * * *'

/** One client's numbers for one day. Counts only. */
export interface FollowupClientReceipt {
  readonly client_id: string
  readonly client_name: string | null
  readonly ok: boolean
  readonly counts?: GroupCounts
  readonly week?: WeekActivity
  readonly reason?: string
  /** Always true: this job sends nothing. */
  readonly no_publish: true
  readonly created_at: string
}

export interface FollowupProgressReceipt {
  readonly job: string
  readonly clients_scanned: number
  readonly clients_ok: number
  readonly results: FollowupClientReceipt[]
}

export interface FollowupProgressDeps {
  supabase: SupabaseClient
  loadClients: typeof loadActiveEnquiryClients
  loadProgress: typeof loadFollowupProgress
}

/** The smallest shape of `step.run`, so tests can pass a fake. */
export interface FollowupProgressStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

/** One client's snapshot. Never throws: a failed read is a receipt with the reason. */
async function snapshotClient(deps: FollowupProgressDeps, client: DigestClient, now: Date): Promise<FollowupClientReceipt> {
  const base = { client_id: client.id, client_name: client.name, no_publish: true as const, created_at: now.toISOString() }
  try {
    const p = await deps.loadProgress(deps.supabase, client.id, now)
    return { ...base, ok: true, counts: p.counts, week: p.week }
  } catch (err) {
    return { ...base, ok: false, reason: errText(err, '取数时出现未知错误') }
  }
}

/** The run itself, apart from the Inngest wiring, so tests call it directly. */
export async function runFollowupProgressDaily(
  step: FollowupProgressStep,
  deps: FollowupProgressDeps,
  now: Date = new Date(),
): Promise<FollowupProgressReceipt> {
  const started = await step.run('log-start', async () => ({
    runId: await startCronRunId(FOLLOWUP_PROGRESS_JOB),
    startedAt: Date.now(),
  }))
  const run = cronRunHandle(FOLLOWUP_PROGRESS_JOB, started.runId, started.startedAt)

  let clients: DigestClient[]
  try {
    clients = await step.run('load-clients', () => deps.loadClients(deps.supabase, now))
  } catch (err) {
    const message = errText(err, '读客户清单失败')
    await step.run('log-finish-failed', async () => {
      await run.finish({ error: `[${FOLLOWUP_PROGRESS_JOB}] ${message}` })
      return null
    })
    throw new Error(`[${FOLLOWUP_PROGRESS_JOB}] 读客户清单失败: ${message}`)
  }

  const results: FollowupClientReceipt[] = []
  for (const client of clients) results.push(await step.run(`snapshot-${client.id}`, () => snapshotClient(deps, client, now)))

  const receipt: FollowupProgressReceipt = {
    job: FOLLOWUP_PROGRESS_JOB,
    clients_scanned: clients.length,
    clients_ok: results.filter((r) => r.ok).length,
    results,
  }
  await step.run('log-finish', async () => {
    await run.finish({
      processed: receipt.clients_scanned,
      completed: receipt.clients_ok,
      failed: receipt.clients_scanned - receipt.clients_ok,
      summary: { ...receipt },
    })
    return null
  })
  return receipt
}

/** Dependency-injected build, for tests. */
export function createFollowupProgressDailyFunction(deps: FollowupProgressDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}${FOLLOWUP_PROGRESS_JOB}`,
      name: 'CRM — 每日跟进进度（客人分组快照，不外发）',
      retries: 2,
      concurrency: { limit: 1 },
      onFailure: async ({ event, error }) => {
        const message = error?.message
          || (event.data as { error?: { message?: string } } | undefined)?.error?.message
          || '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(FOLLOWUP_PROGRESS_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
      },
    },
    // TZ= is required: without it Inngest reads the cron in UTC and it drifts at daylight saving.
    { cron: `TZ=${FOLLOWUP_PROGRESS_TZ} ${FOLLOWUP_PROGRESS_CRON}` },
    async ({ step }): Promise<FollowupProgressReceipt> => {
      const nowIso = await step.run('clock', async () => new Date().toISOString())
      return runFollowupProgressDaily(
        { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> },
        deps,
        new Date(nowIso),
      )
    },
  )
}

/** Production instance. */
export const crmFollowupProgressDaily = createFollowupProgressDailyFunction({
  supabase: supabaseAdmin,
  loadClients: loadActiveEnquiryClients,
  loadProgress: loadFollowupProgress,
})

/**
 * Magic Engine 2.0 · the daily check over letters ME sent itself (`cloud-triggered-send-reconcile`).
 *
 * Every day at 07:30 Pacific/Auckland, before the welcome sweep (09:00):
 *   1. overdue pending letters (handed over more than 20 hours ago, outcome never written) → `unknown_outcome`, so a
 *      person is asked "did it go?" — whatever the authorization and switches say (`reconcile.ts`);
 *   2. our own breaker: bounces / complaints / refusals beyond the stop lines the PM approved (each authorization's own
 *      `send.health_breaker`, counted from when it was switched on) revoke that authorization as the system
 *      (`system:HEALTH_BREAKER` / `system:PROVIDER_FAILURE`), so the next letter does not go.
 *
 * 🔴 **Never sends anything** and never reads an address. The only writes are the guarded status move and the revoke.
 * 🔴 **Half a read trips nothing**: a failed or full ledger read is logged as an error, no letter moves, nothing is revoked.
 * 🔴 **Run log** under 'triggered-send-reconcile', id derived from the Inngest run id, closed by onFailure.
 * Every side effect is inside a step (Inngest replays the body after each step boundary).
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, cronRunIdFromInngestRun, startCronRunWithId, type CronRunFinishOpts } from '@/lib/cron/run-logger'
import { expireOverdue, loadReconcileRows, runBreaker, type BreakerResult, type ExpireResult, type RowsRead } from '@/lib/messaging/triggered-send/reconcile-prod'
import { handleTriggeredSendFailure } from './triggered-send-welcome-sweep'

export const TRIGGERED_SEND_RECONCILE_JOB = 'triggered-send-reconcile'
export const TRIGGERED_SEND_RECONCILE_ID = `${CLOUD_FN_PREFIX}triggered-send-reconcile`
/** 07:30 local time, before the 09:00 welcome sweep. This is the schedule the cron registry watches. */
export const TRIGGERED_SEND_RECONCILE_CRON = '30 7 * * *'
export const TRIGGERED_SEND_RECONCILE_TZ = 'Pacific/Auckland'

export interface ReconcileStepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

export interface ReconcileDeps {
  startRun(runLogId: string): Promise<void>
  finishRun(runLogId: string, startedAtMs: number, opts: CronRunFinishOpts): Promise<void>
  loadRows(now: Date): Promise<RowsRead>
  expire(rows: RowsRead & { ok: true }, now: Date): Promise<ExpireResult>
  breaker(rows: RowsRead & { ok: true }, now: Date): Promise<BreakerResult[]>
  now(): Date
}

export interface ReconcileReceipt {
  job: string
  status: 'done' | 'read_failed'
  expired: number
  moved: number
  tripped: Array<{ clientId: string; trigger: string; code: string; revoked: boolean }>
  no_send: true
  errors: string[]
}

function tripsOf(results: readonly BreakerResult[]): ReconcileReceipt['tripped'] {
  return results.flatMap((r) => (r.verdict.trip ? [{ clientId: r.clientId, trigger: r.triggerKey, code: r.verdict.code, revoked: r.revoked }] : []))
}

/** One daily check. Exported for tests; the Inngest function below only wires production pieces into it. */
export async function runReconcile(step: ReconcileStepTools, deps: ReconcileDeps, runId: string): Promise<ReconcileReceipt> {
  const started = await step.run('log-start', async () => {
    const runLogId = cronRunIdFromInngestRun(runId)
    await deps.startRun(runLogId)
    const now = deps.now()
    return { runLogId, startedAtMs: now.getTime(), nowIso: now.toISOString() }
  })
  const now = new Date(started.nowIso)
  const work = await step.run('reconcile', async (): Promise<ReconcileReceipt> => {
    const rows = await deps.loadRows(now)
    if (!rows.ok) return { job: TRIGGERED_SEND_RECONCILE_JOB, status: 'read_failed', expired: 0, moved: 0, tripped: [], no_send: true, errors: [rows.error] }
    const expired = await deps.expire(rows, now)
    const breaker = await deps.breaker(rows, now)
    return {
      job: TRIGGERED_SEND_RECONCILE_JOB,
      status: 'done',
      expired: expired.expired.length,
      moved: expired.moved.length,
      tripped: tripsOf(breaker),
      no_send: true,
      errors: [...expired.errors, ...breaker.flatMap((b) => b.errors.map((e) => `${b.clientId} ${e}`))],
    }
  })
  await step.run('log-finish', async () => {
    await deps.finishRun(started.runLogId, started.startedAtMs, {
      processed: work.expired + work.moved,
      completed: work.expired,
      failed: work.errors.length,
      error: work.errors.length > 0 ? work.errors.join('; ').slice(0, 1000) : undefined,
      summary: { status: work.status, expired: work.expired, moved: work.moved, tripped: work.tripped, no_send: true },
    })
    return null
  })
  return work
}

export const triggeredSendReconcile = inngest.createFunction(
  {
    id: TRIGGERED_SEND_RECONCILE_ID,
    name: 'Triggered send: daily check (overdue letters, our own breaker)',
    concurrency: [{ limit: 1 }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
      await handleTriggeredSendFailure({
        job: TRIGGERED_SEND_RECONCILE_JOB,
        runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
        message: error?.message || 'unknown error',
        failedAt,
      })
    },
  },
  { cron: `TZ=${TRIGGERED_SEND_RECONCILE_TZ} ${TRIGGERED_SEND_RECONCILE_CRON}` },
  async ({ step, runId }): Promise<ReconcileReceipt> =>
    runReconcile(
      // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
      { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> },
      {
        startRun: (id) => startCronRunWithId(TRIGGERED_SEND_RECONCILE_JOB, id),
        finishRun: (id, startedAtMs, opts) => cronRunHandle(TRIGGERED_SEND_RECONCILE_JOB, id, startedAtMs).finish(opts),
        loadRows: (now) => loadReconcileRows(supabaseAdmin, now),
        expire: (rows, now) => expireOverdue(supabaseAdmin, rows.rows, now),
        breaker: (rows, now) => runBreaker(supabaseAdmin, rows.rows, now),
        now: () => new Date(),
      },
      runId,
    ),
)

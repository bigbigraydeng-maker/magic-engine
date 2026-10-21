/**
 * Hourly read-only Meta sampling for the ad heartbeat (design: docs/specs/.../ad-heartbeat).
 *
 * 只读：本函数不发布、不修改广告，只读取 Meta 数据并（在 live 模式下）写入告警行。
 * Read-only: this function never publishes or mutates ads. It only reads Meta data and,
 * in `live` mode, writes alarm rows to `ad_heartbeat_alarms`.
 *
 * Runs at minute 5 of every hour, New Zealand time. The snapshot cron runs on a UTC-based
 * schedule at :30, so :05 NZ leaves a comfortable margin between the two.
 *
 * Defaults are deliberately inert:
 *   - AD_HEARTBEAT_MODE defaults to 'dry' (no alarm writes).
 *   - AD_HEARTBEAT_CLIENT_IDS defaults to empty → NO clients are sampled.
 *   - AD_HEARTBEAT_MODE=live is what actually writes alarm rows.
 *
 * Ops notes:
 *   - Render env changes require a manual redeploy to take effect.
 *   - New Inngest functions require a Sync in the Inngest dashboard before they run.
 *
 * `retries: 0` on purpose: a sweep reads Meta and writes alarm state; a blind retry of a
 * half-finished sweep is not worth the risk. The next hourly run re-evaluates from scratch.
 * `concurrency: 1`: two sweeps must never overlap.
 *
 * Each side-effecting phase is its own `step.run` (Inngest replays the function body after
 * every step boundary, so anything outside a step would run again).
 */
import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { createSupabaseStore } from '@/lib/ads-strategy/heartbeat/store'
import { readHeartbeatAccount } from '@/lib/ads-strategy/heartbeat/read'
import {
  AD_HEARTBEAT_EVENT,
  AD_HEARTBEAT_JOB,
  parseHeartbeatClientIds,
  resolveHeartbeatMode,
  runAdHeartbeat,
  type AccountRoundReceipt,
  type HeartbeatReceipt,
} from '@/lib/ads-strategy/heartbeat/run'

export const AD_HEARTBEAT_FUNCTION_ID = `${CLOUD_FN_PREFIX}ad-heartbeat`
export const AD_HEARTBEAT_CRON = 'TZ=Pacific/Auckland 5 * * * *'

export interface AdHeartbeatFnDeps {
  run: () => Promise<HeartbeatReceipt>
  startRun: () => Promise<string>
  finishRun: (input: {
    runId: string
    startedAt: number
    receipt?: HeartbeatReceipt
    error?: string
  }) => Promise<void>
  emit: (receipt: HeartbeatReceipt) => Promise<void>
}

type HeartbeatStepResult =
  | { ok: true; receipt: HeartbeatReceipt }
  | { ok: false; error: string }

const FAILED_STATUSES = new Set<AccountRoundReceipt['status']>([
  'read_failed',
  'aborted',
  'error',
  'no_token',
  'table_missing',
])

async function runHeartbeatStep(
  run: () => Promise<HeartbeatReceipt>,
): Promise<HeartbeatStepResult> {
  try {
    return { ok: true, receipt: await run() }
  } catch (error: unknown) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message.slice(0, 300) : 'UNKNOWN_ERROR',
    }
  }
}

function countAccountsByStatus(
  receipt: HeartbeatReceipt,
): { completed: number; failed: number } {
  let completed = 0
  let failed = 0
  for (const round of receipt.rounds) {
    for (const account of round.accounts) {
      if (account.status === 'ok') completed += 1
      else if (FAILED_STATUSES.has(account.status)) failed += 1
    }
  }
  return { completed, failed }
}

export function createAdHeartbeatFunction(fnDeps: AdHeartbeatFnDeps) {
  return inngest.createFunction(
    {
      id: AD_HEARTBEAT_FUNCTION_ID,
      name: 'Ad heartbeat — hourly read-only Meta sampling',
      retries: 0,
      concurrency: { limit: 1 },
    },
    { cron: AD_HEARTBEAT_CRON },
    async ({ step }) => {
      const started = await step.run('start-run', async () => ({
        runId: await fnDeps.startRun(),
        startedAt: Date.now(),
      }))

      const result = await step.run('heartbeat', () =>
        runHeartbeatStep(fnDeps.run),
      )

      if (result.ok) {
        await step.run('emit-receipt', () => fnDeps.emit(result.receipt))
      }

      await step.run('finish-run', () =>
        fnDeps.finishRun({
          runId: started.runId,
          startedAt: started.startedAt,
          ...(result.ok
            ? { receipt: result.receipt }
            : { error: result.error }),
        }),
      )

      // Fail the Inngest run loudly (after the run log is closed) so a broken sweep is visible there too.
      if (!result.ok) throw new Error(`ad-heartbeat failed: ${result.error}`)

      return {
        mode: result.receipt.mode,
        accounts_checked: result.receipt.accounts_checked,
        table_missing: result.receipt.table_missing,
      }
    },
  )
}

/** Production instance. */
export const adHeartbeat = createAdHeartbeatFunction({
  run: () =>
    runAdHeartbeat(
      {
        store: createSupabaseStore(supabaseAdmin),
        getToken: getMetaTokenForClient,
        read: readHeartbeatAccount,
        now: () => new Date(),
        newRequestId: () => randomUUID(),
      },
      {
        // Read env vars inside `run` (never at module top level) so a redeploy picks up changes.
        mode: resolveHeartbeatMode(process.env.AD_HEARTBEAT_MODE),
        clientIds: parseHeartbeatClientIds(process.env.AD_HEARTBEAT_CLIENT_IDS),
      },
    ),
  startRun: () => startCronRunId(AD_HEARTBEAT_JOB),
  finishRun: async ({ runId, startedAt, receipt, error }) => {
    const run = cronRunHandle(AD_HEARTBEAT_JOB, runId, startedAt)
    if (error) {
      await run.finish({ failed: 1, error })
      return
    }
    if (!receipt) {
      await run.finish({ failed: 1, error: 'MISSING_RECEIPT' })
      return
    }
    const { completed, failed } = countAccountsByStatus(receipt)
    await run.finish({
      processed: receipt.accounts_checked,
      completed,
      failed,
      summary: { ...receipt },
    })
  },
  emit: async receipt => {
    await inngest.send({
      id: receipt.request_id,
      name: AD_HEARTBEAT_EVENT,
      data: receipt,
    })
  },
})

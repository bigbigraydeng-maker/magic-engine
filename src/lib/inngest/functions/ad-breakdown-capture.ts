/**
 * Daily read-only Meta breakdown capture (design: docs/specs/.../ads-opportunity-mining).
 *
 * 只读：本函数不发布、不修改广告，只读取 Meta 数据并（在 live 模式下）写入 ad_breakdown_stats。
 * Read-only on Meta: this function never publishes or mutates ads. It only reads Meta data and,
 * in `live` mode, writes rows to `ad_breakdown_stats`.
 *
 * Runs at 06:30 New Zealand time, after the hourly heartbeat has settled the previous day.
 *
 * Defaults are deliberately inert:
 *   - AD_BREAKDOWN_MODE defaults to 'dry' (no table writes).
 *   - AD_BREAKDOWN_CLIENT_IDS defaults to empty → NO clients are captured.
 *   - dry writes no table rows; it only writes cron_run_logs and emits the receipt event.
 *   - AD_BREAKDOWN_MODE=live is what actually writes ad_breakdown_stats.
 *
 * Ops notes:
 *   - Render env changes require a manual redeploy to take effect.
 *   - New Inngest functions require a Sync in the Inngest dashboard before they run.
 *
 * `retries: 0` on purpose: a capture reads Meta and writes rows; a blind retry of a
 * half-finished run is not worth the risk. The next daily run re-evaluates from scratch.
 * `concurrency: 1`: two captures must never overlap.
 *
 * Each side-effecting phase is its own `step.run` (Inngest replays the function body after
 * every step boundary, so anything outside a step would run again).
 */
import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { resolveAccountTimezone } from '@/lib/ads-strategy/account-timezone'
import {
  fetchAccountDailySpend,
  fetchAdBreakdownInsights,
} from '@/lib/meta/entity-settings'
import { createBreakdownStore } from '@/lib/ads-strategy/breakdown-stats/store'
import {
  AD_BREAKDOWN_EVENT,
  AD_BREAKDOWN_JOB,
  parseClientIds,
  resolveCaptureMode,
  runBreakdownCapture,
} from '@/lib/ads-strategy/breakdown-stats/run'
import type { AccountCaptureReceipt, CaptureReceipt } from '@/lib/ads-strategy/breakdown-stats/types'

export const AD_BREAKDOWN_FUNCTION_ID = `${CLOUD_FN_PREFIX}ad-breakdown-capture`
export const AD_BREAKDOWN_CRON = 'TZ=Pacific/Auckland 30 6 * * *'

export interface AdBreakdownCaptureFnDeps {
  run: () => Promise<CaptureReceipt>
  startRun: () => Promise<string>
  finishRun: (input: {
    runId: string
    startedAt: number
    receipt?: CaptureReceipt
    error?: string
    emitError?: string
  }) => Promise<void>
  emit: (receipt: CaptureReceipt) => Promise<void>
}

type CaptureStepResult =
  | { ok: true; receipt: CaptureReceipt }
  | { ok: false; error: string }

const FAILED_STATUSES = new Set<AccountCaptureReceipt['status']>([
  'read_failed',
  'no_token',
  'write_failed',
  'error',
])

async function runCaptureStep(
  run: () => Promise<CaptureReceipt>,
): Promise<CaptureStepResult> {
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
  receipt: CaptureReceipt,
): { completed: number; failed: number } {
  let completed = 0
  let failed = 0
  for (const account of receipt.accounts) {
    // skipped = hidden account, nothing to do. partial = untrustworthy data → counted as failed,
    // so completed + failed always equals processed and a partial run cannot read as green.
    if (account.status === 'ok' || account.status === 'skipped') completed += 1
    else if (FAILED_STATUSES.has(account.status) || account.status === 'partial') failed += 1
  }
  return { completed, failed }
}

/**
 * A run is red when it could not do its job: config problems, every checked account failed,
 * a live run with any failed account, or the receipt event could not be sent.
 */
export function runProblem(
  receipt: CaptureReceipt,
  completed: number,
  failed: number,
  emitError?: string,
): string | null {
  const parts: string[] = [...receipt.problems]
  if (receipt.accounts_checked > 0 && completed === 0 && failed > 0) {
    parts.push('所有被检查的账户都读失败')
  } else if (receipt.mode === 'live' && failed > 0) {
    parts.push(`live 模式下有 ${failed} 个账户读失败或没写成`)
  }
  // Both modes: dry is the pre-live trial, so data that does not add up must be visible there too.
  const partial = receipt.accounts.filter((a) => a.status === 'partial').length
  if (partial > 0) parts.push(`${partial} 个账户数据不完整或花费对账没对上`)
  if (emitError) parts.push(emitError)
  return parts.length > 0 ? parts.join('；').slice(0, 500) : null
}

export function createAdBreakdownCaptureFunction(fnDeps: AdBreakdownCaptureFnDeps) {
  return inngest.createFunction(
    {
      id: AD_BREAKDOWN_FUNCTION_ID,
      name: 'Ad breakdown capture — daily read-only Meta breakdowns',
      retries: 0,
      concurrency: { limit: 1 },
      // Whatever happens, never leave the run log stuck at "running".
      onFailure: async ({ event, error }) => {
        const message = error?.message || '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(AD_BREAKDOWN_JOB, `切法采集函数失败：${message}`, { startedBefore })
      },
    },
    { cron: AD_BREAKDOWN_CRON },
    async ({ step }) => {
      const started = await step.run('start-run', async () => ({
        runId: await fnDeps.startRun(),
        startedAt: Date.now(),
      }))

      // Inngest's serialised step type loses the receipt shape; the value itself is plain JSON.
      const result = (await step.run('capture', () =>
        runCaptureStep(fnDeps.run),
      )) as CaptureStepResult

      // A failed emit must not stop the run log from closing (it would stay "running" forever).
      let emitError: string | undefined
      if (result.ok) {
        // Returns '' (not undefined/null) on success: Inngest JSON-serialises step results.
        const emitResult = await step.run('emit-receipt', async () => {
          try {
            await fnDeps.emit(result.receipt)
            return ''
          } catch (error: unknown) {
            return `EMIT_FAILED: ${error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN_ERROR'}`
          }
        })
        emitError = emitResult || undefined
      }

      await step.run('finish-run', () =>
        fnDeps.finishRun({
          runId: started.runId,
          startedAt: started.startedAt,
          ...(result.ok
            ? { receipt: result.receipt, ...(emitError ? { emitError } : {}) }
            : { error: result.error }),
        }),
      )

      // Fail the Inngest run loudly (after the run log is closed) so a broken capture is visible there too.
      if (!result.ok) throw new Error(`ad-breakdown-capture failed: ${result.error}`)

      return {
        mode: result.receipt.mode,
        accounts_checked: result.receipt.accounts_checked,
      }
    },
  )
}

/** Production instance. */
export const adBreakdownCapture = createAdBreakdownCaptureFunction({
  run: () =>
    runBreakdownCapture(
      {
        store: createBreakdownStore(supabaseAdmin),
        getToken: getMetaTokenForClient,
        resolveTimezone: resolveAccountTimezone,
        fetchBreakdown: fetchAdBreakdownInsights,
        fetchAccountDaily: fetchAccountDailySpend,
        now: () => new Date(),
        newRequestId: () => randomUUID(),
      },
      {
        // Read env vars inside `run` (never at module top level) so a redeploy picks up changes.
        mode: resolveCaptureMode(process.env.AD_BREAKDOWN_MODE),
        clientIds: parseClientIds(process.env.AD_BREAKDOWN_CLIENT_IDS),
      },
    ),
  startRun: () => startCronRunId(AD_BREAKDOWN_JOB),
  finishRun: async ({ runId, startedAt, receipt, error, emitError }) => {
    const run = cronRunHandle(AD_BREAKDOWN_JOB, runId, startedAt)
    if (error) {
      await run.finish({ failed: 1, error })
      return
    }
    if (!receipt) {
      await run.finish({ failed: 1, error: 'MISSING_RECEIPT' })
      return
    }
    const { completed, failed } = countAccountsByStatus(receipt)
    const problem = runProblem(receipt, completed, failed, emitError)
    if (problem) {
      await run.finish({ processed: receipt.accounts_checked, completed, failed, error: problem, summary: { ...receipt } })
      return
    }
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
      name: AD_BREAKDOWN_EVENT,
      data: receipt,
    })
  },
})

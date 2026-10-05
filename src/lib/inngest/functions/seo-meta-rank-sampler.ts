/**
 * SEO Meta-Cycle — daily target-keyword rank sampler (Inngest wrapper).
 * Business logic lives in src/lib/seo-meta/cycle/rank-sampler.ts; this file only does the
 * fan-out / one-row split, the run receipts and the failure handling.
 *
 * Two functions, same split as flywheel-seo-weekly.ts:
 *   · `cloud-seo-meta-rank-sampler-fanout` — daily cron. Finds seo_meta_log rows that are due
 *     for a rank reading (cap: MAX_ROWS_PER_RUN), sends one `seo/meta-rank.sample.due` per row,
 *     then ENDS. It calls no provider and spends nothing.
 *   · `cloud-seo-meta-rank-sampler-one` — one row per event: at most one SERP call, then a
 *     receipt (calls made, USD cost, verdict).
 *
 * 🔴 After a deploy that ADDS these functions someone must re-Sync `/api/inngest` in the Inngest
 *    dashboard. Without it they silently never run — which looks exactly like "all fine".
 *    That is why the job is also in CRON_REGISTRY: health check then reports "never ran".
 *
 * 🔴 Every side effect sits inside a step.run: Inngest replays the function body after each step
 *    boundary, so anything outside a step runs several times (flywheel-seo-weekly.ts learned this
 *    the expensive way).
 *
 * 🔴 `retries: 0` on the per-row function: the SERP call is paid and happens inside the step. A
 *    failed read is recorded as a `fetch_failed` sample (counted against MAX_SAMPLE_ATTEMPTS)
 *    rather than retried blind. A database failure throws; the row is simply due again tomorrow.
 *
 * 🔴 Global `concurrency: { limit: 1 }` on the per-row function is deliberate, not a throttle for
 *    its own sake: onFailure closes every still-`running` receipt of this job name
 *    (failOpenCronRuns), which is only safe if at most one row is in flight at a time. 30 rows a
 *    day, a few seconds each — serial is nowhere near a bottleneck.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import {
  RANK_SAMPLER_CRON,
  RANK_SAMPLER_JOB,
  RANK_SAMPLE_DUE_EVENT,
  isoDay,
  loadDueRows,
  sampleOneRow,
  type RankLogRow,
  type SampleOutcome,
} from '@/lib/seo-meta/cycle/rank-sampler'

export interface RankSamplerFanOutReceipt {
  readonly job: string
  readonly day: string
  readonly status: 'dispatched' | 'nothing_due'
  readonly rows_dispatched: number
  /** Upper bound only: dispatched rows × 1 SERP call. Real calls and cost are in each row's own receipt. */
  readonly max_provider_calls: number
  readonly no_publish: true
}

/** One event per due row. Pure, so what gets dispatched can be asserted without sending anything. */
export function buildRankSampleEvents(
  rows: ReadonlyArray<Pick<RankLogRow, 'id' | 'client_id'>>,
  day: string,
): Array<{ id: string; name: string; data: { row_id: string; client_id: string; day: string } }> {
  return rows.map((r) => ({
    // Inngest dedupes event ids for 24h only — a thin first line of defence. The real guard
    // against a double SERP charge is isDue()'s SAMPLE_SPACING_DAYS check inside sampleOneRow.
    id: `seo-meta-rank-${r.id}-${day}`,
    name: RANK_SAMPLE_DUE_EVENT,
    data: { row_id: r.id, client_id: r.client_id, day },
  }))
}

export function createRankSamplerFanOutFunction(deps: { supabase: typeof supabaseAdmin; now?: () => Date }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}seo-meta-rank-sampler-fanout`,
      name: 'SEO meta-cycle: dispatch one daily rank sample per due change',
      concurrency: { limit: 1 },
      retries: 2,
    },
    { cron: RANK_SAMPLER_CRON },
    async ({ step }): Promise<RankSamplerFanOutReceipt> => {
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(RANK_SAMPLER_JOB),
        startedAt: Date.now(),
        day: isoDay((deps.now ?? (() => new Date()))()),
      }))
      const run = cronRunHandle(RANK_SAMPLER_JOB, started.runId, started.startedAt)
      const base = { job: RANK_SAMPLER_JOB, day: started.day, no_publish: true as const }

      const due = await step.run('load-due', async () => {
        const rows = await loadDueRows(deps.supabase, (deps.now ?? (() => new Date()))())
        return rows.map((r) => ({ id: r.id, client_id: r.client_id }))
      })

      if (due.length === 0) {
        await step.run('log-finish-nothing-due', async () => {
          await run.finish({ processed: 0, completed: 0, failed: 0, summary: { day: started.day, counts_are: 'dispatched_not_sampled', rows_dispatched: 0 } })
          return null
        })
        return { ...base, status: 'nothing_due', rows_dispatched: 0, max_provider_calls: 0 }
      }

      await step.sendEvent('dispatch-samples', buildRankSampleEvents(due, started.day))
      await step.run('log-finish-dispatched', async () => {
        await run.finish({
          processed: due.length,
          completed: due.length,
          failed: 0,
          // These are DISPATCH numbers, not sample numbers — what actually happened per row is in that row's own receipt.
          summary: { day: started.day, counts_are: 'dispatched_not_sampled', rows_dispatched: due.length, max_provider_calls: due.length },
        })
        return null
      })
      return { ...base, status: 'dispatched', rows_dispatched: due.length, max_provider_calls: due.length }
    },
  )
}

export function createRankSamplerOneFunction(deps: { supabase: typeof supabaseAdmin }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}seo-meta-rank-sampler-one`,
      name: 'SEO meta-cycle: take one rank sample for one change',
      concurrency: { limit: 1 },
      retries: 0,
      onFailure: async ({ event, error }) => {
        const message = error?.message || '未知错误'
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(RANK_SAMPLER_JOB, `排名采样失败：${message}`, { startedBefore })
      },
    },
    { event: RANK_SAMPLE_DUE_EVENT },
    async ({ event, step }) => {
      const rowId = typeof event.data?.row_id === 'string' ? event.data.row_id : null
      if (!rowId) return { kind: 'invalid_payload' as const }

      const started = await step.run(`log-start-${rowId}`, async () => ({
        runId: await startCronRunId(RANK_SAMPLER_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(RANK_SAMPLER_JOB, started.runId, started.startedAt)

      const outcome: SampleOutcome = await step.run(`sample-${rowId}`, async () => sampleOneRow(rowId, { supabase: deps.supabase }))

      await step.run(`log-finish-${rowId}`, async () => {
        await run.finish({
          processed: 1,
          completed: 1,
          failed: 0,
          summary: {
            row_id: rowId,
            client_id: event.data.client_id ?? null,
            outcome: outcome.kind,
            reason: outcome.reason ?? null,
            rank_verdict: outcome.verdict,
            provider_calls: outcome.providerCalls,
            cost_usd: outcome.costUsd,
            no_publish: true,
          },
        })
        return null
      })
      return outcome
    },
  )
}

export const seoMetaRankSamplerFanOut = createRankSamplerFanOutFunction({ supabase: supabaseAdmin })
export const seoMetaRankSamplerOne = createRankSamplerOneFunction({ supabase: supabaseAdmin })

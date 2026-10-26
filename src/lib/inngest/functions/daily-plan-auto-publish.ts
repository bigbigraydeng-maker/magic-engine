/**
 * Hourly sweep of the Daily Plan auto-publisher (design: docs/specs/2026-10-10-daily-plan-auto-publish-design.md).
 *
 * Runs at minute 20 of every hour, New Zealand time (the factory Reel worker runs at minute 5).
 * All the rules live in `runAutoPublishSweep`; this file only schedules it and writes the run log.
 *
 * `retries: 0` on purpose: a sweep sends things to Facebook, and a blind retry of a half-finished
 * sweep is exactly how a Post gets published twice. The next hourly run re-evaluates from the
 * attempts table, which records every claim.
 * `concurrency: 1`: two sweeps must never overlap.
 *
 * Each side-effecting phase is its own `step.run` (Inngest replays the function body after every
 * step boundary, so anything outside a step would run again).
 */
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { buildProductionDeps } from '@/lib/campaign/daily-plan-auto-publish-deps'
import {
  runAutoPublishSweep,
  type AutoPublishWorkerDeps,
  type SweepSummary,
} from '@/lib/campaign/daily-plan-auto-publish-worker'

export const DAILY_PLAN_AUTO_PUBLISH_FUNCTION_ID = `${CLOUD_FN_PREFIX}daily-plan-auto-publish`
export const DAILY_PLAN_AUTO_PUBLISH_JOB = 'daily-plan-auto-publish'
export const DAILY_PLAN_AUTO_PUBLISH_CRON = 'TZ=Pacific/Auckland 20 * * * *'

export interface DailyPlanAutoPublishFnDeps {
  buildDeps: (now: Date) => AutoPublishWorkerDeps
  startRun: () => Promise<string>
  finishRun: (input: { runId: string; startedAt: number; summary?: SweepSummary; error?: string }) => Promise<void>
}

type SweepStepResult = { ok: true; summary: SweepSummary } | { ok: false; error: string }

export function createDailyPlanAutoPublishFunction(fnDeps: DailyPlanAutoPublishFnDeps) {
  return inngest.createFunction(
    {
      id: DAILY_PLAN_AUTO_PUBLISH_FUNCTION_ID,
      name: 'Daily Plan — auto-publish sweep',
      retries: 0,
      concurrency: { limit: 1 },
    },
    { cron: DAILY_PLAN_AUTO_PUBLISH_CRON },
    async ({ step }) => {
      const started = await step.run('start-run', async () => ({ runId: await fnDeps.startRun(), startedAt: Date.now() }))

      const result = await step.run('sweep', async (): Promise<SweepStepResult> => {
        try {
          return { ok: true, summary: await runAutoPublishSweep(fnDeps.buildDeps(new Date())) }
        } catch (error: unknown) {
          return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'UNKNOWN_ERROR' }
        }
      })

      await step.run('finish-run', () =>
        fnDeps.finishRun({
          runId: started.runId,
          startedAt: started.startedAt,
          ...(result.ok ? { summary: result.summary } : { error: result.error }),
        }),
      )

      // Fail the Inngest run loudly (after the run log is closed) so a broken sweep is visible there too.
      if (!result.ok) throw new Error(`daily-plan-auto-publish sweep failed: ${result.error}`)
      return result.summary.counts
    },
  )
}

/** Production instance. */
export const dailyPlanAutoPublish = createDailyPlanAutoPublishFunction({
  buildDeps: now => buildProductionDeps(now),
  startRun: () => startCronRunId(DAILY_PLAN_AUTO_PUBLISH_JOB),
  finishRun: async ({ runId, startedAt, summary, error }) => {
    const run = cronRunHandle(DAILY_PLAN_AUTO_PUBLISH_JOB, runId, startedAt)
    if (error) {
      await run.finish({ failed: 1, error })
      return
    }
    const counts = summary?.counts ?? {}
    await run.finish({
      processed: summary?.records.length ?? 0,
      completed: counts.published ?? 0,
      failed: (counts.blocked ?? 0) + (counts.unknown_outcome ?? 0) + (counts.missed_window ?? 0) + (counts.error ?? 0),
      summary: { ...counts, authorizations: summary?.authorizations ?? 0, records: summary?.records ?? [] },
    })
  },
})

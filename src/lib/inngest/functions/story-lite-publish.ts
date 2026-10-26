/**
 * Ten-minute sweep of the Story "lite" publisher (design: docs/specs/2026-10-12-story-lite-design.md).
 *
 * Runs every ten minutes, New Zealand time. Every rule lives in `runStorySweep`; this file only schedules
 * it and writes the run log. Rehearsal is the default: nothing is sent unless `STORY_AUTO_PUBLISH_LIVE`
 * is exactly 'true' AND the client is listed in `STORY_AUTO_PUBLISH_CLIENTS`.
 *
 * `retries: 0` on purpose: a sweep may send a story, and a blind retry of a half-finished sweep is how a
 * story goes out twice. The next run re-reads the items; anything claimed but not settled becomes
 * "outcome unknown" and goes to a person.
 * `concurrency: 1`: two sweeps must never overlap.
 */
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { buildSenderDeps } from '@/lib/social/story-lite/ports'
import { runStorySweep, type SenderDeps, type SweepSummary } from '@/lib/social/story-lite/sender'

export const STORY_LITE_PUBLISH_FUNCTION_ID = `${CLOUD_FN_PREFIX}story-lite-publish`
export const STORY_LITE_PUBLISH_JOB = 'story-lite-publish'
export const STORY_LITE_PUBLISH_CRON = 'TZ=Pacific/Auckland */10 * * * *'

export interface StoryLitePublishFnDeps {
  buildDeps: (now: Date) => SenderDeps
  startRun: () => Promise<string>
  finishRun: (input: { runId: string; startedAt: number; summary?: SweepSummary; error?: string }) => Promise<void>
}

type SweepStepResult = { ok: true; summary: SweepSummary } | { ok: false; error: string }

export function createStoryLitePublishFunction(fnDeps: StoryLitePublishFnDeps) {
  return inngest.createFunction(
    {
      id: STORY_LITE_PUBLISH_FUNCTION_ID,
      name: 'Story lite — publish sweep',
      retries: 0,
      concurrency: { limit: 1 },
    },
    { cron: STORY_LITE_PUBLISH_CRON },
    async ({ step }) => {
      const started = await step.run('start-run', async () => ({ runId: await fnDeps.startRun(), startedAt: Date.now() }))

      const result = await step.run('sweep', async (): Promise<SweepStepResult> => {
        try {
          return { ok: true, summary: await runStorySweep(fnDeps.buildDeps(new Date())) }
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
      if (!result.ok) throw new Error(`story-lite-publish sweep failed: ${result.error}`)
      return result.summary.counts
    },
  )
}

/** Production instance. */
export const storyLitePublish = createStoryLitePublishFunction({
  buildDeps: (now) => buildSenderDeps(now),
  startRun: () => startCronRunId(STORY_LITE_PUBLISH_JOB),
  finishRun: async ({ runId, startedAt, summary, error }) => {
    const run = cronRunHandle(STORY_LITE_PUBLISH_JOB, runId, startedAt)
    if (error) {
      await run.finish({ failed: 1, error })
      return
    }
    const counts = summary?.counts ?? {}
    await run.finish({
      processed: summary?.records.length ?? 0,
      completed: (counts.SENT ?? 0) + (counts.DRY_RUN ?? 0),
      failed: (counts.BLOCKED ?? 0) + (counts.FAILED ?? 0) + (counts.UNKNOWN_OUTCOME ?? 0) + (counts.MISSED ?? 0),
      summary: { ...counts, stale_expired: summary?.staleExpired.length ?? 0, records: summary?.records ?? [] },
    })
  },
})

/**
 * One meta-leads-sync run at a time.
 *
 * The dispatcher can still deliver a second tick (a late retry, or a manual
 * run while the cron is inside maxDuration). Lead rows are already unique on
 * (client_id, source, source_ref) = the Meta lead id, so a second run cannot
 * insert a second touchpoint. This lock keeps the second run from also
 * calling Graph and Mailchimp.
 *
 * A yielded run deletes its own `running` row. If that delete fails, it
 * finishes as completed with `summary.skipped = 'overlap'` so the row cannot
 * stay `running`, and readers skip that summary when they judge streaks.
 */

import type { CronRunFinishOpts } from '@/lib/cron/run-logger'

export interface RunningLeadSync {
  id: string
  startedAt: string
}

export function isOverlapSkipSummary(summary: unknown): boolean {
  if (typeof summary !== 'object' || summary === null) return false
  return (summary as { skipped?: unknown }).skipped === 'overlap'
}

/** Oldest fresh running row wins. A row older than `freshForMs` is ignored so a stuck row cannot block the next slot. */
export function pickRunningOwner(
  runs: readonly RunningLeadSync[],
  now: Date,
  freshForMs: number,
): RunningLeadSync | null {
  const fresh = runs.filter((run) => {
    const started = Date.parse(run.startedAt)
    const age = now.getTime() - started
    return Number.isFinite(started) && age >= 0 && age < freshForMs
  })
  fresh.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return fresh[0] ?? null
}

export type LeadSyncClaim =
  | { proceed: true; finish: (opts: CronRunFinishOpts) => Promise<void> }
  | { proceed: false; activeRunId: string }

export async function claimMetaLeadsSyncRun(deps: {
  now: Date
  freshForMs: number
  listRunning: () => Promise<{ rows: RunningLeadSync[]; readError: string | null }>
  start: () => Promise<{ id: string; finish: (opts: CronRunFinishOpts) => Promise<void> }>
  release: (id: string) => Promise<string | null>
}): Promise<LeadSyncClaim> {
  const first = await deps.listRunning()
  if (first.readError) {
    console.error(
      `[meta-leads-sync] overlap lock read failed, continuing because the lead upsert is idempotent: ${first.readError}`,
    )
  } else {
    const owner = pickRunningOwner(first.rows, deps.now, deps.freshForMs)
    if (owner) return { proceed: false, activeRunId: owner.id }
  }

  const started = await deps.start()
  const second = await deps.listRunning()
  if (second.readError) return { proceed: true, finish: started.finish }
  const owner = pickRunningOwner(second.rows, deps.now, deps.freshForMs)
  if (!owner || owner.id === started.id) return { proceed: true, finish: started.finish }

  const releaseError = await deps.release(started.id)
  if (releaseError) {
    console.error(`[meta-leads-sync] could not delete yielded run ${started.id}: ${releaseError}`)
    await started.finish({
      processed: 0,
      completed: 0,
      failed: 0,
      summary: { skipped: 'overlap', activeRunId: owner.id },
    })
  }
  return { proceed: false, activeRunId: owner.id }
}

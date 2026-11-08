/**
 * meta-leads-sync cadence.
 *
 * Every 30 minutes, at minute 25 and minute 55 UTC. Not at minute 0.
 * Minute 0 already runs other Meta reads (comment auto-reply). Messenger
 * sync is at minute 10. Stacking this job on those minutes at 4× frequency
 * would bunch Graph calls. The 5-minute dispatcher understands a comma list
 * in the minute field.
 *
 * Render only ticks `cron-dispatch-frequent`. This string is what marks the
 * job due. Rollback is putting `25 *\/2 * * *` back in the catalog and registry.
 */

export const META_LEADS_SYNC_SCHEDULE = '25,55 * * * *'

/** 24 hours × 2 slots. The old `25 *\/2 * * *` expression was 12 slots. */
export const META_LEADS_RUNS_PER_DAY = 48

export interface MetaLeadsGraphReadEstimate {
  perRun: number
  perHour: number
  perDay: number
}

/**
 * Steady-state Graph reads for one run.
 *
 * Counted: one lead-form list per page, one leads page per form, one account
 * settings read per ad account (the status probe on the same cron).
 * Not counted: a stored page token needs no extra Graph call. Falling back to
 * a user token adds one `/me/accounts` read. Pagination above one page, and the
 * minimal-field retry, are ceilings — pass `pagesPerForm` / `fieldFallback`.
 * The 24-hour watermark does not shrink when the cron runs more often, so
 * daily volume scales with the run count.
 */
export function estimateMetaLeadsGraphReads(input: {
  clientsWithPage: number
  formsPerClient: number
  pagesPerForm: number
  adAccounts: number
  fieldFallback?: boolean
}): MetaLeadsGraphReadEstimate {
  const clients = whole(input.clientsWithPage)
  const forms = whole(input.formsPerClient)
  const pages = whole(input.pagesPerForm)
  const accounts = whole(input.adAccounts)
  const leadMultiplier = input.fieldFallback ? 2 : 1
  const perRun = clients + clients * forms * pages * leadMultiplier + accounts
  return {
    perRun,
    perHour: perRun * (60 / 30),
    perDay: perRun * META_LEADS_RUNS_PER_DAY,
  }
}

function whole(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

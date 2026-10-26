/**
 * Magic Engine 2.0 · Inngest cloud consumers for the per-page daily Google
 * Search Console store (`gsc_page_daily` / `gsc_page_fetch_receipts`).
 *
 * Two functions, one dispatches and one works:
 *   · `cloud-gsc-page-daily-fanout` — runs daily at 18:30 UTC (after
 *     google-data-pullback-daily at 17:00 UTC), reads which clients have a
 *     usable GSC connection and which months are already covered by complete
 *     receipts, sends one `gsc/page-daily.pull.due` event per order, and ends.
 *     It calls no Google API itself and spends nothing.
 *   · `cloud-gsc-page-daily-pull` — takes one order and does it.
 *
 * 🔴 **Why Inngest, not Render, schedules it**: this repo has been burned twice
 *    by Render's "someone must click Apply in the dashboard" step — a service
 *    that was created and never ran, and one that only exists in the dashboard
 *    and not in the repo. Neither failure reports an error. Inngest registers
 *    the timer together with the function, removing the "someone forgot to
 *    click" step.
 *
 * 🔴 **But it trades that for another manual step, don't pretend otherwise**:
 *    Render is not Vercel, there is no auto-sync — after adding a function or
 *    changing a trigger, someone must re-Sync `/api/inngest` in the Inngest
 *    dashboard. **The symptom of not syncing is "silently never runs"**, which
 *    looks exactly like "everything is fine". So this chain is also registered
 *    in CRON_REGISTRY with the receipts table as its output table: when it
 *    really never ran, the health check says "never ran".
 *
 * 🔴 **One event, one owner**: `gsc/page-daily.pull.due` is cloud-only; the
 *    local factory-worker does not listen to it.
 *
 * 🔴 **De-duplication is by receipts, not by event ids**: a month with a
 *    complete receipt is not planned again. Inngest only de-duplicates event
 *    ids for 24 hours, so the event id is a thin 24-hour line, not the account.
 *
 * 🔴 **Pull concurrency**: at most one order per client at a time (daily and
 *    backfill share this lock), at most 3 orders in flight overall. `retries: 2`
 *    re-runs only the failed step. `onFailure` closes exactly this run's receipt
 *    and run-log row (see handlePullFailure).
 *
 * 🔴 **Run logs**: the dispatch writes one row per day under job 'gsc-page-daily';
 *    every pull order writes its own row under 'gsc-page-daily-pull'. Both row
 *    ids are derived from the Inngest run id, so each function's onFailure
 *    closes exactly its own row — never another run's.
 *
 * 🔴 **Stopped backfill months**: a month whose latest 3 receipts are non-auth
 *    failures is no longer dispatched. The dispatch row reports it as failed
 *    ONCE — on the first dispatch that sees it, naming the client and month —
 *    and every dispatch row carries `summary.stopped_backfill_months`
 *    (`[{ client_id, month, stopped_on }]`, `[]` when none) so the list is
 *    never lost. A row that is red every day stops carrying information, which
 *    is why the red is not repeated. Derived from receipts only; nothing stored.
 *
 * Every side effect happens inside a step: Inngest replays the function body
 * after each step boundary, and code outside steps runs again on every replay.
 *
 * Read-only towards Google, never publishes anything (`no_publish: true`).
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, cronRunIdFromInngestRun, finishCronRunIfOpen, startCronRunWithId, type CronRunHandle } from '@/lib/cron/run-logger'
import { fetchFinalizedDayRange, querySearchAnalyticsRows, withGscAccess } from '@/lib/gsc/client'
import { loadGscConnectedClients } from '@/lib/gsc/connected-clients'
import {
  BACKFILL_STOP_AFTER_FAILURES,
  GSC_PAGE_DAILY_CRON,
  GSC_PAGE_DAILY_JOB,
  GSC_PAGE_DAILY_PULL_EVENT,
  GSC_PAGE_DAILY_TZ,
  pacificDay,
  parsePullDue,
  pullEventId,
  type PullOrder,
  type StoppedMonth,
} from '@/lib/gsc/page-daily-plan'
import { buildPageDailyPlan, type PlanResult } from '@/lib/gsc/page-daily-store'
import { handlePullFailure, PAGE_DATASET, runPageDailyPull, type PullDataset, type PullDeps, type PullStep } from '@/lib/gsc/page-daily-pull'

export const GSC_PAGE_DAILY_FANOUT_ID = `${CLOUD_FN_PREFIX}gsc-page-daily-fanout`
export const GSC_PAGE_DAILY_PULL_ID = `${CLOUD_FN_PREFIX}gsc-page-daily-pull`

/**
 * Everything that tells one dispatch/pull chain apart from another: job name, event name, event-id prefix,
 * Inngest function ids and display names, schedule, and the data set it feeds. The per-page chain is the default;
 * the per-(query, page) chain (gsc-query-page-daily.ts) passes its own, so the two never share an event name,
 * an event id, a job name or a receipts table.
 */
export interface GscChainVariant {
  readonly job: string
  /** Opens the dispatch's run-log row (see PullDataset.startRun for why this is a function). */
  startRun(runLogId: string): Promise<void>
  readonly eventName: string
  readonly eventIdPrefix: string
  readonly fanoutId: string
  readonly fanoutName: string
  readonly pullId: string
  readonly pullName: string
  readonly cron: string
  readonly dataset: PullDataset
}

export const PAGE_CHAIN: GscChainVariant = {
  job: GSC_PAGE_DAILY_JOB,
  startRun: (runLogId) => startCronRunWithId(GSC_PAGE_DAILY_JOB, runLogId),
  eventName: GSC_PAGE_DAILY_PULL_EVENT,
  eventIdPrefix: 'gsc-page-daily',
  fanoutId: GSC_PAGE_DAILY_FANOUT_ID,
  fanoutName: 'GSC per-page daily: dispatch pull orders',
  pullId: GSC_PAGE_DAILY_PULL_ID,
  pullName: 'GSC per-page daily: pull one order',
  cron: GSC_PAGE_DAILY_CRON,
  dataset: PAGE_DATASET,
}

/** The dispatch receipt — also what the Inngest dashboard shows for a fan-out run. */
export interface FanOutReceipt {
  readonly job: string
  readonly today: string
  readonly status: 'dispatched' | 'plan_failed' | 'nothing_to_do'
  readonly clients: number
  readonly orders_dispatched: number
  readonly daily_orders: number
  readonly backfill_orders: number
  readonly stopped_backfill_months: number
  readonly newly_stopped_backfill_months: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

export interface PullEvent {
  readonly id: string
  readonly name: string
  readonly data: PullOrder
}

/** The two step tools the fan-out needs (tests pass a fake). */
export interface FanOutStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sendEvent(id: string, events: PullEvent[]): Promise<unknown>
}

export interface FanOutDeps {
  buildPlan(today: string): Promise<PlanResult>
}

/** Turn planned orders into the events to send; extracted so tests can assert what was sent. */
export function buildPullEvents(orders: readonly PullOrder[], chain: GscChainVariant = PAGE_CHAIN): PullEvent[] {
  return orders.map((o) => ({
    id: pullEventId(o, chain.eventIdPrefix),
    name: chain.eventName,
    data: { client_id: o.client_id, kind: o.kind, start_day: o.start_day, end_day: o.end_day },
  }))
}

/** Close the fan-out's run log inside its own step (a step, so a replay never writes it twice). */
function finishFanOutLog(
  step: FanOutStep,
  stepId: 'log-finish-plan-failed' | 'log-finish-empty' | 'log-finish-dispatched',
  run: ReturnType<typeof cronRunHandle>,
  opts: Parameters<ReturnType<typeof cronRunHandle>['finish']>[0],
): Promise<null> {
  return step.run(stepId, async () => {
    await run.finish(opts)
    return null
  })
}

/** One FanOutReceipt from the shared fields plus this run's outcome. */
function fanOutReceipt(
  chain: GscChainVariant,
  started: { today: string; createdAt: string },
  outcome: Omit<FanOutReceipt, 'job' | 'today' | 'no_publish' | 'created_at'>,
): FanOutReceipt {
  return { job: chain.job, today: started.today, no_publish: true, created_at: started.createdAt, ...outcome }
}

/** The error text for months this dispatch is the first to see stopped; undefined when there are none. */
export function newlyStoppedError(newly: readonly StoppedMonth[]): string | undefined {
  if (newly.length === 0) return undefined
  const list = newly.map((s) => `client ${s.client_id} month ${s.month}`).join('; ')
  return `backfill stopped after ${BACKFILL_STOP_AFTER_FAILURES} consecutive failures (not auth): ${list}`
}

/**
 * The dispatch row's finish options: dispatch counts (not pull results — each order writes its own receipt
 * and run log), the full list of stopped months (every day, [] when none), and a failure only for the months
 * this dispatch is the first to see stopped.
 */
export function fanOutFinishOpts(
  today: string,
  plan: Extract<PlanResult, { ok: true }>,
  dispatched: number,
): Parameters<CronRunHandle['finish']>[0] {
  const dailyOrders = plan.orders.filter((o) => o.kind === 'daily').length
  return {
    processed: dispatched,
    completed: dispatched,
    failed: plan.newlyStopped.length,
    summary: {
      today,
      counts_are: 'dispatched_not_pulled',
      clients: plan.clients,
      daily_orders: dailyOrders,
      backfill_orders: dispatched - dailyOrders,
      stopped_backfill_months: plan.stopped.map((s) => ({ client_id: s.client_id, month: s.month, stopped_on: s.stopped_on })),
    },
    error: newlyStoppedError(plan.newlyStopped),
  }
}

/** Run one dispatch: plan, send one event per order, write one run log (its id derived from the Inngest run id). */
export async function runGscPageDailyFanOut(
  step: FanOutStep,
  deps: FanOutDeps,
  runId: string,
  chain: GscChainVariant = PAGE_CHAIN,
): Promise<FanOutReceipt> {
  // "today" must be computed inside a step: a replay after midnight Pacific
  // would otherwise plan a different day than the one the run log records.
  const started = await step.run('log-start', async () => {
    const runLogId = cronRunIdFromInngestRun(runId)
    await chain.startRun(runLogId)
    return { runLogId, startedAt: Date.now(), today: pacificDay(new Date()), createdAt: new Date().toISOString() }
  })
  const run = cronRunHandle(chain.job, started.runLogId, started.startedAt)

  const plan = await step.run('plan', async () => deps.buildPlan(started.today))
  if (!plan.ok) {
    const error = `plan failed: ${plan.reason}`
    await finishFanOutLog(step, 'log-finish-plan-failed', run, { processed: 0, completed: 0, failed: 1, error })
    return fanOutReceipt(chain, started, {
      status: 'plan_failed', clients: 0, orders_dispatched: 0, daily_orders: 0, backfill_orders: 0,
      stopped_backfill_months: 0, newly_stopped_backfill_months: 0, error: plan.reason,
    })
  }

  const events = buildPullEvents(plan.orders, chain)
  if (events.length > 0) await step.sendEvent('dispatch-pulls', events)
  const opts = fanOutFinishOpts(started.today, plan, events.length)
  await finishFanOutLog(step, events.length > 0 ? 'log-finish-dispatched' : 'log-finish-empty', run, opts)
  const dailyOrders = plan.orders.filter((o) => o.kind === 'daily').length
  return fanOutReceipt(chain, started, {
    status: events.length > 0 ? 'dispatched' : 'nothing_to_do',
    clients: plan.clients,
    orders_dispatched: events.length,
    daily_orders: dailyOrders,
    backfill_orders: events.length - dailyOrders,
    stopped_backfill_months: plan.stopped.length,
    newly_stopped_backfill_months: plan.newlyStopped.length,
    error: opts.error ?? null,
  })
}

/** The fan-out's onFailure: close exactly its own run-log row (id derived from the Inngest run id). Never throws. */
export async function handleFanOutFailure(input: {
  runId: string | null
  message: string
  failedAt: Date
}, chain: GscChainVariant = PAGE_CHAIN): Promise<'closed' | 'already_terminal' | 'no_run_id'> {
  if (!input.runId) {
    console.error('[gsc-page-daily] fan-out onFailure without a run id — nothing closed:', input.message)
    return 'no_run_id'
  }
  return finishCronRunIfOpen(
    chain.job,
    cronRunIdFromInngestRun(input.runId),
    { processed: 0, completed: 0, failed: 1, error: `retries exhausted: ${input.message}` },
    input.failedAt,
  )
}

/** Dependency-injected fan-out, so tests can inject a fake plan and a fake step. */
export function createGscPageDailyFanOutFunction(deps: FanOutDeps, chain: GscChainVariant = PAGE_CHAIN) {
  return inngest.createFunction(
    {
      id: chain.fanoutId,
      name: chain.fanoutName,
      // Two dispatches at once would plan and send the same orders twice; the
      // deterministic event ids absorb that within 24 h, but the run log would
      // then show dispatch counts that are not real.
      concurrency: { limit: 1 },
      retries: 2,
      onFailure: async ({ event, error }) => {
        const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
        await handleFanOutFailure({
          runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
          message: error?.message || 'unknown error',
          failedAt,
        }, chain)
      },
    },
    { cron: `TZ=${GSC_PAGE_DAILY_TZ} ${chain.cron}` },
    async ({ step, runId }): Promise<FanOutReceipt> =>
      runGscPageDailyFanOut(
        {
          // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
          run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
          sendEvent: (id, events) => step.sendEvent(id, events),
        },
        deps,
        runId,
        chain,
      ),
  )
}

/** The production pull dependencies: the shared roster, the shared GSC client, the shared DB. */
export function defaultPullDeps(): PullDeps {
  return {
    supabase: supabaseAdmin,
    loadSiteUrl: async (clientId) => {
      const roster = await loadGscConnectedClients(supabaseAdmin)
      if (!roster.ok) throw new Error(`[db] GSC roster read failed: ${roster.reason}`)
      return roster.clients.find((c) => c.clientId === clientId)?.siteUrl ?? null
    },
    fetchRows: (clientId, siteUrl, query) =>
      withGscAccess(clientId, (token) => querySearchAnalyticsRows(token, siteUrl, query)),
    fetchFinalizedRange: (clientId, siteUrl, startDay, endDay) =>
      withGscAccess(clientId, (token) => fetchFinalizedDayRange(token, siteUrl, startDay, endDay)),
  }
}

/** Dependency-injected pull worker, so tests can inject fake rows and a fake DB. */
export function createGscPageDailyPullFunction(deps: PullDeps, chain: GscChainVariant = PAGE_CHAIN) {
  return inngest.createFunction(
    {
      id: chain.pullId,
      name: chain.pullName,
      // One order per client at a time (daily and backfill share this lock),
      // and at most 3 orders in flight overall.
      concurrency: [
        { key: 'event.data.client_id', limit: 1 },
        { limit: 3 },
      ],
      // Re-runs only the failed step. A step that still fails is closed by the body itself; onFailure covers the
      // function dying outside that path and closes exactly this order's receipt and run-log row (fixed id).
      retries: 2,
      onFailure: async ({ event, error }) => {
        const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
        await handlePullFailure(deps.supabase, {
          runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
          message: error?.message || 'unknown error',
          failedAt,
        }, deps.dataset ?? PAGE_DATASET)
      },
    },
    { event: chain.eventName },
    async ({ event, step, runId }) => {
      const parsed = parsePullDue(event.data)
      if (!parsed.ok) return { status: 'invalid_payload' as const, reason: parsed.reason }
      const pullStep: PullStep = {
        // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
        run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
      }
      return runPageDailyPull(pullStep, deps, parsed.value, {
        runId,
        eventId: typeof event.id === 'string' ? event.id : null,
      })
    },
  )
}

/** Production instances. */
export const gscPageDailyFanOut = createGscPageDailyFanOutFunction({
  buildPlan: (today) => buildPageDailyPlan(supabaseAdmin, today),
})

export const gscPageDailyPull = createGscPageDailyPullFunction(defaultPullDeps())

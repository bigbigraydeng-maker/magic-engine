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
 * Every side effect happens inside a step: Inngest replays the function body
 * after each step boundary, and code outside steps runs again on every replay.
 *
 * Read-only towards Google, never publishes anything (`no_publish: true`).
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { fetchFinalizedDayRange, querySearchAnalyticsRows, withGscAccess } from '@/lib/gsc/client'
import { loadGscConnectedClients } from '@/lib/gsc/connected-clients'
import {
  GSC_PAGE_DAILY_CRON,
  GSC_PAGE_DAILY_JOB,
  GSC_PAGE_DAILY_PULL_EVENT,
  GSC_PAGE_DAILY_TZ,
  pacificDay,
  parsePullDue,
  pullEventId,
  type PullOrder,
} from '@/lib/gsc/page-daily-plan'
import { buildPageDailyPlan, type PlanResult } from '@/lib/gsc/page-daily-store'
import { handlePullFailure, runPageDailyPull, type PullDeps, type PullStep } from '@/lib/gsc/page-daily-pull'

export const GSC_PAGE_DAILY_FANOUT_ID = `${CLOUD_FN_PREFIX}gsc-page-daily-fanout`
export const GSC_PAGE_DAILY_PULL_ID = `${CLOUD_FN_PREFIX}gsc-page-daily-pull`

/** The dispatch receipt — also what the Inngest dashboard shows for a fan-out run. */
export interface FanOutReceipt {
  readonly job: string
  readonly today: string
  readonly status: 'dispatched' | 'plan_failed' | 'nothing_to_do'
  readonly clients: number
  readonly orders_dispatched: number
  readonly daily_orders: number
  readonly backfill_orders: number
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
export function buildPullEvents(orders: readonly PullOrder[]): PullEvent[] {
  return orders.map((o) => ({
    id: pullEventId(o),
    name: GSC_PAGE_DAILY_PULL_EVENT,
    data: { client_id: o.client_id, kind: o.kind, start_day: o.start_day, end_day: o.end_day },
  }))
}

/** Run one dispatch: plan, send one event per order, write one run log. */
export async function runGscPageDailyFanOut(step: FanOutStep, deps: FanOutDeps): Promise<FanOutReceipt> {
  // "today" must be computed inside a step: a replay after midnight Pacific
  // would otherwise plan a different day than the one the run log records.
  const started = await step.run('log-start', async () => ({
    runLogId: await startCronRunId(GSC_PAGE_DAILY_JOB),
    startedAt: Date.now(),
    today: pacificDay(new Date()),
    createdAt: new Date().toISOString(),
  }))
  const run = cronRunHandle(GSC_PAGE_DAILY_JOB, started.runLogId, started.startedAt)
  const base = {
    job: GSC_PAGE_DAILY_JOB,
    today: started.today,
    no_publish: true as const,
    created_at: started.createdAt,
  }

  const plan = await step.run('plan', async () => deps.buildPlan(started.today))

  if (!plan.ok) {
    await step.run('log-finish-plan-failed', async () => {
      await run.finish({ processed: 0, completed: 0, failed: 1, error: `plan failed: ${plan.reason}` })
      return null
    })
    return {
      ...base,
      status: 'plan_failed',
      clients: 0,
      orders_dispatched: 0,
      daily_orders: 0,
      backfill_orders: 0,
      error: plan.reason,
    }
  }

  const events = buildPullEvents(plan.orders)
  const dailyOrders = plan.orders.filter((o) => o.kind === 'daily').length
  const backfillOrders = events.length - dailyOrders

  if (events.length === 0) {
    await step.run('log-finish-empty', async () => {
      await run.finish({
        processed: 0,
        completed: 0,
        failed: 0,
        summary: { today: started.today, clients: plan.clients },
      })
      return null
    })
    return {
      ...base,
      status: 'nothing_to_do',
      clients: plan.clients,
      orders_dispatched: 0,
      daily_orders: 0,
      backfill_orders: 0,
      error: null,
    }
  }

  await step.sendEvent('dispatch-pulls', events)

  // These are dispatch counts, not pull results: each order writes its own
  // receipt and its own run log when it actually runs.
  await step.run('log-finish-dispatched', async () => {
    await run.finish({
      processed: events.length,
      completed: events.length,
      failed: 0,
      summary: {
        today: started.today,
        counts_are: 'dispatched_not_pulled',
        clients: plan.clients,
        daily_orders: dailyOrders,
        backfill_orders: backfillOrders,
      },
    })
    return null
  })
  return {
    ...base,
    status: 'dispatched',
    clients: plan.clients,
    orders_dispatched: events.length,
    daily_orders: dailyOrders,
    backfill_orders: backfillOrders,
    error: null,
  }
}

/** Dependency-injected fan-out, so tests can inject a fake plan and a fake step. */
export function createGscPageDailyFanOutFunction(deps: FanOutDeps) {
  return inngest.createFunction(
    {
      id: GSC_PAGE_DAILY_FANOUT_ID,
      name: 'GSC per-page daily: dispatch pull orders',
      // Two dispatches at once would plan and send the same orders twice; the
      // deterministic event ids absorb that within 24 h, but the run log would
      // then show dispatch counts that are not real.
      concurrency: { limit: 1 },
      retries: 2,
    },
    { cron: `TZ=${GSC_PAGE_DAILY_TZ} ${GSC_PAGE_DAILY_CRON}` },
    async ({ step }): Promise<FanOutReceipt> =>
      runGscPageDailyFanOut(
        {
          // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
          run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
          sendEvent: (id, events) => step.sendEvent(id, events),
        },
        deps,
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
export function createGscPageDailyPullFunction(deps: PullDeps) {
  return inngest.createFunction(
    {
      id: GSC_PAGE_DAILY_PULL_ID,
      name: 'GSC per-page daily: pull one order',
      // One order per client at a time (daily and backfill share this lock),
      // and at most 3 orders in flight overall.
      concurrency: [
        { key: 'event.data.client_id', limit: 1 },
        { limit: 3 },
      ],
      // Re-runs only the failed step. A step that still fails is closed by the
      // body itself; onFailure only covers the function dying outside that path.
      retries: 2,
      onFailure: async ({ event, error }) => {
        const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
        await handlePullFailure(deps.supabase, {
          runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
          message: error?.message || 'unknown error',
          failedAt,
        })
      },
    },
    { event: GSC_PAGE_DAILY_PULL_EVENT },
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

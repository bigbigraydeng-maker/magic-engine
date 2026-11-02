/**
 * Magic Engine 2.0 · Inngest cloud consumers of the triggered-send SHADOW run (rehearsal).
 *
 * Two functions, one dispatches and one works:
 *   · `cloud-triggered-send-welcome-dispatch` — runs at 09:00 and again at 11:00 Pacific/Auckland (two cron triggers),
 *     lists the clients with an open welcome-email proposal, sends one
 *     `crm.triggered_send.sweep_requested` per client, and ends. It calls no provider itself.
 *   · `cloud-triggered-send-welcome-sweep` — takes one client and sweeps it in steps: one `prepare` step, then one
 *     step per chunk of at most CHUNK_SIZE contacts, then the run log.
 *
 * 🔴 **Nothing is ever sent**: the sweep only writes shadow rows (`no_send: true`).
 *
 * 🔴 **Why steps of a few contacts**: Render cuts a request after roughly two minutes; one step that loops over every
 *    new lead (10–30 a day) would be killed. Each chunk step writes its rows the moment they are decided and no
 *    personal data travels between steps (only contact ids and counters).
 *
 * 🔴 **Why 09:00, not 08:01**: the old daily batch goes out at 08:01 and Mailchimp's per-recipient report of it needs
 *    a little while to settle; reading it too early would freeze "not welcomed" for people who were.
 *
 * 🔴 **Two runs a day on purpose**: the second run retries what failed to read in the first.
 *    De-duplication is by the shadow rows themselves, not by event ids.
 *
 * 🔴 **One run time for all clients** (Pacific/Auckland) is a documented limitation of this
 *    first version.
 *
 * 🔴 **Run logs**: the dispatch writes one row per run under 'triggered-send-welcome-dispatch';
 *    every sweep order writes its own row under 'triggered-send-welcome-sweep'. Both row ids are
 *    derived from the Inngest run id, so each function's onFailure closes exactly its own row.
 *
 * Every side effect happens inside a step: Inngest replays the function body after each step
 * boundary, and code outside steps runs again on every replay.
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import {
  cronRunHandle,
  cronRunIdFromInngestRun,
  finishCronRunIfOpen,
  startCronRunWithId,
  type CronRunFinishOpts,
} from '@/lib/cron/run-logger'
import { createMailNewStore, graphGetPage } from '@/lib/microsoft/mail-send-new-prod'
import {
  listClientsWithOpenAuthorization,
  loadOpenAuthorization,
  loadLeadContacts,
  loadContactsByIds,
  checkRequiredMailboxes,
} from '@/lib/messaging/triggered-send/shadow-reads-prod'
import { findContactsWithShadowRows, insertShadowRows } from '@/lib/messaging/triggered-send/shadow-store'
import { createShadowGatePorts } from '@/lib/messaging/triggered-send/shadow-ports-prod'
import {
  chunkIds,
  decideChunk,
  finalizeSweep,
  prepareSweep,
  type SweepDeps,
} from '@/lib/messaging/triggered-send/shadow-sweep'
import type { ChunkResult, PrepareResult, SweepPlan, SweepReceipt } from '@/lib/messaging/triggered-send/types'
import {
  CRM_TRIGGERED_SEND_SWEEP_REQUESTED,
  buildSweepEvent,
  parseSweepRequest,
  sweepSlot,
  type SweepEvent,
} from '../triggered-send-events'

export const TRIGGERED_SEND_DISPATCH_JOB = 'triggered-send-welcome-dispatch'
export const TRIGGERED_SEND_SWEEP_JOB = 'triggered-send-welcome-sweep'
export const TRIGGERED_SEND_DISPATCH_ID = `${CLOUD_FN_PREFIX}triggered-send-welcome-dispatch`
export const TRIGGERED_SEND_SWEEP_ID = `${CLOUD_FN_PREFIX}triggered-send-welcome-sweep`
/** The morning run, 09:00 local time. This is the schedule the cron registry watches. */
export const TRIGGERED_SEND_SWEEP_CRON = '0 9 * * *'
/** The second run, 11:00 local time: retries what failed to read in the morning run. */
export const TRIGGERED_SEND_RETRY_CRON = '0 11 * * *'
/** One run time for all clients in this first version (documented limitation). */
export const TRIGGERED_SEND_SWEEP_TZ = 'Pacific/Auckland'

/** The two step tools the orchestrators need (tests pass a fake). */
export interface StepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sendEvent(id: string, events: SweepEvent[]): Promise<unknown>
}

/** The dispatch receipt — also what the Inngest dashboard shows for a dispatch run. */
export interface DispatchReceipt {
  job: string
  status: 'dispatched' | 'nothing_to_do' | 'list_failed'
  slot: string
  clients: number
  events_sent: number
  no_send: true
  error: string | null
  created_at: string
}

export interface DispatchDeps {
  startRun(runLogId: string): Promise<void>
  finishRun(runLogId: string, startedAtMs: number, opts: CronRunFinishOpts): Promise<void>
  listClients(): Promise<{ ok: true; clientIds: string[] } | { ok: false; error: string }>
  now(): Date
}

/** Run one dispatch: list clients, send one event per client, write one run log. */
export async function runDispatch(step: StepTools, deps: DispatchDeps, runId: string): Promise<DispatchReceipt> {
  // "slot" must be computed inside a step: a replay after the hour boundary would otherwise
  // plan a different slot than the one the run log records.
  const started = await step.run('log-start', async () => {
    const runLogId = cronRunIdFromInngestRun(runId)
    await deps.startRun(runLogId)
    const now = deps.now()
    return {
      runLogId,
      startedAtMs: now.getTime(),
      slot: sweepSlot(now, TRIGGERED_SEND_SWEEP_TZ),
      createdAt: now.toISOString(),
    }
  })

  const listed = await step.run('list-clients', async () => deps.listClients())
  if (!listed.ok) {
    const error = `list failed: ${listed.error}`
    await step.run('log-finish-list-failed', async () => {
      await deps.finishRun(started.runLogId, started.startedAtMs, {
        processed: 0,
        completed: 0,
        failed: 1,
        error,
      })
      return null
    })
    return {
      job: TRIGGERED_SEND_DISPATCH_JOB,
      status: 'list_failed',
      slot: started.slot,
      clients: 0,
      events_sent: 0,
      no_send: true,
      error,
      created_at: started.createdAt,
    }
  }

  const clientIds = listed.clientIds
  if (clientIds.length === 0) {
    await step.run('log-finish-empty', async () => {
      await deps.finishRun(started.runLogId, started.startedAtMs, {
        processed: 0,
        completed: 0,
        failed: 0,
        summary: { slot: started.slot, clients: 0 },
      })
      return null
    })
    return {
      job: TRIGGERED_SEND_DISPATCH_JOB,
      status: 'nothing_to_do',
      slot: started.slot,
      clients: 0,
      events_sent: 0,
      no_send: true,
      error: null,
      created_at: started.createdAt,
    }
  }

  const events = clientIds.map((id) => buildSweepEvent({ clientId: id, slot: started.slot }))
  await step.sendEvent('dispatch-sweeps', events)
  await step.run('log-finish-dispatched', async () => {
    await deps.finishRun(started.runLogId, started.startedAtMs, {
      processed: events.length,
      completed: events.length,
      failed: 0,
      summary: { slot: started.slot, clients: events.length, counts_are: 'dispatched_not_swept' },
    })
    return null
  })
  return {
    job: TRIGGERED_SEND_DISPATCH_JOB,
    status: 'dispatched',
    slot: started.slot,
    clients: events.length,
    events_sent: events.length,
    no_send: true,
    error: null,
    created_at: started.createdAt,
  }
}

export interface SweepRunDeps {
  startRun(runLogId: string): Promise<void>
  finishRun(runLogId: string, startedAtMs: number, opts: CronRunFinishOpts): Promise<void>
  prepare(args: { clientId: string; dryRun: boolean }): Promise<PrepareResult>
  decideChunk(args: { plan: SweepPlan; kind: 'candidates' | 'stale'; contactIds: string[] }): Promise<ChunkResult>
  finalize(plan: SweepPlan, results: ChunkResult[]): SweepReceipt
  now(): Date
}

export type SweepOrderResult = SweepReceipt | { status: 'invalid_payload'; reason: string }

/**
 * Run one sweep order as steps: parse, prepare, one step per chunk of contacts (stale ones first), one run log.
 * Step ids are deterministic (`decide-<kind>-<n>`) so a replay finds the finished chunks.
 */
export async function runSweepOrder(
  step: Pick<StepTools, 'run'>,
  deps: SweepRunDeps,
  data: unknown,
  runId: string,
): Promise<SweepOrderResult> {
  const parsed = parseSweepRequest(data)
  if (!parsed.ok) return { status: 'invalid_payload', reason: parsed.reason }

  const started = await step.run('log-start', async () => {
    const runLogId = cronRunIdFromInngestRun(runId)
    await deps.startRun(runLogId)
    return { runLogId, startedAtMs: deps.now().getTime() }
  })

  const prepared = await step.run('prepare', async () => deps.prepare({ clientId: parsed.clientId, dryRun: parsed.dryRun }))

  let receipt: SweepReceipt
  if (prepared.kind === 'done') {
    receipt = prepared.receipt
  } else {
    const plan = prepared.plan
    const jobs = [
      ...chunkIds(plan.staleIds).map((contactIds) => ({ kind: 'stale' as const, contactIds })),
      ...chunkIds(plan.candidateIds).map((contactIds) => ({ kind: 'candidates' as const, contactIds })),
    ]
    const results: ChunkResult[] = []
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index]
      results.push(
        await step.run(`decide-${job.kind}-${index}`, async () =>
          deps.decideChunk({ plan, kind: job.kind, contactIds: job.contactIds }),
        ),
      )
    }
    receipt = deps.finalize(plan, results)
  }

  await step.run('log-finish', async () => {
    await deps.finishRun(started.runLogId, started.startedAtMs, sweepFinishOpts(receipt))
    return null
  })

  return receipt
}

/**
 * The sweep row's finish options: deferred contacts count as failed items; 'swept' and
 * 'no_open_proposal' are normal completions (no error), every other status carries its error.
 */
export function sweepFinishOpts(receipt: SweepReceipt): CronRunFinishOpts {
  const isNormal = receipt.status === 'swept' || receipt.status === 'no_open_proposal'
  const opts: CronRunFinishOpts = {
    processed: receipt.to_decide,
    completed: receipt.decided,
    failed: receipt.deferred,
    summary: { ...receipt },
  }
  if (!isNormal) opts.error = receipt.error ?? `sweep status: ${receipt.status}`
  return opts
}

/** The onFailure of both functions: close exactly this run's run-log row. Never throws. */
export async function handleTriggeredSendFailure(
  input: { job: string; runId: string | null; message: string; failedAt: Date },
  closeRun: typeof finishCronRunIfOpen = finishCronRunIfOpen,
): Promise<'closed' | 'already_terminal' | 'no_run_id'> {
  if (!input.runId) {
    console.error(`[triggered-send] ${input.job} onFailure without a run id — nothing closed:`, input.message)
    return 'no_run_id'
  }
  return closeRun(
    input.job,
    cronRunIdFromInngestRun(input.runId),
    { processed: 0, completed: 0, failed: 1, error: `retries exhausted: ${input.message}` },
    input.failedAt,
  )
}

/** The production sweep dependencies. Built at handler time, never at module load. */
export function createProdSweepDeps(): SweepDeps {
  const store = createMailNewStore()
  return {
    now: () => new Date(),
    loadAuthorization: (clientId) => loadOpenAuthorization(supabaseAdmin, clientId),
    loadContacts: (a) => loadLeadContacts(supabaseAdmin, a),
    loadContactsByIds: (a) => loadContactsByIds(supabaseAdmin, a),
    findContactsWithShadowRows: (clientId, ids) => findContactsWithShadowRows(supabaseAdmin, clientId, ids),
    checkMailboxes: (clientId, required) => checkRequiredMailboxes(store.listActiveMailboxes, clientId, required),
    createPorts: ({ clientId, rule, now }) =>
      createShadowGatePorts({
        db: supabaseAdmin,
        clientId,
        rule,
        now,
        listActiveMailboxes: store.listActiveMailboxes,
        graphGetPage,
      }),
    insertShadowRows: (rows) => insertShadowRows(supabaseAdmin, rows),
  }
}

/** The dispatch: cron, one run at a time, one run log per run. */
export const triggeredSendWelcomeDispatch = inngest.createFunction(
  {
    id: TRIGGERED_SEND_DISPATCH_ID,
    name: 'Triggered send (welcome): dispatch shadow sweeps',
    // Two dispatches at once would send the same orders twice; the deterministic event ids
    // absorb that within 24 h, but the run log would then show dispatch counts that are not real.
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
      await handleTriggeredSendFailure({
        job: TRIGGERED_SEND_DISPATCH_JOB,
        runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
        message: error?.message || 'unknown error',
        failedAt,
      })
    },
  },
  [
    { cron: `TZ=${TRIGGERED_SEND_SWEEP_TZ} ${TRIGGERED_SEND_SWEEP_CRON}` },
    { cron: `TZ=${TRIGGERED_SEND_SWEEP_TZ} ${TRIGGERED_SEND_RETRY_CRON}` },
  ],
  async ({ step, runId }): Promise<DispatchReceipt> =>
    runDispatch(
      {
        // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
        run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
        sendEvent: (id, events) => step.sendEvent(id, events),
      },
      {
        startRun: (id) => startCronRunWithId(TRIGGERED_SEND_DISPATCH_JOB, id),
        finishRun: (id, startedAtMs, opts) => cronRunHandle(TRIGGERED_SEND_DISPATCH_JOB, id, startedAtMs).finish(opts),
        listClients: () => listClientsWithOpenAuthorization(supabaseAdmin),
        now: () => new Date(),
      },
      runId,
    ),
)

/** The sweep worker: one order per client at a time, at most 2 orders in flight overall; each order runs in steps. */
export const triggeredSendWelcomeSweep = inngest.createFunction(
  {
    id: TRIGGERED_SEND_SWEEP_ID,
    name: 'Triggered send (welcome): shadow sweep of one client',
    concurrency: [{ key: 'event.data.client_id', limit: 1 }, { limit: 2 }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
      await handleTriggeredSendFailure({
        job: TRIGGERED_SEND_SWEEP_JOB,
        runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
        message: error?.message || 'unknown error',
        failedAt,
      })
    },
  },
  { event: CRM_TRIGGERED_SEND_SWEEP_REQUESTED },
  async ({ event, step, runId }): Promise<SweepOrderResult> =>
    runSweepOrder(
      {
        // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
        run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
      },
      {
        startRun: (id) => startCronRunWithId(TRIGGERED_SEND_SWEEP_JOB, id),
        finishRun: (id, startedAtMs, opts) => cronRunHandle(TRIGGERED_SEND_SWEEP_JOB, id, startedAtMs).finish(opts),
        prepare: ({ clientId, dryRun }) => prepareSweep({ clientId, dryRun, deps: createProdSweepDeps() }),
        decideChunk: ({ plan, kind, contactIds }) => decideChunk({ plan, kind, contactIds, deps: createProdSweepDeps() }),
        finalize: finalizeSweep,
        now: () => new Date(),
      },
      event.data,
      runId,
    ),
)

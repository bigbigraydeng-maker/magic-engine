/**
 * CRM: auto-clear "do not contact" when the customer came back on their own.
 *
 * Runs every 15 minutes, New Zealand time. For every client with at least one DNC contact, we load the
 * candidates and ask `decideReengageClear` whether the customer re-engaged after the DNC was set.
 * Form / answered inbound call → clear (touchpoint + mirror column). DM / real email reply → only listed in the
 * run summary (`reviews`) for a person to look at; never cleared automatically in this first version.
 * A mirror column still true while the judge already says "not do-not-contact" is put down (repair).
 *
 * Rehearsal is the default: unless the client id is listed in `CRM_DNC_REENGAGE_WRITE_CLIENTS`
 * (comma-separated, lower-cased), the sweep only records what it *would* clear and writes nothing.
 *
 * `retries: 1` is safe: every write is idempotent by `source_ref`, and each write re-reads the contact first.
 * `concurrency: 1`: two sweeps must never overlap.
 *
 * After deploy, re-Sync the Inngest app so the new cron is registered.
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
import { decideReengageClear, type ReengageDecision } from '@/lib/crm/dnc-reengage'
import {
  applyReengageClear,
  loadReengageCandidates,
  releaseMirror,
  type ApplyResult,
  type ReengageCandidate,
} from '@/lib/crm/dnc-reengage-store'

export const CRM_DNC_REENGAGE_FUNCTION_ID = `${CLOUD_FN_PREFIX}crm-dnc-reengage-sweep`
export const CRM_DNC_REENGAGE_JOB = 'crm-dnc-reengage-sweep'
/** Every 15 minutes. The registry entry copies this without the TZ prefix. */
export const CRM_DNC_REENGAGE_CRON = 'TZ=Pacific/Auckland */15 * * * *'
export const CRM_DNC_REENGAGE_CLEARED_EVENT = 'crm.dnc.reengage_cleared'
export const CRM_DNC_REENGAGE_WRITE_ENV = 'CRM_DNC_REENGAGE_WRITE_CLIENTS'

/** Comma-separated client ids allowed to really write; unset/empty = rehearsal for everyone. Lower-cased, trimmed. */
export function writeClientsFromEnv(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!raw) return out
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase()
    if (id) out.add(id)
  }
  return out
}

export interface ClearRecord {
  contactId: string
  triggerKind: string
  triggerAt: string
  dncAt: string
  written: boolean
  touchpointId: string | null
}

/** Came back by DM / real email reply only — listed for a person to look at, never cleared automatically. */
export interface ReviewRecord {
  contactId: string
  triggerKind: string
  triggerAt: string
  dncAt: string
}

export interface ClientSweepResult {
  clientId: string
  rehearsal: boolean
  checked: number
  wouldClear: number
  cleared: number
  /** Re-read just before writing disagreed (a newer verdict arrived) — skipped. */
  skippedOnReread: number
  /** contacts.do_not_contact was still true although the judge says not do-not-contact — put down. */
  mirrorRepaired: number
  why: Record<string, number>
  clears: ClearRecord[]
  reviews: ReviewRecord[]
  error: string | null
}

export interface ReengageSweepDeps {
  startRun(runLogId: string): Promise<void>
  finishRun(runLogId: string, startedAtMs: number, opts: CronRunFinishOpts): Promise<void>
  listClients(): Promise<string[]>
  loadCandidates(clientId: string): Promise<ReengageCandidate[]>
  applyClear(clientId: string, contactId: string, decision: ClearDecision): Promise<ApplyResult>
  repairMirror(clientId: string, contactId: string): Promise<void>
  sendCleared(event: { id: string; name: string; data: Record<string, unknown> }): Promise<void>
  writeClients(): Set<string>
  now(): Date
}

type ClearDecision = Extract<ReengageDecision, { clear: true }>

export interface StepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'UNKNOWN_ERROR'
}

function emptyResult(clientId: string, rehearsal: boolean): ClientSweepResult {
  return {
    clientId,
    rehearsal,
    checked: 0,
    wouldClear: 0,
    cleared: 0,
    skippedOnReread: 0,
    mirrorRepaired: 0,
    why: {},
    clears: [],
    reviews: [],
    error: null,
  }
}

async function writeClear(
  clientId: string,
  c: ReengageCandidate,
  d: ClearDecision,
  deps: ReengageSweepDeps,
  result: ClientSweepResult,
): Promise<void> {
  const applied = await deps.applyClear(clientId, c.contactId, d)
  if (!applied.written) {
    result.skippedOnReread++
    return
  }
  result.cleared++
  result.clears.push({ contactId: c.contactId, triggerKind: d.trigger.kind, triggerAt: d.trigger.at, dncAt: d.dncAt, written: true, touchpointId: applied.touchpointId })
  // Sent even when the touchpoint already existed (null id): the deterministic id lets Inngest drop duplicates.
  await deps.sendCleared({
    id: `dnc-reengage:${c.contactId}:${d.trigger.ref}`,
    name: CRM_DNC_REENGAGE_CLEARED_EVENT,
    data: {
      client_id: clientId,
      contact_id: c.contactId,
      touchpoint_id: applied.touchpointId,
      trigger_kind: d.trigger.kind,
      trigger_ref: d.trigger.ref,
      dnc_at: d.dncAt,
      rehearsal: false,
    },
  })
}

async function handleCandidate(
  clientId: string,
  c: ReengageCandidate,
  deps: ReengageSweepDeps,
  result: ClientSweepResult,
): Promise<void> {
  result.checked++
  const d = decideReengageClear(c.input)
  if (d.clear) {
    result.why.clear = (result.why.clear ?? 0) + 1
    result.wouldClear++
    if (result.rehearsal) {
      result.clears.push({ contactId: c.contactId, triggerKind: d.trigger.kind, triggerAt: d.trigger.at, dncAt: d.dncAt, written: false, touchpointId: null })
      return
    }
    await writeClear(clientId, c, d, deps, result)
    return
  }
  result.why[d.why] = (result.why[d.why] ?? 0) + 1
  if (d.why === 'needs_review') {
    result.reviews.push({ contactId: c.contactId, triggerKind: d.trigger.kind, triggerAt: d.trigger.at, dncAt: d.dncAt })
  } else if (d.why === 'not_dnc' && c.input.contactFlag && !result.rehearsal) {
    await deps.repairMirror(clientId, c.contactId)
    result.mirrorRepaired++
  }
}

export async function sweepOneClient(clientId: string, deps: ReengageSweepDeps): Promise<ClientSweepResult> {
  const result = emptyResult(clientId, !deps.writeClients().has(clientId.toLowerCase()))
  try {
    const candidates = await deps.loadCandidates(clientId)
    for (const c of candidates) await handleCandidate(clientId, c, deps, result)
  } catch (error: unknown) {
    result.error = errorMessage(error)
  }
  return result
}

export function sweepFinishOpts(results: ClientSweepResult[]): CronRunFinishOpts {
  let processed = 0
  let completed = 0
  let failed = 0
  let wouldClear = 0
  let cleared = 0
  let needsReview = 0
  let mirrorRepaired = 0
  let skippedOnReread = 0
  const why: Record<string, number> = {}
  const errors: string[] = []

  for (const r of results) {
    processed += r.checked
    wouldClear += r.wouldClear
    cleared += r.cleared
    needsReview += r.reviews.length
    mirrorRepaired += r.mirrorRepaired
    skippedOnReread += r.skippedOnReread
    for (const [k, v] of Object.entries(r.why)) why[k] = (why[k] ?? 0) + v
    if (r.error) {
      failed++
      errors.push(`${r.clientId}: ${r.error}`)
    } else {
      completed += r.checked
    }
  }

  const opts: CronRunFinishOpts = {
    processed,
    completed,
    failed,
    summary: {
      clients_scanned: results.length,
      contacts_checked: processed,
      would_clear: wouldClear,
      cleared,
      needs_review: needsReview,
      mirror_repaired: mirrorRepaired,
      skipped_on_reread: skippedOnReread,
      why,
      per_client: results,
    },
  }
  if (errors.length > 0) opts.error = errors.join('; ').slice(0, 500)
  return opts
}

export async function runReengageSweep(
  step: StepTools,
  deps: ReengageSweepDeps,
  runId: string,
): Promise<{ clients: number; would_clear: number; cleared: number }> {
  const started = await step.run('log-start', async () => {
    const runLogId = cronRunIdFromInngestRun(runId)
    await deps.startRun(runLogId)
    return { runLogId, startedAtMs: deps.now().getTime() }
  })

  const clientIds = await step.run('list-clients', () => deps.listClients())

  const results: ClientSweepResult[] = []
  for (const clientId of clientIds) {
    results.push(await step.run(`client-${clientId}`, () => sweepOneClient(clientId, deps)))
  }

  await step.run('log-finish', async () => {
    await deps.finishRun(started.runLogId, started.startedAtMs, sweepFinishOpts(results))
    return null
  })

  let wouldClear = 0
  let cleared = 0
  for (const r of results) {
    wouldClear += r.wouldClear
    cleared += r.cleared
  }
  return { clients: results.length, would_clear: wouldClear, cleared }
}

/**
 * Clients with anyone who may currently be do-not-contact: the mirror column OR a do-not-contact touchpoint.
 * The column alone is not enough — `isDoNotContact` reads touchpoints, and 2026-11-08 CTS had 7 people whose
 * column was false while a touchpoint still said do-not-contact.
 */
export async function listClientsWithDnc(): Promise<string[]> {
  const seen = new Set<string>()
  await collectClientIds(seen, 'contacts', (q) => q.eq('do_not_contact', true))
  await collectClientIds(seen, 'contact_touchpoints', (q) =>
    q.or('metadata->>outcome.eq.do_not_contact,metadata->>do_not_contact.eq.true'),
  )
  return Array.from(seen)
}

type ClientIdQuery = ReturnType<ReturnType<typeof supabaseAdmin.from>['select']>

async function collectClientIds(
  seen: Set<string>,
  table: 'contacts' | 'contact_touchpoints',
  filter: (q: ClientIdQuery) => ClientIdQuery,
): Promise<void> {
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await filter(supabaseAdmin.from(table).select('client_id'))
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`listClientsWithDnc(${table}): ${error.message}`)
    const rows = (data ?? []) as { client_id: unknown }[]
    for (const row of rows) {
      if (typeof row.client_id === 'string' && row.client_id) seen.add(row.client_id)
    }
    if (rows.length < pageSize) break
  }
}

export async function handleReengageFailure(
  input: { runId: string | null; message: string; failedAt: Date },
  closeRun: typeof finishCronRunIfOpen = finishCronRunIfOpen,
): Promise<'closed' | 'already_terminal' | 'no_run_id'> {
  if (!input.runId) {
    console.error('[crm-dnc-reengage-sweep] onFailure without run_id', input.message)
    return 'no_run_id'
  }
  return closeRun(
    CRM_DNC_REENGAGE_JOB,
    cronRunIdFromInngestRun(input.runId),
    { processed: 0, completed: 0, failed: 1, error: `retries exhausted: ${input.message}` },
    input.failedAt,
  )
}

export function createProdReengageDeps(): ReengageSweepDeps {
  return {
    startRun: (id) => startCronRunWithId(CRM_DNC_REENGAGE_JOB, id),
    finishRun: (id, startedAtMs, opts) => cronRunHandle(CRM_DNC_REENGAGE_JOB, id, startedAtMs).finish(opts),
    listClients: listClientsWithDnc,
    loadCandidates: loadReengageCandidates,
    applyClear: (clientId, contactId, decision) => applyReengageClear(clientId, contactId, decision),
    repairMirror: (clientId, contactId) => releaseMirror(clientId, contactId),
    sendCleared: async (event) => {
      await inngest.send(event)
    },
    writeClients: () => writeClientsFromEnv(process.env[CRM_DNC_REENGAGE_WRITE_ENV]),
    now: () => new Date(),
  }
}

export const crmDncReengageSweep = inngest.createFunction(
  {
    id: CRM_DNC_REENGAGE_FUNCTION_ID,
    name: 'CRM: auto-clear do-not-contact when the customer comes back',
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ event, error }) => {
      const failedAt = 'ts' in event && typeof event.ts === 'number' ? new Date(event.ts) : new Date()
      await handleReengageFailure({
        runId: typeof event.data.run_id === 'string' ? event.data.run_id : null,
        message: error?.message || 'unknown error',
        failedAt,
      })
    },
  },
  { cron: CRM_DNC_REENGAGE_CRON },
  async ({ step, runId }) =>
    runReengageSweep(
      // Every step result here is plain JSON, so Jsonify<T> has the same shape as T.
      { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> },
      createProdReengageDeps(),
      runId,
    ),
)

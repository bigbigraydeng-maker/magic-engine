/**
 * Reel 定时发布编排。每 30 分钟醒一次：总开关 WEEKLY_PACK_REEL_SCHEDULED_PUBLIC 不是 'true' 就只写一行 disabled 回执；
 * 到了客户的发布时点（默认新西兰 18:00，客户配置 weekly_pack.publish_hour 可改）才处理当天已授权的 Reel。
 * 客户开关 publish_live.reel_public 不是真，就只演练（不写公开），并留一条调度记录。
 * 真公开后只记下帖子编号和时间，不发「已公开去建广告」的通知。
 * 每条一个步骤、不重试；手动事件只演练；新增函数部署后必须去 Inngest 后台 Sync 一次。
 */
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { listWeeklyLoopClients } from '@/lib/social/weekly-loop/run-deps'
import { DEFAULT_PUBLISH_HOUR, publishHourOf } from '@/lib/factory/publish/promote/scheduled-grant'
import { runScheduledPromote, type ScheduledResult } from '@/lib/factory/publish/promote/scheduled-action'
import { createProductionPromoteDeps } from '@/lib/factory/publish/promote/deps'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { nzToday } from '@/lib/factory/publish/promote/scheduled-grant'
import { readPublishLive } from '@/lib/social/publish-gate/read-live'
import { writePublishDispatchReceipt, type PublishDispatchReceipt } from '@/lib/social/publish-gate/receipt'
import { noteReelResults } from '@/lib/social/publish-gate/reel-note'
import { loadReelPublishedRef } from '@/lib/social/publish-gate/reel-ref'

export const REEL_SCHEDULED_FUNCTION_ID = `${CLOUD_FN_PREFIX}reel-scheduled-go-public`
export const REEL_SCHEDULED_CRON = 'TZ=Pacific/Auckland */30 * * * *'
export const REEL_SCHEDULED_EVENT = 'social/reel.scheduled_go_public.due'
export const REEL_SCHEDULED_JOB = 'reel-scheduled-go-public'
export { DEFAULT_PUBLISH_HOUR, publishHourOf }

export type ReelEnv = Readonly<Record<string, string | undefined>>

export function scheduledPublicEnabled(env: ReelEnv): boolean {
  return env.WEEKLY_PACK_REEL_SCHEDULED_PUBLIC === 'true'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const NZ_HOUR_FMT = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', hourCycle: 'h23' })
const NZ_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })

/** NZ wall-clock hour for an instant (Intl, Pacific/Auckland, hourCycle h23). */
export function nzHour(now: Date): number {
  const parts = NZ_HOUR_FMT.formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '0'
  return Number.parseInt(hour, 10)
}

function nzDate(now: Date): string {
  return NZ_DATE_FMT.format(now)
}

function errorMessage(e: unknown, max: number): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.slice(0, max)
}

export interface ReelScheduledDeps {
  env: () => ReelEnv
  now: () => Date
  listClients: () => Promise<Array<{ id: string; config: unknown }>>
  /** Work order ids whose traffic row holds a grant with status armed or claimed and publish_on <= today. */
  loadDueOrderIds: (clientId: string, today: string) => Promise<string[]>
  runOne: (orderId: string, opts: { dryRun: boolean; executedBy: string; asOf?: string }) => Promise<ScheduledResult>
  startRun: () => Promise<string>
  /** Absent means the client is not cleared to publish. */
  clientPublishLive?: (clientId: string) => Promise<boolean>
  recordDispatch?: (receipt: PublishDispatchReceipt) => Promise<void>
  loadPublishedRef?: (orderId: string) => Promise<{ postId: string; publishedAt: string } | null>
  finishRun: (input: {
    runId: string
    startedAt: number
    processed: number
    completed: number
    failed: number
    summary: Record<string, unknown>
    error?: string
  }) => Promise<void>
}

export interface ClientReceipt {
  client_id: string
  due: number
  results: ScheduledResult[]
  error: string | null
}

export interface TickReceipt {
  kind: 'tick'
  status: 'disabled' | 'done' | 'list_failed'
  nz_date: string
  dry_run: boolean
  clients: ClientReceipt[]
  no_publish: boolean
  failures: string[]
}

type StepLike = GetStepTools<typeof inngest>

function failedResult(orderId: string, e: unknown): ScheduledResult {
  return { order_id: orderId, outcome: 'failed', reason: errorMessage(e, 200), needs_person: true }
}

async function runOrders(
  deps: ReelScheduledDeps,
  step: StepLike,
  orderIds: readonly string[],
  dryRun: boolean,
  executedBy: string,
  asOf?: string,
): Promise<ScheduledResult[]> {
  const results: ScheduledResult[] = []
  for (const orderId of orderIds) {
    const r = await step.run(`reel-${orderId}`, async () => {
      try {
        return await deps.runOne(orderId, { dryRun, executedBy, asOf })
      } catch (e) {
        return failedResult(orderId, e)
      }
    })
    results.push(r)
  }
  return results
}

function collectFailures(clients: readonly ClientReceipt[]): string[] {
  const out: string[] = []
  for (const c of clients) {
    if (c.error) out.push(`${c.client_id}:${c.error}`)
    for (const r of c.results) {
      if (r.needs_person) out.push(`${r.order_id}:${r.outcome}:${r.reason}`)
    }
  }
  return out
}

function countCompleted(clients: readonly ClientReceipt[]): number {
  let n = 0
  for (const c of clients) {
    for (const r of c.results) {
      if (r.outcome === 'published' || r.outcome === 'synced' || r.outcome === 'dry_run_ok') n += 1
    }
  }
  return n
}

function countResults(clients: readonly ClientReceipt[]): number {
  return clients.reduce((n, c) => n + c.results.length, 0)
}

async function finishTick(
  deps: ReelScheduledDeps,
  step: StepLike,
  started: { runId: string; startedAt: number },
  receipt: TickReceipt,
): Promise<void> {
  await step.run('finish-run', async () => {
    const processed = countResults(receipt.clients)
    const completed = countCompleted(receipt.clients)
    const failed = receipt.failures.length
    await deps.finishRun({
      runId: started.runId,
      startedAt: started.startedAt,
      processed,
      completed,
      failed,
      summary: { ...receipt },
      error: failed > 0 ? receipt.failures.join('; ').slice(0, 500) : undefined,
    })
    return null
  })
}

async function handleCron(deps: ReelScheduledDeps, step: StepLike): Promise<TickReceipt> {
  const started = await step.run('start-run', async () => ({
    runId: await deps.startRun(),
    startedAt: Date.now(),
  }))

  const plan = await step.run('plan', async (): Promise<{ receipt: TickReceipt; due: Array<{ id: string }> }> => {
    const now = deps.now()
    const nz_date = nzDate(now)
    if (!scheduledPublicEnabled(deps.env())) return disabledTick(deps, nz_date)
    let clients: Array<{ id: string; config: unknown }>
    try {
      clients = await deps.listClients()
    } catch (e) {
      return {
        receipt: {
          kind: 'tick',
          status: 'list_failed',
          nz_date,
          dry_run: true,
          clients: [],
          no_publish: true,
          failures: [`list_failed: ${errorMessage(e, 200)}`],
        },
        due: [],
      }
    }
    const hour = nzHour(now)
    const due = clients.filter((c) => hour >= publishHourOf(c.config)).map((c) => ({ id: c.id }))
    return {
      receipt: { kind: 'tick', status: 'done', nz_date, dry_run: false, clients: [], no_publish: false, failures: [] },
      due,
    }
  })

  const receipt = plan.receipt
  if (receipt.status === 'done') {
    await publishDue(deps, step, receipt, plan.due, `system:week-card:${started.runId}`)
  }

  await finishTick(deps, step, started, receipt)
  return receipt
}

/** One client: find today's approved reels, then one step per reel. */
async function runClient(
  deps: ReelScheduledDeps,
  step: StepLike,
  clientId: string,
  opts: { today: string; dryRun: boolean; executedBy: string; asOf?: string },
): Promise<ClientReceipt> {
  const found = await step.run(`due-${clientId}`, async (): Promise<{ ids: string[]; error: string | null }> => {
    try {
      return { ids: await deps.loadDueOrderIds(clientId, opts.today), error: null }
    } catch (e) {
      return { ids: [], error: errorMessage(e, 200) }
    }
  })
  const results = found.ids.length > 0 ? await runOrders(deps, step, found.ids, opts.dryRun, opts.executedBy, opts.asOf) : []
  return { client_id: clientId, due: found.ids.length, results, error: found.error }
}

interface DueEventData {
  clientId: string
  /** Practice runs only: check as if it were this NZ date (YYYY-MM-DD). */
  date: string | null
}

function parseEventData(data: unknown): DueEventData {
  const record = isRecord(data) ? data : {}
  const clientId = typeof record.clientId === 'string' ? record.clientId : ''
  const date = typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date) ? record.date : null
  return { clientId, date }
}

async function handleDue(
  deps: ReelScheduledDeps,
  event: { data?: unknown },
  step: StepLike,
): Promise<TickReceipt> {
  const started = await step.run('start-run', async () => ({
    runId: await deps.startRun(),
    startedAt: Date.now(),
  }))

  const data = await step.run('parse-event', async () => parseEventData(event.data))
  // A manual event never publishes: real publishing only happens on the timed wake-up, at the client's publish hour.
  const dryRun = true
  const nz_date = data.date ?? nzDate(deps.now())
  const executedBy = `system:week-card:${started.runId}`

  const receipt: TickReceipt = {
    kind: 'tick',
    status: 'done',
    nz_date,
    dry_run: dryRun,
    clients: [],
    no_publish: dryRun,
    failures: [],
  }

  if (!data.clientId) {
    receipt.failures = ['invalid_event: clientId missing']
  } else {
    const one = await runClient(deps, step, data.clientId, { today: nz_date, dryRun, executedBy, asOf: data.date ?? undefined })
    receipt.clients.push(one)
    const writeError = await noteClient(deps, step, data.clientId, one.results, true)
    if (writeError) receipt.failures.push(`${data.clientId}:receipt_write_failed:${writeError}`)
    receipt.failures.push(...collectFailures(receipt.clients))
  }

  await finishTick(deps, step, started, receipt)
  return receipt
}

async function disabledTick(
  deps: ReelScheduledDeps,
  nz_date: string,
): Promise<{ receipt: TickReceipt; due: Array<{ id: string }> }> {
  if (deps.recordDispatch) {
    await deps.recordDispatch({
      clientId: 'unscoped',
      kind: 'reel_public',
      subjectRef: `tick:${nz_date}`,
      mode: 'dry_run',
      postId: null,
      publishedAt: null,
      calledPublishApi: false,
      reason: 'master_switch_off',
    })
  }
  return {
    receipt: { kind: 'tick', status: 'disabled', nz_date, dry_run: true, clients: [], no_publish: true, failures: [] },
    due: [],
  }
}

async function publishDue(
  deps: ReelScheduledDeps,
  step: StepLike,
  receipt: TickReceipt,
  due: Array<{ id: string }>,
  executedBy: string,
): Promise<void> {
  let anyLive = false
  for (const client of due) {
    const read = await readLiveFlag(deps, step, client.id)
    if (read.error) receipt.failures.push(`${client.id}:client_switch_unreadable:${read.error}`)
    if (read.on) anyLive = true
    const one = await runClient(deps, step, client.id, { today: receipt.nz_date, dryRun: !read.on, executedBy })
    receipt.clients.push(one)
    const writeError = await noteClient(deps, step, client.id, one.results, !read.on)
    if (writeError) receipt.failures.push(`${client.id}:receipt_write_failed:${writeError}`)
  }
  receipt.failures.push(...collectFailures(receipt.clients))
  receipt.dry_run = !anyLive
  receipt.no_publish = !anyLive
}

async function readLiveFlag(
  deps: ReelScheduledDeps,
  step: StepLike,
  clientId: string,
): Promise<{ on: boolean; error: string | null }> {
  try {
    return await step.run(`live-${clientId}`, async () => {
      try {
        const on = deps.clientPublishLive ? await deps.clientPublishLive(clientId) : false
        return { on, error: null as string | null }
      } catch (e) {
        return { on: false, error: errorMessage(e, 160) }
      }
    })
  } catch (e) {
    return { on: false, error: errorMessage(e, 160) }
  }
}

async function noteClient(
  deps: ReelScheduledDeps,
  step: StepLike,
  clientId: string,
  results: ScheduledResult[],
  dryRun: boolean,
): Promise<string | null> {
  if (!deps.recordDispatch || results.length === 0) return null
  try {
    return await step.run(`note-${clientId}`, async () => {
      try {
        await noteReelResults({
          clientId,
          results,
          dryRun,
          record: deps.recordDispatch!,
          loadRef: deps.loadPublishedRef,
        })
        return null
      } catch (e) {
        return errorMessage(e, 160)
      }
    })
  } catch (e) {
    return errorMessage(e, 160)
  }
}

export function createReelScheduledFunction(deps: ReelScheduledDeps) {
  return inngest.createFunction(
    {
      id: REEL_SCHEDULED_FUNCTION_ID,
      name: 'Reel scheduled go-public: publish approved reels on their day (dry run unless switched on)',
      concurrency: { limit: 1 },
      retries: 0,
    },
    [{ cron: REEL_SCHEDULED_CRON }, { event: REEL_SCHEDULED_EVENT }],
    async ({ event, step }) =>
      event.name === REEL_SCHEDULED_EVENT
        ? handleDue(deps, event, step)
        : handleCron(deps, step),
  )
}

async function loadDueOrderIdsFromDb(clientId: string, today: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('payload')
    .eq('client_id', clientId)
    .eq('action_type', 'factory_reel_publish')
    .in('payload->scheduled_go_public->>status', ['armed', 'claimed'])
    .lte('payload->scheduled_go_public->>publish_on', today)
  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? data : []
  const ids: string[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const payload = row.payload
    if (!isRecord(payload)) continue
    const id = payload.work_order_id
    if (typeof id === 'string' && id) ids.push(id)
  }
  return ids
}

/** 生产实例。 */
export const reelScheduledGoPublic = createReelScheduledFunction({
  env: () => process.env,
  now: () => new Date(),
  listClients: () => listWeeklyLoopClients(supabaseAdmin),
  loadDueOrderIds: (clientId, today) => loadDueOrderIdsFromDb(clientId, today),
  runOne: (orderId, opts) =>
    runScheduledPromote(createProductionPromoteDeps(), {
      orderId,
      executedBy: opts.executedBy,
      isApprover: isGlobalAdminEmail,
      dryRun: opts.dryRun,
      asOf: opts.asOf,
    }),
  clientPublishLive: (clientId) => readPublishLive(supabaseAdmin, clientId, 'reel_public'),
  recordDispatch: (receipt) => writePublishDispatchReceipt(supabaseAdmin, receipt),
  loadPublishedRef: (orderId) => loadReelPublishedRef(supabaseAdmin, orderId),
  startRun: () => startCronRunId(REEL_SCHEDULED_JOB),
  finishRun: async ({ runId, startedAt, ...rest }) => {
    await cronRunHandle(REEL_SCHEDULED_JOB, runId, startedAt).finish(rest)
  },
})

// Keep nzToday referenced for parity with the executor's day boundary; the DB filter uses the same NZ date.
void nzToday

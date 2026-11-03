/**
 * 社媒每周出稿编排。每天新西兰 08:30 醒一次：总开关 SOCIAL_WEEKLY_LOOP_ENABLED 不是 'true' 就只写一行 disabled 回执；
 * 开着就给「开了每周闭环、今天是出稿日」的客户各发一个 social/week_pack.draft_due 事件。
 * 事件处理按客户跑 runWeeklyLoop，写一行 cron_run_logs 回执。
 * 写库要三样同时成立：总开关 SOCIAL_WEEKLY_LOOP_ENABLED、写库开关 SOCIAL_WEEKLY_LOOP_WRITE 都是 'true'，且客户开了每周闭环；少一样一律演练（只算不写）。
 * 手动发 dry_run 事件不看总开关，这是当场试跑的入口。不发布、不扣费、不外发。
 * 跑循环前先补审：只在写库模式（或手动事件带 maliang_review: true）时，给「只差马良没审、事实已核过」的片调马良 v2，单客户每周有花费上限，每条一个步骤、不重试。
 * 补审的钱在每次调模型前先记到本次运行的日志行上，并在每个步骤里重查周预算；没配模型 key 就不开跑；「看不了」的结论一律不落库，下周再试。
 * 新增函数部署后必须去 Inngest 后台 Sync 一次。
 */
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { cadenceFromConfig, isoDate, nzCalendar } from '@/lib/social/week-pack/cadence'
import { buildRunIncompleteTask, incompleteReasons, runWeeklyLoop, WEEKLY_LOOP_JOB, type FactCheckWriteOutcome, type WeeklyLoopDeps, type WeeklyLoopMode, type WeeklyLoopReceipt } from '@/lib/social/weekly-loop/run'
import { createWeeklyLoopDbDeps, listWeeklyLoopClients, loadWeeklyLoopClientConfig, loadWeeklyMaliangSpend, reserveWeeklyMaliangSpend, weeklyLoopEnabled } from '@/lib/social/weekly-loop/run-deps'
import type { MaliangCheck } from '@/lib/maliang/render-check'
import { allowedVideoHosts } from '@/lib/maliang/render-check'
import { REVIEW_V2_ESTIMATE_USD, runReviewCheckV2, withinWeeklyBudget } from '@/lib/maliang/render-check-v2'
import { REMOTION_REVIEW_TIMEOUT_MS, runCheckWithTimeout, stampWorkOrderOutput } from '@/lib/maliang/review-disposition'
import { MALIANG_BACKFILL_MAX_PER_RUN, maliangWeeklyCapUsd, overlayReviews, pickBackfillTargets, type BackfillPersisted, type BackfillTarget, type MaliangBackfillReceipt } from '@/lib/social/weekly-loop/maliang-backfill'

export const SOCIAL_WEEKLY_DRAFT_FUNCTION_ID = `${CLOUD_FN_PREFIX}social-weekly-draft`
export const SOCIAL_WEEKLY_DRAFT_CRON = 'TZ=Pacific/Auckland 30 8 * * *'
export const SOCIAL_WEEKLY_DRAFT_DUE_EVENT = 'social/week_pack.draft_due'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type LoopEnv = Readonly<Record<string, string | undefined>>

export function loopEnabledGlobally(env: LoopEnv): boolean {
  return env.SOCIAL_WEEKLY_LOOP_ENABLED === 'true'
}

export function loopWriteAllowed(env: LoopEnv): boolean {
  return env.SOCIAL_WEEKLY_LOOP_WRITE === 'true'
}

/** Write only when asked for write, both ENABLED and WRITE switches are on and the client is in the loop. Anything else is a dry run. */
export function resolveMode(
  requested: unknown,
  env: LoopEnv,
  clientEnabled: boolean,
): { mode: WeeklyLoopMode; forced: boolean } {
  if (requested === 'write') {
    if (loopEnabledGlobally(env) && loopWriteAllowed(env) && clientEnabled) return { mode: 'write', forced: false }
    return { mode: 'dry_run', forced: true }
  }
  return { mode: 'dry_run', forced: false }
}

export interface LoopClient {
  id: string
  config: unknown
}

export function planFanOut(
  env: LoopEnv,
  now: Date,
  clients: readonly LoopClient[],
): { due: string[]; mode: WeeklyLoopMode } {
  const weekday = nzCalendar(now).weekday
  const due: string[] = []
  for (const client of clients) {
    if (!weeklyLoopEnabled(client.config)) continue
    if (cadenceFromConfig(client.config).draftWeekday !== weekday) continue
    due.push(client.id)
  }
  return { due, mode: loopWriteAllowed(env) ? 'write' : 'dry_run' }
}

export interface FanOutReceipt {
  kind: 'fan_out'
  status: 'disabled' | 'dispatched' | 'list_failed'
  nz_date: string
  mode: WeeklyLoopMode
  enabled_clients: number
  due_clients: string[]
  error: string | null
  no_publish: true
}

export interface ClientRunReceipt
  extends Partial<Omit<WeeklyLoopReceipt, 'kind' | 'client_id' | 'mode' | 'status' | 'no_publish'>> {
  kind: 'client_run'
  client_id: string
  requested_mode: string
  mode: WeeklyLoopMode
  mode_forced: boolean
  trigger: 'cron' | 'manual_event'
  event_id: string | null
  triggered_at: string
  /** Why the run did not finish its job; empty = nothing broke. Drives the run log's failed count. */
  failures: string[]
  status: 'completed' | 'stopped' | 'failed'
  error: string | null
  no_publish: true
  maliang_backfill?: MaliangBackfillReceipt
}

export interface DueEvent {
  id: string
  name: string
  data: { clientId: string; mode: WeeklyLoopMode; source: 'cron' }
}

export interface SocialWeeklyDraftDeps {
  env: () => LoopEnv
  now: () => Date
  listClients: () => Promise<LoopClient[]>
  loadClientConfig: (clientId: string) => Promise<unknown>
  loopDeps: () => WeeklyLoopDeps
  startRun: () => Promise<string>
  finishRun: (input: {
    runId: string
    startedAt: number
    processed: number
    completed: number
    failed: number
    summary: Record<string, unknown>
    error?: string
  }) => Promise<void>
  send: (events: DueEvent[]) => Promise<void>
  /** 马良 money this client already spent in the weekly loop since `since`. Throws when unreadable. */
  loadMaliangSpend: (clientId: string, since: Date) => Promise<number>
  /** One 马良 v2 review. Must not throw: errors and timeouts come back as an unverifiable check. */
  reviewVideo: (target: BackfillTarget) => Promise<MaliangCheck>
  supabaseUrl: () => string | undefined
  /** false when the model key is missing: the backfill does not start (no review, no charge). */
  reviewReady: () => boolean
  /** Books cumulative 马良 spend of this run on its own log row; throws when it cannot. Called before every model call. */
  reserveMaliangSpend: (input: { runId: string; clientId: string; spentUsd: number }) => Promise<void>
}

type StepLike = GetStepTools<typeof inngest>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorMessage(e: unknown, max: number): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.slice(0, max)
}

export interface DueContext {
  clientId: string
  requested: unknown
  trigger: 'cron' | 'manual_event'
  event_id: string | null
  triggered_at: string
  /** Manual dry runs may opt in to real 马良 reviews with data.maliang_review === true. */
  maliangReview: boolean
}

export function parseDueEvent(event: { id?: unknown; ts?: unknown; data?: unknown }, now: Date): DueContext {
  const record = isRecord(event.data) ? event.data : {}
  const trigger: 'cron' | 'manual_event' = record.source === 'cron' ? 'cron' : 'manual_event'
  const event_id = typeof event.id === 'string' && event.id ? event.id : null
  const triggered_at = typeof event.ts === 'number' ? new Date(event.ts).toISOString() : now.toISOString()
  const rawClientId = record.clientId
  const clientId = typeof rawClientId === 'string' && rawClientId.trim() ? rawClientId : ''
  return {
    clientId,
    requested: record.mode,
    trigger,
    event_id,
    triggered_at,
    maliangReview: record.maliang_review === true,
  }
}

interface BackfillPlan {
  off_reason: string | null
  cap_usd: number
  spent_before_usd: number
  targets: BackfillTarget[]
  target_count: number
  skipped: Record<string, number>
  /** Current output of each target row, used as the base when stamping the verdict. */
  outputs: Record<string, unknown>
}

type ReviewSkip = 'budget' | 'spend_unreadable' | 'reserve_failed'

interface BackfillReview {
  id: string
  /** null when the step skipped before calling the model. */
  check: MaliangCheck | null
  persisted: BackfillPersisted | null
  /** true once the money was booked and the model was called. */
  charged: boolean
  skipped: ReviewSkip | null
}

interface ReviewContext {
  clientId: string
  mode: WeeklyLoopMode
  runId: string
  capUsd: number
  /** Reviews already charged earlier in this run. */
  chargedSoFar: number
}

function emptyPlan(off_reason: string, cap_usd: number, spent_before_usd: number): BackfillPlan {
  return { off_reason, cap_usd, spent_before_usd, targets: [], target_count: 0, skipped: {}, outputs: {} }
}

/** A broken read before the reviews must not take the whole run down: no reviews, reason in the receipt. */
async function planBackfillSafe(
  deps: SocialWeeklyDraftDeps,
  clientId: string,
  mode: WeeklyLoopMode,
  optIn: boolean,
): Promise<BackfillPlan> {
  try {
    return await planBackfill(deps, clientId, mode, optIn)
  } catch (e) {
    return emptyPlan(`plan_failed: ${errorMessage(e, 200)}`, 0, 0)
  }
}

async function planBackfill(
  deps: SocialWeeklyDraftDeps,
  clientId: string,
  mode: WeeklyLoopMode,
  optIn: boolean,
): Promise<BackfillPlan> {
  const enabled = mode === 'write' || optIn
  const loopDeps = deps.loopDeps()
  const client = await loopDeps.loadClient(clientId)
  if (client === null) return emptyPlan('client_not_found', 0, 0)

  const cap = maliangWeeklyCapUsd(client.config)
  let spent = 0
  try {
    spent = await deps.loadMaliangSpend(clientId, new Date(deps.now().getTime() - WEEK_MS))
  } catch {
    return emptyPlan('spend_unreadable', cap, 0)
  }

  const { rows } = await loopDeps.loadOrders(clientId)
  const preview = await runWeeklyLoop(
    { ...loopDeps, loadOrders: async () => ({ rows, truncated: false }) },
    { clientId, now: deps.now(), mode: 'dry_run' },
  )
  const picked = pickBackfillTargets({
    items: preview.items,
    rows,
    brandName: client.name,
    supabaseUrl: deps.supabaseUrl(),
    spentUsd: spent,
    capUsd: cap,
    maxPerRun: MALIANG_BACKFILL_MAX_PER_RUN,
  })

  const outputs: Record<string, unknown> = {}
  for (const target of picked.targets) {
    const row = rows.find((r) => r.id === target.id)
    if (row) outputs[target.id] = row.output
  }

  const off_reason = !enabled
    ? 'dry_run_without_maliang_review'
    : !deps.reviewReady()
      ? 'no_api_key'
      : null

  return {
    off_reason,
    cap_usd: cap,
    spent_before_usd: spent,
    targets: off_reason === null ? picked.targets : [],
    target_count: picked.targets.length,
    skipped: picked.skipped,
    outputs,
  }
}

async function writeVerdict(
  deps: SocialWeeklyDraftDeps,
  ctx: ReviewContext,
  target: BackfillTarget,
  baseOutput: unknown,
  check: MaliangCheck,
): Promise<BackfillPersisted> {
  const output = stampWorkOrderOutput(baseOutput, check)
  let persisted: FactCheckWriteOutcome | 'failed'
  try {
    persisted = await deps.loopDeps().writeFactCheck({
      clientId: ctx.clientId,
      id: target.id,
      readUpdatedAt: target.readUpdatedAt,
      output,
    })
  } catch {
    persisted = 'failed'
  }
  return persisted
}

async function reviewOne(
  deps: SocialWeeklyDraftDeps,
  ctx: ReviewContext,
  target: BackfillTarget,
  baseOutput: unknown,
): Promise<BackfillReview> {
  const skip = (s: ReviewSkip): BackfillReview => ({
    id: target.id,
    check: null,
    persisted: null,
    charged: false,
    skipped: s,
  })

  let spent: number
  try {
    spent = await deps.loadMaliangSpend(ctx.clientId, new Date(deps.now().getTime() - WEEK_MS))
  } catch {
    return skip('spend_unreadable')
  }
  if (!withinWeeklyBudget(spent, ctx.capUsd, REVIEW_V2_ESTIMATE_USD)) return skip('budget')

  try {
    await deps.reserveMaliangSpend({
      runId: ctx.runId,
      clientId: ctx.clientId,
      spentUsd: (ctx.chargedSoFar + 1) * REVIEW_V2_ESTIMATE_USD,
    })
  } catch {
    return skip('reserve_failed')
  }

  const check = await deps.reviewVideo(target)
  const charged = { id: target.id, check, charged: true, skipped: null }
  if (check.status === 'unverifiable') return { ...charged, persisted: 'unverifiable_not_written' }
  if (ctx.mode !== 'write') return { ...charged, persisted: 'not_written' }
  const persisted = await writeVerdict(deps, ctx, target, baseOutput, check)
  return { ...charged, persisted }
}

function buildBackfillReceipt(
  plan: BackfillPlan,
  reviews: readonly BackfillReview[],
): MaliangBackfillReceipt {
  const skipped: Record<string, number> = { ...plan.skipped }
  for (const review of reviews) {
    if (review.skipped === null) continue
    skipped[review.skipped] = (skipped[review.skipped] ?? 0) + 1
  }
  const reviewed: MaliangBackfillReceipt['reviewed'] = []
  for (const review of reviews) {
    if (review.check === null || review.persisted === null) continue
    reviewed.push({ id: review.id, status: review.check.status, persisted: review.persisted })
  }
  return {
    enabled: plan.off_reason === null,
    off_reason: plan.off_reason,
    cap_usd: plan.cap_usd,
    spent_before_usd: plan.spent_before_usd,
    spent_usd: reviews.filter((r) => r.charged).length * REVIEW_V2_ESTIMATE_USD,
    estimated_usd: plan.target_count * REVIEW_V2_ESTIMATE_USD,
    targets: plan.target_count,
    skipped,
    reviewed,
  }
}

async function runMaliangBackfill(
  deps: SocialWeeklyDraftDeps,
  step: StepLike,
  clientId: string,
  mode: WeeklyLoopMode,
  optIn: boolean,
  runId: string,
): Promise<{ receipt: MaliangBackfillReceipt; overlay: Record<string, MaliangCheck> }> {
  const plan = await step.run('maliang-plan', () => planBackfillSafe(deps, clientId, mode, optIn))

  const reviews: BackfillReview[] = []
  for (const target of plan.targets) {
    const chargedSoFar = reviews.filter((r) => r.charged).length
    const review = await step.run(`maliang-review-${target.id}`, () =>
      reviewOne(
        deps,
        { clientId, mode, runId, capUsd: plan.cap_usd, chargedSoFar },
        target,
        plan.outputs[target.id],
      ),
    )
    reviews.push(review)
  }

  const overlay: Record<string, MaliangCheck> = {}
  if (mode !== 'write') {
    for (const review of reviews) {
      if (review.persisted !== 'not_written') continue
      if (review.check === null) continue
      overlay[review.id] = review.check
    }
  }

  return { receipt: buildBackfillReceipt(plan, reviews), overlay }
}

function invalidEventReceipt(ctx: DueContext): ClientRunReceipt {
  return {
    kind: 'client_run',
    client_id: '',
    requested_mode: String(ctx.requested ?? ''),
    mode: 'dry_run',
    mode_forced: false,
    trigger: ctx.trigger,
    event_id: ctx.event_id,
    triggered_at: ctx.triggered_at,
    failures: ['invalid_event: clientId missing'],
    status: 'failed',
    error: 'invalid_event: clientId missing',
    no_publish: true,
  }
}

/** Backfill breakages and money wasted without a stored verdict (not content decisions). */
export function backfillFailures(backfill: MaliangBackfillReceipt): string[] {
  const out: string[] = []
  const off = backfill.off_reason ?? ''
  if (off === 'spend_unreadable' || off === 'no_api_key' || off.startsWith('plan_failed')) {
    out.push(`maliang_${off}`)
  }
  for (const reason of ['spend_unreadable', 'reserve_failed'] as const) {
    const n = backfill.skipped[reason] ?? 0
    if (n > 0) out.push(`maliang_review_skip_${reason}:${n}`)
  }
  const countPersisted = (value: BackfillPersisted): number =>
    backfill.reviewed.filter((r) => r.persisted === value).length
  const writeFailed = countPersisted('failed')
  if (writeFailed > 0) out.push(`maliang_write_failed:${writeFailed}`)
  const writeConflict = countPersisted('conflict')
  if (writeConflict > 0) out.push(`maliang_write_conflict:${writeConflict}`)
  const unverifiable = countPersisted('unverifiable_not_written')
  if (unverifiable > 0) out.push(`maliang_unverifiable:${unverifiable}`)
  return out
}

function loopReceipt(
  ctx: DueContext,
  mode: WeeklyLoopMode,
  forced: boolean,
  loop: WeeklyLoopReceipt,
  backfill: MaliangBackfillReceipt,
): ClientRunReceipt {
  const failures = [...incompleteReasons(loop), ...backfillFailures(backfill)]
  return {
    ...loop,
    kind: 'client_run',
    requested_mode: String(ctx.requested ?? 'dry_run'),
    mode_forced: forced,
    trigger: ctx.trigger,
    event_id: ctx.event_id,
    triggered_at: ctx.triggered_at,
    failures,
    error: null,
    maliang_backfill: backfill,
  }
}

function loopErrorReceipt(
  ctx: DueContext,
  mode: WeeklyLoopMode,
  forced: boolean,
  message: string,
  backfill: MaliangBackfillReceipt,
): ClientRunReceipt {
  return {
    kind: 'client_run',
    client_id: ctx.clientId,
    requested_mode: String(ctx.requested ?? 'dry_run'),
    mode,
    mode_forced: forced,
    trigger: ctx.trigger,
    event_id: ctx.event_id,
    triggered_at: ctx.triggered_at,
    failures: [message],
    status: 'failed',
    error: message,
    manual_tasks: mode === 'write' ? [buildRunIncompleteTask(ctx.clientId, [message])] : [],
    manual_tasks_delivered: mode === 'write',
    no_publish: true,
    maliang_backfill: backfill,
  }
}

async function handleCron(deps: SocialWeeklyDraftDeps, step: StepLike): Promise<FanOutReceipt> {
  const started = await step.run('start-run', async () => ({
    runId: await deps.startRun(),
    startedAt: Date.now(),
  }))

  const receipt = await step.run('plan', async (): Promise<FanOutReceipt> => {
    const env = deps.env()
    const now = deps.now()
    const nz_date = isoDate(nzCalendar(now))
    const mode: WeeklyLoopMode = loopWriteAllowed(env) ? 'write' : 'dry_run'
    if (!loopEnabledGlobally(env)) {
      return {
        kind: 'fan_out',
        status: 'disabled',
        nz_date,
        mode,
        enabled_clients: 0,
        due_clients: [],
        error: null,
        no_publish: true,
      }
    }
    let clients: LoopClient[]
    try {
      clients = await deps.listClients()
    } catch (e) {
      return {
        kind: 'fan_out',
        status: 'list_failed',
        nz_date,
        mode,
        enabled_clients: 0,
        due_clients: [],
        error: errorMessage(e, 200),
        no_publish: true,
      }
    }
    const plan = planFanOut(env, now, clients)
    return {
      kind: 'fan_out',
      status: 'dispatched',
      nz_date,
      mode: plan.mode,
      enabled_clients: clients.filter((c) => weeklyLoopEnabled(c.config)).length,
      due_clients: plan.due,
      error: null,
      no_publish: true,
    }
  })

  if (receipt.status === 'dispatched' && receipt.due_clients.length > 0) {
    await step.run('dispatch', async () => {
      await deps.send(
        receipt.due_clients.map((clientId) => ({
          id: `social-weekly-draft:${clientId}:${receipt.nz_date}`,
          name: SOCIAL_WEEKLY_DRAFT_DUE_EVENT,
          data: { clientId, mode: receipt.mode, source: 'cron' as const },
        })),
      )
      return null
    })
  }

  await step.run('finish-run', async () => {
    const listFailed = receipt.status === 'list_failed'
    await deps.finishRun({
      runId: started.runId,
      startedAt: started.startedAt,
      processed: receipt.due_clients.length,
      completed: receipt.due_clients.length,
      failed: listFailed ? 1 : 0,
      summary: { ...receipt },
      error: listFailed ? `读客户名单失败：${receipt.error ?? ''}` : undefined,
    })
    return null
  })

  return receipt
}

async function handleDue(
  deps: SocialWeeklyDraftDeps,
  event: { id?: unknown; ts?: unknown; data?: unknown },
  step: StepLike,
): Promise<ClientRunReceipt> {
  const started = await step.run('start-run', async () => ({
    runId: await deps.startRun(),
    startedAt: Date.now(),
  }))

  const ctx = await step.run('parse-event', async () => parseDueEvent(event, deps.now()))

  let receipt: ClientRunReceipt
  if (!ctx.clientId) {
    receipt = await step.run('invalid-event', async () => invalidEventReceipt(ctx))
  } else {
    const resolved = await step.run('resolve-mode', async () => {
      let clientEnabled = false
      try {
        clientEnabled = weeklyLoopEnabled(await deps.loadClientConfig(ctx.clientId))
      } catch {
        clientEnabled = false
      }
      return resolveMode(ctx.requested, deps.env(), clientEnabled)
    })

    const backfill = await runMaliangBackfill(
      deps,
      step,
      ctx.clientId,
      resolved.mode,
      ctx.maliangReview,
      started.runId,
    )

    receipt = await step.run('run-loop', async (): Promise<ClientRunReceipt> => {
      const base = deps.loopDeps()
      const loopDeps: WeeklyLoopDeps =
        Object.keys(backfill.overlay).length === 0
          ? base
          : {
              ...base,
              loadOrders: async (id) => {
                const r = await base.loadOrders(id)
                return { rows: overlayReviews(r.rows, backfill.overlay), truncated: r.truncated }
              },
            }
      try {
        const loop = await runWeeklyLoop(loopDeps, { clientId: ctx.clientId, now: deps.now(), mode: resolved.mode })
        return loopReceipt(ctx, resolved.mode, resolved.forced, loop, backfill.receipt)
      } catch (e) {
        const message = errorMessage(e, 300)
        return loopErrorReceipt(ctx, resolved.mode, resolved.forced, message, backfill.receipt)
      }
    })
  }

  await step.run('finish-run', async () => {
    const processed = receipt.counts?.candidates ?? 0
    const completed = receipt.counts?.scheduled ?? 0
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

  return receipt
}

export function createSocialWeeklyDraftFunction(deps: SocialWeeklyDraftDeps) {
  return inngest.createFunction(
    {
      id: SOCIAL_WEEKLY_DRAFT_FUNCTION_ID,
      name: 'Social weekly draft: fact-check, 马良 gate and schedule draft reels (dry run unless switched on)',
      concurrency: { limit: 1, key: 'event.data.clientId' },
      retries: 0,
    },
    [{ cron: SOCIAL_WEEKLY_DRAFT_CRON }, { event: SOCIAL_WEEKLY_DRAFT_DUE_EVENT }],
    async ({ event, step }) =>
      event.name === SOCIAL_WEEKLY_DRAFT_DUE_EVENT
        ? handleDue(deps, event, step)
        : handleCron(deps, step),
  )
}

/** 生产实例。 */
export const socialWeeklyDraft = createSocialWeeklyDraftFunction({
  env: () => process.env,
  now: () => new Date(),
  listClients: () => listWeeklyLoopClients(supabaseAdmin),
  loadClientConfig: (clientId) => loadWeeklyLoopClientConfig(supabaseAdmin, clientId),
  loopDeps: () => createWeeklyLoopDbDeps(supabaseAdmin),
  startRun: () => startCronRunId(WEEKLY_LOOP_JOB),
  finishRun: async ({ runId, startedAt, ...rest }) => {
    await cronRunHandle(WEEKLY_LOOP_JOB, runId, startedAt).finish(rest)
  },
  send: async (events) => {
    await inngest.send(events)
  },
  loadMaliangSpend: (clientId, since) => loadWeeklyMaliangSpend(supabaseAdmin, clientId, since),
  reviewVideo: (target) =>
    runCheckWithTimeout(
      () => runReviewCheckV2(
        { videoUrl: target.videoUrl, input: target.input, apiKey: process.env.GEMINI_API_KEY },
        { allowedHosts: allowedVideoHosts() },
      ),
      REMOTION_REVIEW_TIMEOUT_MS,
      target.videoUrl,
    ),
  supabaseUrl: () => process.env.NEXT_PUBLIC_SUPABASE_URL,
  reviewReady: () => Boolean(process.env.GEMINI_API_KEY?.trim()),
  reserveMaliangSpend: (input) => reserveWeeklyMaliangSpend(supabaseAdmin, input),
})

/**
 * 社媒每周出稿编排。每天新西兰 08:30 醒一次：总开关 SOCIAL_WEEKLY_LOOP_ENABLED 不是 'true' 就只写一行 disabled 回执；
 * 开着就给「开了每周闭环、今天是出稿日」的客户各发一个 social/week_pack.draft_due 事件。
 * 事件处理按客户跑 runWeeklyLoop，写一行 cron_run_logs 回执。
 * 写库开关 SOCIAL_WEEKLY_LOOP_WRITE 不是 'true' 时一律演练（只算不写）。
 * 手动发 dry_run 事件不看总开关，这是当场试跑的入口。不发布、不扣费、不外发。
 * 新增函数部署后必须去 Inngest 后台 Sync 一次。
 */
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { cadenceFromConfig, isoDate, nzCalendar } from '@/lib/social/week-pack/cadence'
import { runWeeklyLoop, WEEKLY_LOOP_JOB, type WeeklyLoopDeps, type WeeklyLoopMode, type WeeklyLoopReceipt } from '@/lib/social/weekly-loop/run'
import { createWeeklyLoopDbDeps, listWeeklyLoopClients, loadWeeklyLoopClientConfig, weeklyLoopEnabled } from '@/lib/social/weekly-loop/run-deps'

export const SOCIAL_WEEKLY_DRAFT_FUNCTION_ID = `${CLOUD_FN_PREFIX}social-weekly-draft`
export const SOCIAL_WEEKLY_DRAFT_CRON = 'TZ=Pacific/Auckland 30 8 * * *'
export const SOCIAL_WEEKLY_DRAFT_DUE_EVENT = 'social/week_pack.draft_due'

export type LoopEnv = Readonly<Record<string, string | undefined>>

export function loopEnabledGlobally(env: LoopEnv): boolean {
  return env.SOCIAL_WEEKLY_LOOP_ENABLED === 'true'
}

export function loopWriteAllowed(env: LoopEnv): boolean {
  return env.SOCIAL_WEEKLY_LOOP_WRITE === 'true'
}

/** Write only when asked for write, the write switch is on and the client is in the loop. Anything else is a dry run. */
export function resolveMode(
  requested: unknown,
  env: LoopEnv,
  clientEnabled: boolean,
): { mode: WeeklyLoopMode; forced: boolean } {
  if (requested === 'write') {
    if (loopWriteAllowed(env) && clientEnabled) return { mode: 'write', forced: false }
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
  status: 'completed' | 'stopped' | 'failed'
  error: string | null
  no_publish: true
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
}

type StepLike = GetStepTools<typeof inngest>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorMessage(e: unknown, max: number): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.slice(0, max)
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

async function handleDue(deps: SocialWeeklyDraftDeps, data: unknown, step: StepLike): Promise<ClientRunReceipt> {
  const started = await step.run('start-run', async () => ({
    runId: await deps.startRun(),
    startedAt: Date.now(),
  }))

  const receipt = await step.run('run-loop', async (): Promise<ClientRunReceipt> => {
    const record = isRecord(data) ? data : {}
    const rawClientId = record.clientId
    const clientId = typeof rawClientId === 'string' && rawClientId.trim() ? rawClientId : ''
    const requested = record.mode
    const requestedMode = String(requested ?? '')

    if (!clientId) {
      return {
        kind: 'client_run',
        client_id: '',
        requested_mode: requestedMode,
        mode: 'dry_run',
        mode_forced: false,
        status: 'failed',
        error: 'invalid_event: clientId missing',
        no_publish: true,
      }
    }

    const env = deps.env()
    let clientEnabled = false
    try {
      clientEnabled = weeklyLoopEnabled(await deps.loadClientConfig(clientId))
    } catch {
      clientEnabled = false
    }
    const { mode, forced } = resolveMode(requested, env, clientEnabled)

    try {
      const loop = await runWeeklyLoop(deps.loopDeps(), { clientId, now: deps.now(), mode })
      return {
        ...loop,
        kind: 'client_run',
        requested_mode: String(requested ?? 'dry_run'),
        mode_forced: forced,
        error: null,
      }
    } catch (e) {
      return {
        kind: 'client_run',
        client_id: clientId,
        requested_mode: String(requested ?? 'dry_run'),
        mode,
        mode_forced: forced,
        status: 'failed',
        error: errorMessage(e, 300),
        no_publish: true,
      }
    }
  })

  await step.run('finish-run', async () => {
    const processed = receipt.counts?.candidates ?? 0
    const completed = receipt.counts?.scheduled ?? 0
    const failed = receipt.status === 'failed' ? 1 : 0
    await deps.finishRun({
      runId: started.runId,
      startedAt: started.startedAt,
      processed,
      completed,
      failed,
      summary: { ...receipt },
      error: receipt.status === 'failed' ? (receipt.error ?? 'failed') : undefined,
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
        ? handleDue(deps, event.data, step)
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
})

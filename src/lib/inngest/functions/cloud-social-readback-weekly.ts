/**
 * 社媒每周回看建议（每周一新西兰 06:10，早于 07:00 的今日待办）：给开了每周闭环的客户各看一遍「公开满 72 小时」的 Reel 成绩，
 * 按模板、内容类型算平均互动，给「多做 / 少做」建议；结果写一行 cron_run_logs 回执，今日待办读它。
 * 只读：不改任何设置、不外发、不花钱。互动（点赞 + 评论 + 分享）不是询价；私信和表单暂时归不到某条自然内容，页面和待办都如实说「查不到」。
 * 手动事件 social/readback.weekly.due {clientId, asOf?} 只看那一个客户。新增函数部署后必须去 Inngest 后台 Sync 一次。
 */
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { listWeeklyLoopClients } from '@/lib/social/weekly-loop/run-deps'
import { loadReelReadback } from '@/lib/social/reel-readback/load'
import { buildSuggestion, type Suggestion } from '@/lib/social/reel-readback/suggest'
import type { ReelReadbackItem } from '@/lib/social/reel-readback/report'

export const READBACK_WEEKLY_FUNCTION_ID = `${CLOUD_FN_PREFIX}social-readback-weekly`
export const READBACK_WEEKLY_CRON = 'TZ=Pacific/Auckland 10 6 * * 1'
export const READBACK_WEEKLY_EVENT = 'social/readback.weekly.due'
export const READBACK_WEEKLY_JOB = 'social-readback-weekly'
export const READBACK_LOOKBACK_DAYS = 60

const NZ_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })

export interface ClientReadbackReceipt {
  client_id: string
  as_of: string
  error: string | null
  counts: { measured: number; pending: number; not_readable: number; unmatched: number; incomplete: number }
  suggestion: Suggestion | null
}

export interface ReadbackTickReceipt {
  kind: 'tick'
  status: 'done' | 'list_failed'
  as_of: string
  clients: ClientReadbackReceipt[]
  failures: string[]
  no_publish: true
  trigger: 'cron' | 'event'
}

export interface ReadbackWeeklyDeps {
  now: () => Date
  listClients: () => Promise<Array<{ id: string; config: unknown }>>
  load: (clientId: string, since: Date, now: Date) => Promise<{ items: ReelReadbackItem[]; unmatched: number }>
  startRun: () => Promise<string>
  finishRun: (input: { runId: string; startedAt: number; processed: number; completed: number; failed: number; summary: Record<string, unknown>; error?: string }) => Promise<void>
}

type StepLike = GetStepTools<typeof inngest>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

export function clientReceipt(clientId: string, asOf: string, loaded: { items: ReelReadbackItem[]; unmatched: number }): ClientReadbackReceipt {
  const count = (s: ReelReadbackItem['status']) => loaded.items.filter((i) => i.status === s).length
  return {
    client_id: clientId, as_of: asOf, error: null,
    counts: { measured: count('measured'), pending: count('pending'), not_readable: count('not_readable'), unmatched: loaded.unmatched, incomplete: loaded.items.filter((i) => i.status === 'measured' && i.engagement.kind !== 'value').length },
    suggestion: buildSuggestion(loaded.items),
  }
}

async function readOne(deps: ReadbackWeeklyDeps, step: StepLike, clientId: string, asOf: string): Promise<ClientReadbackReceipt> {
  return step.run(`readback-${clientId}`, async () => {
    try {
      const now = deps.now()
      return clientReceipt(clientId, asOf, await deps.load(clientId, new Date(now.getTime() - READBACK_LOOKBACK_DAYS * 86_400_000), now))
    } catch (e) {
      return { client_id: clientId, as_of: asOf, error: message(e), counts: { measured: 0, pending: 0, not_readable: 0, unmatched: 0, incomplete: 0 }, suggestion: null }
    }
  })
}

async function finish(deps: ReadbackWeeklyDeps, step: StepLike, started: { runId: string; startedAt: number }, receipt: ReadbackTickReceipt) {
  await step.run('finish-run', async () => {
    await deps.finishRun({
      runId: started.runId, startedAt: started.startedAt,
      processed: receipt.clients.length, completed: receipt.clients.filter((c) => !c.error).length, failed: receipt.failures.length,
      summary: { ...receipt }, error: receipt.failures.length > 0 ? receipt.failures.join('; ').slice(0, 500) : undefined,
    })
    return null
  })
}

function failuresOf(clients: readonly ClientReadbackReceipt[]): string[] {
  return clients.filter((c) => c.error).map((c) => `${c.client_id}:${c.error}`)
}

async function handleCron(deps: ReadbackWeeklyDeps, step: StepLike): Promise<ReadbackTickReceipt> {
  const started = await step.run('start-run', async () => ({ runId: await deps.startRun(), startedAt: Date.now() }))
  const asOf = NZ_DATE_FMT.format(deps.now())
  const listed = await step.run('list', async (): Promise<{ ids: string[]; error: string | null }> => {
    try {
      return { ids: (await deps.listClients()).map((c) => c.id), error: null }
    } catch (e) {
      return { ids: [], error: message(e) }
    }
  })
  const receipt: ReadbackTickReceipt = { kind: 'tick', status: listed.error ? 'list_failed' : 'done', as_of: asOf, clients: [], failures: listed.error ? [`list_failed: ${listed.error}`] : [], no_publish: true, trigger: 'cron' }
  for (const id of listed.ids) receipt.clients.push(await readOne(deps, step, id, asOf))
  receipt.failures.push(...failuresOf(receipt.clients))
  await finish(deps, step, started, receipt)
  return receipt
}

async function handleDue(deps: ReadbackWeeklyDeps, event: { data?: unknown }, step: StepLike): Promise<ReadbackTickReceipt> {
  const started = await step.run('start-run', async () => ({ runId: await deps.startRun(), startedAt: Date.now() }))
  const data = isRecord(event.data) ? event.data : {}
  const clientId = typeof data.clientId === 'string' ? data.clientId : ''
  const asOf = typeof data.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.asOf) ? data.asOf : NZ_DATE_FMT.format(deps.now())
  const receipt: ReadbackTickReceipt = { kind: 'tick', status: 'done', as_of: asOf, clients: [], failures: [], no_publish: true, trigger: 'event' }
  if (!clientId) receipt.failures.push('invalid_event: clientId missing')
  else receipt.clients.push(await readOne(deps, step, clientId, asOf))
  receipt.failures.push(...failuresOf(receipt.clients))
  await finish(deps, step, started, receipt)
  return receipt
}

export function createReadbackWeeklyFunction(deps: ReadbackWeeklyDeps) {
  return inngest.createFunction(
    { id: READBACK_WEEKLY_FUNCTION_ID, name: 'Social readback: 72-hour reel numbers and a weekly more/less suggestion (read-only)', concurrency: { limit: 1 }, retries: 0 },
    [{ cron: READBACK_WEEKLY_CRON }, { event: READBACK_WEEKLY_EVENT }],
    async ({ event, step }) => (event.name === READBACK_WEEKLY_EVENT ? handleDue(deps, event, step) : handleCron(deps, step)),
  )
}

/** 生产实例。 */
export const socialReadbackWeekly = createReadbackWeeklyFunction({
  now: () => new Date(),
  listClients: () => listWeeklyLoopClients(supabaseAdmin),
  load: (clientId, since, now) => loadReelReadback(supabaseAdmin, { clientId, since, now }),
  startRun: () => startCronRunId(READBACK_WEEKLY_JOB),
  finishRun: async ({ runId, startedAt, ...rest }) => {
    await cronRunHandle(READBACK_WEEKLY_JOB, runId, startedAt).finish(rest)
  },
})

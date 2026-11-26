/**
 * 社媒账号自检（每周一新西兰 06:00，早于 07:00 的今日待办）：给开了每周闭环的客户各量一遍账号最近 Reel 的同质化（模板、BGM、改版、
 * 形式、内容柱、视觉），结果写一行 cron_run_logs 回执，今日待办读它。只读工单、不写任何业务表、不外发、不花钱。
 * 手动事件 social/account.audit.due {clientId, asOf?} 只审那一个客户。新增函数部署后必须去 Inngest 后台 Sync 一次。
 * 设计：docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md
 */
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { listWeeklyLoopClients } from '@/lib/social/weekly-loop/run-deps'
import { auditAccount } from '@/lib/social/account-audit/audit'
import { loadAuditReels } from '@/lib/social/account-audit/load'
import { clientReceipt, failedReceipt, type ClientAuditReceipt } from '@/lib/social/account-audit/receipt'

export const ACCOUNT_AUDIT_FUNCTION_ID = `${CLOUD_FN_PREFIX}social-account-audit`
export const ACCOUNT_AUDIT_CRON = 'TZ=Pacific/Auckland 0 6 * * 1'
export const ACCOUNT_AUDIT_EVENT = 'social/account.audit.due'
export const ACCOUNT_AUDIT_JOB = 'social-account-audit'
/** How far back the audit reads work orders (the longest metric window is 30 days; 60 gives the variant check room). */
export const ACCOUNT_AUDIT_LOOKBACK_DAYS = 60

const NZ_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })

export interface AccountAuditDeps {
  now: () => Date
  listClients: () => Promise<Array<{ id: string; config: unknown }>>
  loadReels: (clientId: string, sinceIso: string) => ReturnType<typeof loadAuditReels>
  startRun: () => Promise<string>
  finishRun: (input: { runId: string; startedAt: number; processed: number; completed: number; failed: number; summary: Record<string, unknown>; error?: string }) => Promise<void>
}

export interface AuditTickReceipt {
  kind: 'tick'
  status: 'done' | 'list_failed'
  as_of: string
  clients: ClientAuditReceipt[]
  failures: string[]
  no_publish: true
  /** 'cron' = the weekly run for everyone; 'event' = a manual run for one client (the to-do must not mistake it for the weekly one). */
  trigger: 'cron' | 'event'
}

type StepLike = GetStepTools<typeof inngest>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

function sinceOf(asOf: string): string {
  const [y, m, d] = asOf.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - ACCOUNT_AUDIT_LOOKBACK_DAYS * 86_400_000).toISOString()
}

async function auditOne(deps: AccountAuditDeps, step: StepLike, clientId: string, asOf: string): Promise<ClientAuditReceipt> {
  return step.run(`audit-${clientId}`, async () => {
    try {
      return clientReceipt(clientId, auditAccount(await deps.loadReels(clientId, sinceOf(asOf)), asOf))
    } catch (e) {
      return failedReceipt(clientId, asOf, message(e))
    }
  })
}

function failuresOf(clients: readonly ClientAuditReceipt[]): string[] {
  return clients.filter((c) => c.error).map((c) => `${c.client_id}:${c.error}`)
}

async function finish(deps: AccountAuditDeps, step: StepLike, started: { runId: string; startedAt: number }, receipt: AuditTickReceipt) {
  await step.run('finish-run', async () => {
    await deps.finishRun({
      runId: started.runId, startedAt: started.startedAt,
      processed: receipt.clients.length, completed: receipt.clients.filter((c) => !c.error).length, failed: receipt.failures.length,
      summary: { ...receipt }, error: receipt.failures.length > 0 ? receipt.failures.join('; ').slice(0, 500) : undefined,
    })
    return null
  })
}

async function handleCron(deps: AccountAuditDeps, step: StepLike): Promise<AuditTickReceipt> {
  const started = await step.run('start-run', async () => ({ runId: await deps.startRun(), startedAt: Date.now() }))
  const asOf = NZ_DATE_FMT.format(deps.now())
  const listed = await step.run('list', async (): Promise<{ ids: string[]; error: string | null }> => {
    try {
      return { ids: (await deps.listClients()).map((c) => c.id), error: null }
    } catch (e) {
      return { ids: [], error: message(e) }
    }
  })
  const receipt: AuditTickReceipt = { kind: 'tick', status: listed.error ? 'list_failed' : 'done', as_of: asOf, clients: [], failures: listed.error ? [`list_failed: ${listed.error}`] : [], no_publish: true, trigger: 'cron' }
  for (const id of listed.ids) receipt.clients.push(await auditOne(deps, step, id, asOf))
  receipt.failures.push(...failuresOf(receipt.clients))
  await finish(deps, step, started, receipt)
  return receipt
}

async function handleDue(deps: AccountAuditDeps, event: { data?: unknown }, step: StepLike): Promise<AuditTickReceipt> {
  const started = await step.run('start-run', async () => ({ runId: await deps.startRun(), startedAt: Date.now() }))
  const data = isRecord(event.data) ? event.data : {}
  const clientId = typeof data.clientId === 'string' ? data.clientId : ''
  const asOf = typeof data.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.asOf) ? data.asOf : NZ_DATE_FMT.format(deps.now())
  const receipt: AuditTickReceipt = { kind: 'tick', status: 'done', as_of: asOf, clients: [], failures: [], no_publish: true, trigger: 'event' }
  if (!clientId) receipt.failures.push('invalid_event: clientId missing')
  else receipt.clients.push(await auditOne(deps, step, clientId, asOf))
  receipt.failures.push(...failuresOf(receipt.clients))
  await finish(deps, step, started, receipt)
  return receipt
}

export function createAccountAuditFunction(deps: AccountAuditDeps) {
  return inngest.createFunction(
    { id: ACCOUNT_AUDIT_FUNCTION_ID, name: 'Social account audit: how alike are the recent reels (read-only weekly check)', concurrency: { limit: 1 }, retries: 0 },
    [{ cron: ACCOUNT_AUDIT_CRON }, { event: ACCOUNT_AUDIT_EVENT }],
    async ({ event, step }) => (event.name === ACCOUNT_AUDIT_EVENT ? handleDue(deps, event, step) : handleCron(deps, step)),
  )
}

/** 生产实例。 */
export const socialAccountAudit = createAccountAuditFunction({
  now: () => new Date(),
  listClients: () => listWeeklyLoopClients(supabaseAdmin),
  loadReels: (clientId, sinceIso) => loadAuditReels(supabaseAdmin, clientId, sinceIso),
  startRun: () => startCronRunId(ACCOUNT_AUDIT_JOB),
  finishRun: async ({ runId, startedAt, ...rest }) => {
    await cronRunHandle(ACCOUNT_AUDIT_JOB, runId, startedAt).finish(rest)
  },
})

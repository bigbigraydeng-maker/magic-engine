/**
 * 经销商月结（每月 1 日新西兰 09:00）：算上一个月的分润，存成一份「已算好、待批准」的月结。
 * 只记账：不付钱、不外发、不花钱。付款要加钱批准人（ADS_SPEND_APPROVER_EMAILS）在后台点「批准」，
 * 实际转账在 ME 之外完成后再点「已付」。
 *
 * 手动事件 me/distributor.statement.requested {month?: 'YYYY-MM', dry_run?: boolean}：
 * dry_run = 只算不存，用来当场试跑。数据库表还没上线时写一行 skipped 回执，不报错。
 * 新增函数部署后必须去 Inngest 后台 Sync 一次，否则安静地不跑。
 * 设计：docs/specs/2026-11-10-distributor-commission-system-v0.1.md
 */
import type { GetStepTools } from 'inngest'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { computeMonth, type ComputeResult } from '@/lib/distributor/settlement-store'
import { previousMonth } from '@/lib/distributor/settlement'
import { monthKey } from '@/lib/distributor/time'

export const DISTRIBUTOR_STATEMENT_FUNCTION_ID = `${CLOUD_FN_PREFIX}distributor-monthly-statement`
export const DISTRIBUTOR_STATEMENT_SCHEDULE = '0 9 1 * *'
export const DISTRIBUTOR_STATEMENT_CRON = `TZ=Pacific/Auckland ${DISTRIBUTOR_STATEMENT_SCHEDULE}`
export const DISTRIBUTOR_STATEMENT_EVENT = 'me/distributor.statement.requested'
export const DISTRIBUTOR_STATEMENT_JOB = 'distributor-monthly-statement'

export interface StatementDeps {
  now: () => Date
  tablesReady: () => Promise<boolean>
  compute: (month: string, dryRun: boolean) => Promise<ComputeResult>
  startRun: () => Promise<string>
  finishRun: (input: { runId: string; startedAt: number; processed: number; completed: number; failed: number; summary: Record<string, unknown>; error?: string }) => Promise<void>
}

export interface StatementReceipt {
  job: typeof DISTRIBUTOR_STATEMENT_JOB
  trigger: 'cron' | 'event'
  month: string
  dry_run: boolean
  status: 'computed' | 'dry_run' | 'skipped_tables_missing' | 'skipped_exists' | 'failed'
  statement_id: string | null
  total_payable_cents: number
  sales_settled: number
  lines: number
  distributors_paid: number
  error: string | null
  /** Computing never pays anyone. */
  no_payout: true
}

type StepLike = GetStepTools<typeof inngest>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Month and dry-run flag from the trigger; cron = previous NZ month, never dry-run. */
export function requestOf(event: { name?: string; data?: unknown }, now: Date): { trigger: 'cron' | 'event'; month: string; dryRun: boolean } {
  const fallback = previousMonth(monthKey(now.toISOString(), 'Pacific/Auckland'))
  if (event.name !== DISTRIBUTOR_STATEMENT_EVENT) return { trigger: 'cron', month: fallback, dryRun: false }
  const data = isRecord(event.data) ? event.data : {}
  const month = typeof data.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.month) ? data.month : fallback
  return { trigger: 'event', month, dryRun: data.dry_run === true }
}

async function runCompute(deps: StatementDeps, month: string, dryRun: boolean): Promise<Omit<StatementReceipt, 'job' | 'trigger' | 'no_payout'>> {
  const empty = { month, dry_run: dryRun, statement_id: null, total_payable_cents: 0, sales_settled: 0, lines: 0, distributors_paid: 0, error: null }
  try {
    if (!(await deps.tablesReady())) return { ...empty, status: 'skipped_tables_missing' }
    const r = await deps.compute(month, dryRun)
    return {
      ...empty,
      status: dryRun ? 'dry_run' : 'computed',
      statement_id: r.statementId,
      total_payable_cents: r.totalPayableCents,
      sales_settled: r.salesSettled,
      lines: r.lines,
      distributors_paid: r.distributorsPaid,
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200)
    return { ...empty, status: /already exists/.test(msg) ? 'skipped_exists' : 'failed', error: msg }
  }
}

export async function handleStatement(deps: StatementDeps, event: { name?: string; data?: unknown }, step: StepLike): Promise<StatementReceipt> {
  // The request (month, dry-run) is taken inside the first step so a replay never re-reads the clock.
  const started = await step.run('start-run', async () => ({ runId: await deps.startRun(), startedAt: Date.now(), req: requestOf(event, deps.now()) }))
  const req = started.req
  const result = await step.run('compute', () => runCompute(deps, req.month, req.dryRun))
  const receipt: StatementReceipt = { job: DISTRIBUTOR_STATEMENT_JOB, trigger: req.trigger, no_payout: true, ...result }
  await step.run('finish-run', async () => {
    const failed = receipt.status === 'failed' ? 1 : 0
    await deps.finishRun({
      runId: started.runId,
      startedAt: started.startedAt,
      processed: receipt.sales_settled,
      completed: receipt.sales_settled,
      failed,
      summary: { ...receipt },
      ...(failed ? { error: `月结没算成：${receipt.error ?? ''}` } : {}),
    })
    return null
  })
  return receipt
}

export function createDistributorStatementFunction(deps: StatementDeps) {
  return inngest.createFunction(
    { id: DISTRIBUTOR_STATEMENT_FUNCTION_ID, name: 'Distributor monthly statement: compute commissions (records only, never pays)', concurrency: { limit: 1 }, retries: 0 },
    [{ cron: DISTRIBUTOR_STATEMENT_CRON }, { event: DISTRIBUTOR_STATEMENT_EVENT }],
    async ({ event, step }) => handleStatement(deps, event, step),
  )
}

/** Missing table (42P01 in Postgres, PGRST205 from PostgREST) = migration not applied yet. Other errors propagate. */
export async function distributorTablesReady(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('distributor_statements').select('id').limit(1)
  if (!error) return true
  if (error.code === '42P01' || error.code === 'PGRST205') return false
  throw new Error(`读月结表失败: ${error.message}`)
}

/** 生产实例。 */
export const distributorMonthlyStatement = createDistributorStatementFunction({
  now: () => new Date(),
  tablesReady: distributorTablesReady,
  compute: computeMonth,
  startRun: () => startCronRunId(DISTRIBUTOR_STATEMENT_JOB),
  finishRun: async ({ runId, startedAt, ...rest }) => {
    await cronRunHandle(DISTRIBUTOR_STATEMENT_JOB, runId, startedAt).finish(rest)
  },
})

/**
 * 包拯 · 每周复核 AI 判断（修复方案第 1b 刀；规则书 docs/sops/2026-11-03-crm-ai-judgement-review-rules-v1.0.md）。
 *
 * 每周三 10:00 新西兰时间（避开周五、周六；今日待办那两天不跑）。
 * 总开关 BAOZHENG_ENABLED 默认关：关着也写一行 skipped 运行记录，「没开」和「没通电」才分得开。
 * 同一周已经复核完的客户不再调模型（按客户、按周编号去重，首次为准）；跳过的那几行不算「跑过」。
 *
 * 只读 + 调复核模型（花钱，档 1，PM 11-03 回「自动跑」）；不写客人、不写阶段记录、不对外发任何东西。
 * 结构照 libai-prompt-library-monthly.ts：依赖注入版 create...Function(deps)，每一处副作用都在 step 里
 * （Inngest 每个 step 边界之后会把函数体从头重放，step 外的代码每遍都真跑）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'
import { loadTranscriptLines } from '@/lib/crm/stage-infer'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import {
  buildRunSummary,
  isGloballyEnabled,
  isoWeekKey,
  listEnabledClients,
  runClient,
  type BaozhengDeps,
} from '@/lib/baozheng/run'
import { BAOZHENG_JOB, type ClientRunSummary } from '@/lib/baozheng/types'

export const BAOZHENG_WEEKLY_CRON = '0 10 * * 3'
export const BAOZHENG_WEEKLY_TZ = 'Pacific/Auckland'

export interface BaozhengReceipt {
  readonly job: string
  readonly week: string
  readonly status: 'completed' | 'skipped_disabled' | 'skipped_already_ran' | 'failed'
  readonly clients: number
  readonly cost_usd: number
  readonly no_publish: true
}

/**
 * 这一周已经复核完的客户。只认真跑过的行（summary.skipped = false）里 status = 'reviewed' 的客户：
 * 开关关着时写的 skipped 行、没复核成的客户都不算，打开 / 修好后同一周还能补跑（子牙、魏征 P1）。
 */
export async function clientsReviewedThisWeek(db: SupabaseClient, week: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', BAOZHENG_JOB)
    .in('status', ['completed', 'partial'])
    .eq('summary->>week', week)
    .eq('summary->>skipped', 'false')
    .limit(50)
  if (error) throw new Error(`读运行记录失败: ${error.message}`)
  const done = new Set<string>()
  for (const row of (data ?? []) as { summary: unknown }[]) {
    const clients = typeof row.summary === 'object' && row.summary !== null ? (row.summary as { clients?: unknown }).clients : null
    if (!Array.isArray(clients)) continue
    for (const c of clients) {
      if (typeof c !== 'object' || c === null) continue
      const { client_id: id, status } = c as { client_id?: unknown; status?: unknown }
      if (typeof id === 'string' && status === 'reviewed') done.add(id)
    }
  }
  return done
}

type Plan = { kind: 'skip'; reason: string; status: 'skipped_disabled' | 'skipped_already_ran' } | { kind: 'go'; clientIds: string[] } | { kind: 'error'; reason: string }

/** 总开关 → 哪些客户开了 → 去掉本周已复核完的。读失败不抛，变成一条带原因的失败记录（子牙 P1）。 */
async function planWeek(deps: { db: SupabaseClient; env: () => Readonly<Record<string, string | undefined>> }, week: string): Promise<Plan> {
  if (!isGloballyEnabled(deps.env())) return { kind: 'skip', reason: '总开关没开', status: 'skipped_disabled' }
  try {
    const enabled = await listEnabledClients(deps.db)
    const done = await clientsReviewedThisWeek(deps.db, week)
    const clientIds = enabled.filter((id) => !done.has(id))
    if (enabled.length > 0 && clientIds.length === 0) return { kind: 'skip', reason: '本周已经复核过', status: 'skipped_already_ran' }
    return { kind: 'go', clientIds }
  } catch (e) {
    return { kind: 'error', reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
}

export function createBaozhengWeeklyFunction(deps: BaozhengDeps & { env: () => Readonly<Record<string, string | undefined>> }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}baozheng-weekly`,
      name: 'Baozheng weekly: review AI stage judgements (read-only, never edits customers)',
      concurrency: { limit: 1 },
      // 花模型钱：不自动重试，失败如实记下
      retries: 0,
    },
    { cron: `TZ=${BAOZHENG_WEEKLY_TZ} ${BAOZHENG_WEEKLY_CRON}` },
    async ({ step }): Promise<BaozhengReceipt> => {
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(BAOZHENG_JOB),
        startedAt: Date.now(),
        week: isoWeekKey(deps.now()),
      }))
      const run = cronRunHandle(BAOZHENG_JOB, started.runId, started.startedAt)
      const base = { job: BAOZHENG_JOB, week: started.week, no_publish: true as const }

      const plan = await step.run('plan', async () => planWeek(deps, started.week))
      if (plan.kind === 'skip') {
        await step.run('log-finish-skipped', async () => {
          await run.finish({ processed: 0, summary: { ...buildRunSummary(started.week, [], [plan.reason]), skipped: true } })
          return null
        })
        return { ...base, status: plan.status, clients: 0, cost_usd: 0 }
      }
      if (plan.kind === 'error') {
        await step.run('log-finish-error', async () => {
          await run.finish({ processed: 0, failed: 1, error: `列客户失败：${plan.reason}`, summary: { ...buildRunSummary(started.week, [], [`列客户失败：${plan.reason}`]), skipped: false } })
          return null
        })
        return { ...base, status: 'failed', clients: 0, cost_usd: 0 }
      }

      const clientIds = plan.clientIds
      const results: ClientRunSummary[] = []
      for (const clientId of clientIds) {
        results.push(await step.run(`client-${clientId}`, async () => runClient(deps, clientId, started.week)))
      }

      const summary = buildRunSummary(started.week, results, clientIds.length === 0 ? ['没有客户开包拯'] : [])
      const failed = results.filter((r) => r.status === 'failed').length
      await step.run('log-finish', async () => {
        await run.finish({
          processed: results.length,
          completed: results.length - failed,
          failed,
          summary: { ...summary, skipped: false },
          error: failed > 0 ? `${failed} 个客户没跑成` : undefined,
        })
        return null
      })
      return { ...base, status: failed > 0 && failed === results.length ? 'failed' : 'completed', clients: results.length, cost_usd: summary.cost_usd }
    },
  )
}

/** 生产实例。 */
export const baozhengWeekly = createBaozhengWeeklyFunction({
  db: supabaseAdmin,
  llm: callClaudeChat,
  loadTranscript: (clientId, contactId, ingestedBefore) => loadTranscriptLines(clientId, contactId, { ingestedBefore }),
  now: () => new Date(),
  env: () => process.env,
})

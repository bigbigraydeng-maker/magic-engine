/**
 * 包拯 · 每周复核 AI 判断（修复方案第 1b 刀；规则书 docs/sops/2026-11-03-crm-ai-judgement-review-rules-v1.0.md）。
 *
 * 每周三 10:00 新西兰时间（避开周五、周六；今日待办那两天不跑）。
 * 总开关 BAOZHENG_ENABLED 默认关：关着也写一行 skipped 运行记录，「没开」和「没通电」才分得开。
 * 同一周已经跑完过 → 不再调模型（周编号去重，首次为准）。
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

/** 这一周有没有已经跑完的一轮（completed / partial 且 summary.week 相同）。 */
export async function alreadyRanThisWeek(db: SupabaseClient, week: string): Promise<boolean> {
  const { data, error } = await db
    .from('cron_run_logs')
    .select('id')
    .eq('job_name', BAOZHENG_JOB)
    .in('status', ['completed', 'partial'])
    .eq('summary->>week', week)
    .limit(1)
  if (error) throw new Error(`读运行记录失败: ${error.message}`)
  return (data ?? []).length > 0
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

      const gate = await step.run('gate', async () => {
        if (!isGloballyEnabled(deps.env())) return 'disabled' as const
        return (await alreadyRanThisWeek(deps.db, started.week)) ? ('already_ran' as const) : ('go' as const)
      })
      if (gate !== 'go') {
        const reason = gate === 'disabled' ? '总开关没开' : '本周已经跑过'
        await step.run('log-finish-skipped', async () => {
          await run.finish({ processed: 0, summary: { ...buildRunSummary(started.week, [], [reason]), skipped: true } })
          return null
        })
        return { ...base, status: gate === 'disabled' ? 'skipped_disabled' : 'skipped_already_ran', clients: 0, cost_usd: 0 }
      }

      const clientIds = await step.run('list-clients', async () => listEnabledClients(deps.db))
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

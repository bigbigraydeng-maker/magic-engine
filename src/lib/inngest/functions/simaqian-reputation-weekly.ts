/**
 * 司马迁 · 口碑周巡（agent 自治计划 B2，docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md §4.1）。
 *
 * 每周四早上读每个 active 客户本轮新出现的 Google 评价（review_items.is_new，由
 * reputation-snapshots-weekly 每周一写），起草回复与好评帖子，写成回执；今日待办从回执里拉
 * （src/lib/pm-todo/simaqian-review-items.ts）。
 *
 * 🔴 **一律不发**（no_publish: true）：口碑维度 FDE-only、GBP 发帖审批制（CLAUDE.md），
 *    产出只进今日待办三件套。
 *
 * 🔴 避开周五周六（今日待办那两天不跑），所以定时器落在周四 09:00 新西兰时间。
 *
 * 🔴 retries 0：起草花 LLM 钱，失败进回执不重跑——重跑等于重复付款。
 *
 * 结构照抄 competitor-watch-weekly.ts：依赖注入版 create...Function(deps) 便于测试，
 * 每一处副作用都必须在 step.run 里（Inngest 在每个 step 边界之后会把函数体从头重放一遍，
 * step 外的代码每遍都真跑）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { callClaudeChat } from '@/lib/anthropic/client'
import { draftForClient, type ClientPatrolReceipt, type DraftLlm, type NewReviewRow } from '@/lib/reputation/simaqian-drafts'

export const SIMAQIAN_JOB = 'simaqian-reputation-weekly'
/** 周四 09:00 新西兰时间。周四是计划表定的口碑日；避开周五周六。 */
export const SIMAQIAN_CRON = '0 9 * * 4'
export const SIMAQIAN_TZ = 'Pacific/Auckland'
/** 回执多旧就不再进待办（不用 7 的倍数：今日待办周五周六不跑） */
export const SIMAQIAN_RECEIPT_FRESH_DAYS = 6

export interface SimaqianRoster { id: string; name: string }

export interface SimaqianWeeklyReceipt {
  readonly job: string
  readonly status: 'completed' | 'roster_failed' | 'roster_empty'
  readonly clients: ClientPatrolReceipt[]
  readonly no_publish: true
  readonly cost_usd: number
  readonly error: string | null
  readonly created_at: string
}

/** 读 active 客户名单。读不到 = 不判，不给默认值。 */
export async function loadRoster(
  supabase: SupabaseClient,
): Promise<{ ok: true; entries: SimaqianRoster[] } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name')
    .eq('client_status', 'active')
  if (error) return { ok: false, reason: error.message }
  return { ok: true, entries: (data ?? []) as SimaqianRoster[] }
}

/** 读一个客户本轮新出现的 Google 评价。读不到 = 不判，不给默认值。 */
export async function loadNewReviews(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ok: true; rows: NewReviewRow[] } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from('review_items')
    .select('review_uid, author, rating, text, review_date')
    .eq('client_id', clientId)
    .eq('entity_type', 'client')
    .eq('source', 'gbp')
    .eq('is_new', true)
    .order('review_date', { ascending: false })
    .limit(50)
  if (error) return { ok: false, reason: error.message }
  return { ok: true, rows: (data ?? []) as NewReviewRow[] }
}

/** 一个客户的一轮起草：读评价 → 起草。读失败落 read_failed，不抛。 */
export async function patrolOneClient(
  supabase: SupabaseClient,
  client: SimaqianRoster,
  llm: DraftLlm,
): Promise<ClientPatrolReceipt> {
  const read = await loadNewReviews(supabase, client.id)
  if (!read.ok) {
    return {
      client_id: client.id,
      client_name: client.name,
      status: 'read_failed',
      new_reviews: 0,
      negative_reviews: 0,
      replies: [],
      post_draft: null,
      cost_usd: 0,
      error: read.reason,
    }
  }
  return draftForClient({ clientId: client.id, clientName: client.name, reviews: read.rows }, llm)
}

/** 依赖注入版，便于集成测试注入假 supabase / 假 llm。 */
export function createSimaqianReputationWeeklyFunction(deps: {
  supabase: SupabaseClient
  llm: DraftLlm
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}simaqian-reputation-weekly`,
      name: 'Simaqian reputation weekly: draft replies for new Google reviews (never publishes)',
      // 派单本身不该并发跑两遍——两遍会起草两批，运行记录会多一条。
      concurrency: { limit: 1 },
      // 不重试：起草花 LLM 钱，失败进回执不重跑。
      retries: 0,
    },
    { cron: `TZ=${SIMAQIAN_TZ} ${SIMAQIAN_CRON}` },
    async ({ step }): Promise<SimaqianWeeklyReceipt> => {
      // 🔴 每一处副作用都必须在 step 里，理由同 competitor-watch-weekly.ts。
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(SIMAQIAN_JOB),
        startedAt: Date.now(),
        createdAt: new Date().toISOString(),
      }))
      const run = cronRunHandle(SIMAQIAN_JOB, started.runId, started.startedAt)
      const base = {
        job: SIMAQIAN_JOB,
        no_publish: true as const,
        created_at: started.createdAt,
      }

      const roster = await step.run('load-roster', async () => loadRoster(deps.supabase))

      if (!roster.ok) {
        await step.run('log-finish-roster-failed', async () => {
          await run.finish({ failed: 1, error: roster.reason })
          return null
        })
        return { ...base, status: 'roster_failed', clients: [], cost_usd: 0, error: roster.reason }
      }

      if (roster.entries.length === 0) {
        await step.run('log-finish-empty', async () => {
          await run.finish({ processed: 0, completed: 0, failed: 0, summary: { no_publish: true } })
          return null
        })
        return { ...base, status: 'roster_empty', clients: [], cost_usd: 0, error: null }
      }

      const clients: ClientPatrolReceipt[] = []
      for (const client of roster.entries) {
        clients.push(await step.run(`patrol-${client.id}`, () => patrolOneClient(deps.supabase, client, deps.llm)))
      }

      const cost = clients.reduce((sum, c) => sum + c.cost_usd, 0)
      const completed = clients.filter(c => c.status === 'drafted' || c.status === 'no_new_reviews').length
      const failed = clients.filter(c => c.status === 'read_failed' || c.status === 'draft_failed').length

      await step.run('log-finish', async () => {
        await run.finish({
          processed: clients.length,
          completed,
          failed,
          summary: { no_publish: true, cost_usd: cost, clients },
        })
        return null
      })

      return { ...base, status: 'completed', clients, cost_usd: cost, error: null }
    },
  )
}

/** 生产实例。 */
export const simaqianReputationWeekly = createSimaqianReputationWeeklyFunction({
  supabase: supabaseAdmin,
  llm: callClaudeChat,
})

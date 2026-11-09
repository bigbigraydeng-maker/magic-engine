/**
 * Magic Engine 2.0 · Inngest 云端消费者：每周 AI 可见度追踪（GEO）
 *
 * 两个函数，一个负责派单、一个负责干活（结构照抄 flywheel-seo-weekly.ts / 竞品快照
 * competitor-watch-weekly.ts，理由见 flywheel-seo-weekly.ts 文件头）：
 *   · `cloud-ai-visibility-weekly-fanout` —— 每周定时跑一次，查出开了
 *     `seo_config.ai_visibility_inngest_enabled` 且至少有一条启用问题的活跃客户，
 *     给每人发一张条子，然后立刻结束。它自己不打任何 provider、不花钱。
 *   · `cloud-ai-visibility-tracker-run-one` —— 收一张条子干一个客户的活，出一份回执。
 *
 * 🔴 **判断逻辑不动**：干活函数原样调用现有的 `runTracker()`（品牌命中判断见
 *    `src/lib/ai-tracker/client-brand-match.ts`，issue #1823/#1837 已修好，本次不碰）。
 *    这个文件只决定「该不该跑、跑完写不写、写成什么样的回执」。
 *
 * 🔴 **旧 Render cron 原样保留**：`ai-tracker-weekly` 路由和 render.yaml 里的排班都没有
 *    动，两条链路会并存。没开 `ai_visibility_inngest_enabled` 的客户继续走旧路径，
 *    一个不变——见 loadTrackerRoster 的选人逻辑。
 *
 * 🔴 **一事件一主**：`ai-visibility/tracker.due` 是云端专属事件，本机 factory-worker
 *    不监听（见 client.ts 的 WORKER_OWNED_EVENTS，契约测试锁死）。
 *
 * 🔴 **防重复付款靠的是「最近扫过就跳过」这道库里的闸**（`recentlyTracked`），不是事件
 *    id 去重——Inngest 的事件去重窗口只有 24 小时，「手动补触发」按定义就发生在隔天。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import {
  AI_VISIBILITY_TRACKER_DUE_EVENT,
  AI_VISIBILITY_WEEKLY_CRON,
  AI_VISIBILITY_WEEKLY_JOB,
  AI_VISIBILITY_WEEKLY_TZ,
  ENGINES_PER_CLIENT,
  isoWeekKey,
  loadTrackerRoster,
  parseTrackerDue,
  recentlyTracked,
  runOneClientTracker,
  trackerEventId,
  type TrackerRosterEntry,
  type TrackerRunOutcome,
} from '@/lib/ai-tracker/weekly-fanout'

/** 派单结果 —— 也是 Inngest 后台里能直接看懂的那份回执。 */
export interface TrackerFanOutReceipt {
  readonly job: string
  readonly week_key: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly estimated_engine_calls: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/** 把名单变成一批待发事件。抽出来是为了能直测「发了什么」而不用真发。 */
export function buildTrackerEvents(
  entries: readonly TrackerRosterEntry[],
  weekKey: string,
  attempt?: string,
): Array<{ id: string; name: string; data: { client_id: string; week_key: string } }> {
  return entries.map((e) => ({
    id: trackerEventId(e.clientId, weekKey, attempt),
    name: AI_VISIBILITY_TRACKER_DUE_EVENT,
    data: { client_id: e.clientId, week_key: weekKey },
  }))
}

/** 依赖注入版，便于集成测试注入假名单 / 假发送。 */
export function createAiVisibilityFanOutFunction(deps: {
  loadRoster: typeof loadTrackerRoster
  supabase: typeof supabaseAdmin
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}ai-visibility-weekly-fanout`,
      name: 'AI visibility weekly: dispatch one tracker job per client',
      // 派单本身不该并发跑两遍——两遍会发两批条子，运行记录会多一条，健康检查看到的数字
      // 就不再是真的（同 flywheel-seo-weekly / competitor-watch-weekly 的理由）。
      concurrency: { limit: 1 },
      retries: 2,
    },
    { cron: `TZ=${AI_VISIBILITY_WEEKLY_TZ} ${AI_VISIBILITY_WEEKLY_CRON}` },
    async ({ step }): Promise<TrackerFanOutReceipt> => {
      // 🔴 每一处副作用都必须在 step 里（同 flywheel-seo-weekly.ts 的理由）：Inngest 在
      //    每个 step 边界之后会把函数体从头重放一遍，step 外的代码每遍都真跑。
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(AI_VISIBILITY_WEEKLY_JOB),
        startedAt: Date.now(),
        weekKey: isoWeekKey(new Date()),
        createdAt: new Date().toISOString(),
      }))
      const run = cronRunHandle(AI_VISIBILITY_WEEKLY_JOB, started.runId, started.startedAt)
      const base = {
        job: AI_VISIBILITY_WEEKLY_JOB,
        week_key: started.weekKey,
        no_publish: true as const,
        created_at: started.createdAt,
      }

      const roster = await step.run('load-roster', async () => deps.loadRoster(deps.supabase))

      if (!roster.ok) {
        await step.run('log-finish-roster-failed', async () => {
          await run.finish({ failed: 1, error: roster.reason })
          return null
        })
        return { ...base, status: 'roster_failed', clients_dispatched: 0, estimated_engine_calls: 0, error: roster.reason }
      }

      const events = buildTrackerEvents(roster.entries, started.weekKey)
      if (events.length === 0) {
        await step.run('log-finish-empty', async () => {
          await run.finish({ processed: 0, completed: 0, failed: 0, summary: { week_key: started.weekKey } })
          return null
        })
        return { ...base, status: 'roster_empty', clients_dispatched: 0, estimated_engine_calls: 0, error: null }
      }

      await step.sendEvent('dispatch-trackers', events)

      // 🔴 这里的数字全是**派单**的数字，不是**追踪**的数字：condition 是「条子发出去了」，
      //    不是「数据拿到了」。真正干成没干成看每个客户自己那份回执。
      const estimated = events.length * ENGINES_PER_CLIENT
      await step.run('log-finish-dispatched', async () => {
        await run.finish({
          processed: events.length,
          completed: events.length,
          failed: 0,
          summary: {
            week_key: started.weekKey,
            counts_are: 'dispatched_not_tracked',
            clients_dispatched: events.length,
          },
        })
        return null
      })
      return { ...base, status: 'dispatched', clients_dispatched: events.length, estimated_engine_calls: estimated, error: null }
    },
  )
}

/**
 * 依赖注入版：便于直接注入假的 runTracker / 假的闸，不碰真 provider。
 *
 * 🔴 `runTracker` 的类型故意只声明 `Promise<TrackerRunOutcome>`（干活函数实际用到的
 *    字段），不是 `ReturnType<typeof runTracker>` 的完整 `RunTrackerResult`——生产实例
 *    传的是真实 `runTracker`，它的返回值结构上是 `TrackerRunOutcome` 的超集，天然满足
 *    这个更窄的类型；测试可以直接用最小 fixture 造假结果，不必拼出 `RunTrackerResult`
 *    全部字段（client_id / total_latency_ms / errors 等跟这层回执无关的字段）。
 */
export function createAiVisibilityRunOneFunction(deps: {
  runTracker: (input: { client_id: string }) => Promise<TrackerRunOutcome>
  shouldSkip: (clientId: string) => Promise<{ skip: boolean; reason: string | null }>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}ai-visibility-tracker-run-one`,
      name: 'AI visibility weekly: track one client',
      // 同一客户串行——防的是同时跑（竞态），不是防重复付款：防重复付款的是
      // runOneClientTracker 里那道「最近扫过就跳过」的库闸。
      concurrency: { limit: 1, key: 'event.data.client_id' },
      // 不重试：provider 的钱是在 runTracker 内部花掉的，失败回执已经如实记下。
      retries: 0,
    },
    { event: AI_VISIBILITY_TRACKER_DUE_EVENT },
    async ({ event, step }) => {
      const parsed = parseTrackerDue(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const due = parsed.value
      const started = await step.run(`tracker-log-start-${due.week_key}-${due.client_id}`, async () => ({
        runId: await startCronRunId(AI_VISIBILITY_WEEKLY_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(AI_VISIBILITY_WEEKLY_JOB, started.runId, started.startedAt)
      const result = await step.run(`tracker-${due.week_key}-${due.client_id}`, async () =>
        runOneClientTracker(due, deps.runTracker, deps.shouldSkip),
      )
      await step.run(`tracker-log-finish-${due.week_key}-${due.client_id}`, async () => {
        await run.finish({
          processed: 1,
          completed: result.status === 'completed' || result.status === 'skipped' ? 1 : 0,
          failed: result.status === 'failed' ? 1 : 0,
          summary: {
            client_id: result.client_id,
            week_key: result.week_key,
            status: result.status,
            runs_succeeded: result.runs_succeeded,
            runs_failed: result.runs_failed,
            total_cost_usd: result.total_cost_usd,
            snapshot_id: result.snapshot_id,
            no_publish: true,
          },
          error: result.status === 'failed' ? result.error ?? 'tracker_failed' : undefined,
        })
        return null
      })
      return result
    },
  )
}

/** 生产实例。 */
export const aiVisibilityWeeklyFanOut = createAiVisibilityFanOutFunction({
  loadRoster: loadTrackerRoster,
  supabase: supabaseAdmin,
})

export const aiVisibilityTrackerRunOne = createAiVisibilityRunOneFunction({
  runTracker: (input) => runTracker(input),
  shouldSkip: (clientId) => recentlyTracked(supabaseAdmin, clientId),
})

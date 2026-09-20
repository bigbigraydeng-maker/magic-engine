/**
 * Magic Engine 2.0 · Inngest 云端消费者：每周竞品快照（PM 2026-09-20 拍板「开」，先只给 CTS）
 *
 * 两个函数，一个负责派单、一个负责干活（结构照抄 flywheel-seo-weekly.ts，理由见该文件头）：
 *   · `cloud-competitor-watch-weekly-fanout` —— 每周定时跑一次，查出开了
 *     `seo_config.competitor_watch_enabled` 的客户，给每人发一张条子，然后立刻结束。
 *     它自己不打任何 provider、不花钱。
 *   · `cloud-competitor-watch-run-one` —— 收一张条子干一个客户，出一份回执。
 *
 * 🔴 一事件一主：`competitor/watch.due` 是云端专属事件，本机 factory-worker 不监听
 *    （见 client.ts 的 WORKER_OWNED_EVENTS，契约测试锁死）。
 *
 * 🔴 防重复付款靠的是「最近扫过就跳过」这道库里的闸（recentlyWatched，查
 *    competitor_snapshots 自己），不是事件 id 去重 —— Inngest 的事件去重窗口只有 24 小时。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { takeCompetitorSnapshot } from '@/lib/competitors/snapshot'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import {
  COMPETITOR_WATCH_CRON,
  COMPETITOR_WATCH_DUE_EVENT,
  COMPETITOR_WATCH_JOB,
  COMPETITOR_WATCH_TZ,
  isoWeekKey,
  loadWatchRoster,
  parseWatchDue,
  recentlyWatched,
  runOneClientWatch,
  watchEventId,
  type WatchRosterEntry,
} from '@/lib/competitors/watch'

/** 派单结果 —— 也是 Inngest 后台里能直接看懂的那份回执。 */
export interface WatchFanOutReceipt {
  readonly job: string
  readonly week_key: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/** 把名单变成一批待发事件。抽出来是为了能直测「发了什么」而不用真发。 */
export function buildWatchEvents(
  entries: readonly WatchRosterEntry[],
  weekKey: string,
  attempt?: string,
): Array<{ id: string; name: string; data: { client_id: string; week_key: string } }> {
  return entries.map((e) => ({
    id: watchEventId(e.clientId, weekKey, attempt),
    name: COMPETITOR_WATCH_DUE_EVENT,
    data: { client_id: e.clientId, week_key: weekKey },
  }))
}

/** 依赖注入版，便于集成测试注入假名单 / 假发送。 */
export function createCompetitorWatchFanOutFunction(deps: {
  loadRoster: typeof loadWatchRoster
  supabase: typeof supabaseAdmin
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}competitor-watch-weekly-fanout`,
      name: 'Competitor watch weekly: dispatch one snapshot job per client',
      // 派单本身不该并发跑两遍——两遍会发两批条子，运行记录会多一条，健康检查看到的数字
      // 就不再是真的。
      concurrency: { limit: 1 },
      retries: 2,
    },
    { cron: `TZ=${COMPETITOR_WATCH_TZ} ${COMPETITOR_WATCH_CRON}` },
    async ({ step }): Promise<WatchFanOutReceipt> => {
      // 🔴 每一处副作用都必须在 step 里，理由同 flywheel-seo-weekly.ts：Inngest 在每个
      //    step 边界之后会把函数体从头重放一遍，step 外的代码每遍都真跑。
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(COMPETITOR_WATCH_JOB),
        startedAt: Date.now(),
        weekKey: isoWeekKey(new Date()),
        createdAt: new Date().toISOString(),
      }))
      const run = cronRunHandle(COMPETITOR_WATCH_JOB, started.runId, started.startedAt)
      const base = {
        job: COMPETITOR_WATCH_JOB,
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
        return { ...base, status: 'roster_failed', clients_dispatched: 0, error: roster.reason }
      }

      const events = buildWatchEvents(roster.entries, started.weekKey)
      if (events.length === 0) {
        await step.run('log-finish-empty', async () => {
          await run.finish({ processed: 0, completed: 0, failed: 0, summary: { week_key: started.weekKey } })
          return null
        })
        return { ...base, status: 'roster_empty', clients_dispatched: 0, error: null }
      }

      await step.sendEvent('dispatch-watches', events)

      await step.run('log-finish-dispatched', async () => {
        await run.finish({
          processed: events.length,
          completed: events.length,
          failed: 0,
          summary: {
            week_key: started.weekKey,
            counts_are: 'dispatched_not_snapshotted',
            clients_dispatched: events.length,
          },
        })
        return null
      })
      return { ...base, status: 'dispatched', clients_dispatched: events.length, error: null }
    },
  )
}

/** 依赖注入版：便于直接注入假的 takeSnapshot / 假的闸，不碰真 provider。 */
export function createCompetitorWatchRunOneFunction(deps: {
  takeSnapshot: (clientId: string) => ReturnType<typeof takeCompetitorSnapshot>
  shouldSkip: (clientId: string) => Promise<{ skip: boolean; reason: string | null }>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}competitor-watch-run-one`,
      name: 'Competitor watch weekly: snapshot one client',
      // 同一客户串行——防的是同时跑（竞态），不是防重复付款：防重复付款的是
      // runOneClientWatch 里那道「最近扫过就跳过」的库闸。
      concurrency: { limit: 1, key: 'event.data.client_id' },
      // 不重试：provider 的钱是在函数内部花掉的，失败回执已经如实记下。
      retries: 0,
    },
    { event: COMPETITOR_WATCH_DUE_EVENT },
    async ({ event, step }) => {
      const parsed = parseWatchDue(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const due = parsed.value
      const started = await step.run(`watch-log-start-${due.week_key}-${due.client_id}`, async () => ({
        runId: await startCronRunId(COMPETITOR_WATCH_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(COMPETITOR_WATCH_JOB, started.runId, started.startedAt)
      const result = await step.run(`watch-${due.week_key}-${due.client_id}`, async () =>
        runOneClientWatch(due, deps.takeSnapshot, deps.shouldSkip),
      )
      await step.run(`watch-log-finish-${due.week_key}-${due.client_id}`, async () => {
        await run.finish({
          processed: 1,
          completed: result.status === 'completed' || result.status === 'skipped' ? 1 : 0,
          failed: result.status === 'failed' ? 1 : 0,
          summary: {
            client_id: result.client_id,
            week_key: result.week_key,
            status: result.status,
            domains_scanned: result.domains_scanned,
            keywords_written: result.keywords_written,
            no_publish: true,
          },
          error: result.status === 'failed' ? result.error ?? 'watch_failed' : undefined,
        })
        return null
      })
      return result
    },
  )
}

/** 生产实例。 */
export const competitorWatchWeeklyFanOut = createCompetitorWatchFanOutFunction({
  loadRoster: loadWatchRoster,
  supabase: supabaseAdmin,
})

export const competitorWatchRunOne = createCompetitorWatchRunOneFunction({
  takeSnapshot: (clientId) =>
    // semrush_db 应该跟着客户走，但事件负载里没带（roster 里有，per-client worker 里没保留）——
    // 见下方注释：为了让事件负载保持最简（只要 client_id/week_key 就能重放/手动补触发），
    // takeCompetitorSnapshot 内部会用 resolver 拿到的域名去打 provider，market 默认走 'au'，
    // 除非调用方显式传。CTS 是 au 市场，先满足这一个客户；换成别的客户前必须把 db 接回事件负载。
    takeCompetitorSnapshot(clientId, null),
  shouldSkip: (clientId) => recentlyWatched(supabaseAdmin, clientId),
})

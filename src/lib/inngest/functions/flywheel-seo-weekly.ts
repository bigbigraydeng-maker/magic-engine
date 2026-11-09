/**
 * Magic Engine 2.0 · Inngest 云端消费者：每周 SEO 快照（PM 2026-09-07 拍板「开」）
 *
 * 两个函数，一个负责派单、一个负责干活：
 *   · `cloud-flywheel-seo-weekly-fanout` —— 每周定时跑一次，查出该扫的客户，
 *     给每人发一张条子，然后**立刻结束**。它自己不打任何 provider、不花钱。
 *   · `cloud-flywheel-seo-snapshot-one` —— 收一张条子干一个客户，出一份回执。
 *
 * 🔴 **为什么定时器挂 Inngest 而不是 Render**：本仓已经被 Render 的「新建服务要有人
 *    进后台点一次 Apply」坑过两次 —— mailbox-sync-hourly 建了一次都没跑过；行业基准
 *    那条干脆是有人在后台手工建的、仓库里查不到。两种失败都不报错。Inngest 的定时器
 *    跟函数一起注册，少一个「有人忘了点」的环节。
 *
 * 🔴 **但它换来了另一个人工步骤，别装作没有**：Render 不是 Vercel，没有自动同步 ——
 *    新增函数或改了触发器之后，必须有人去 Inngest 后台对 `/api/inngest` 这个地址
 *    重新 Sync 一次，新函数才会被认。**没 Sync 的表现是「安静地不跑」**，
 *    跟「一切正常」长得一模一样。所以这条链路同时登记进 CRON_REGISTRY：
 *    真没跑起来时，健康检查会喊「从来没跑过」。
 *
 * 🔴 **一事件一主**：`flywheel/seo.snapshot.due` 是云端专属事件，本机 factory-worker
 *    不监听（见 client.ts 的 WORKER_OWNED_EVENTS，契约测试锁死）。
 *
 * 🔴 **防重复付款靠的是「最近扫过就跳过」这道库里的闸**（`recentlySnapshotted`），
 *    不是事件 id 去重 —— Inngest 的事件去重窗口**只有 24 小时**，而「手动补触发」
 *    按定义就发生在隔天。事件 id 只是 24 小时内的一层薄防线，别当账算。
 *    每客户并发上限 1 防的是同时跑（竞态），也**不**防重复付款：先后跑两次照样两次钱。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoContentAdapter } from '@/lib/flywheel/adapters/SeoContentAdapter'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import {
  FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
  FLYWHEEL_SEO_WEEKLY_CRON,
  FLYWHEEL_SEO_WEEKLY_JOB,
  FLYWHEEL_SEO_WEEKLY_TZ,
  isoWeekKey,
  loadSnapshotRoster,
  parseSnapshotDue,
  PROVIDER_CALLS_PER_CLIENT,
  recentlySnapshotted,
  snapshotEventId,
  snapshotOneClient,
  type SnapshotRosterEntry,
} from '@/lib/flywheel/seo-weekly'

/** 派单结果 —— 也是 Inngest 后台里能直接看懂的那份回执。 */
export interface FanOutReceipt {
  readonly job: string
  readonly week_key: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly estimated_provider_calls: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/** 把名单变成一批待发事件。抽出来是为了能直测「发了什么」而不用真发。 */
export function buildSnapshotEvents(
  entries: readonly SnapshotRosterEntry[],
  weekKey: string,
  attempt?: string,
): Array<{ id: string; name: string; data: { client_id: string; domain: string; week_key: string } }> {
  return entries.map((e) => ({
    id: snapshotEventId(e.clientId, weekKey, attempt),
    name: FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
    data: { client_id: e.clientId, domain: e.domain, week_key: weekKey },
  }))
}

/** 依赖注入版，便于集成测试注入假名单 / 假发送。 */
export function createFlywheelSeoFanOutFunction(deps: {
  loadRoster: typeof loadSnapshotRoster
  supabase: typeof supabaseAdmin
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}flywheel-seo-weekly-fanout`,
      name: 'Flywheel SEO weekly: dispatch one snapshot job per client',
      // 派单本身不该并发跑两遍 —— 两遍会发两批条子，虽然事件 id 去重挡得住，
      // 但运行记录会多一条，健康检查看到的数字就不再是真的。
      concurrency: { limit: 1 },
      // 显式写死。默认 4 次重试，配合下面的分步记录不会写出假记录，但把次数写出来
      // 比让人去查默认值强。
      retries: 2,
    },
    { cron: `TZ=${FLYWHEEL_SEO_WEEKLY_TZ} ${FLYWHEEL_SEO_WEEKLY_CRON}` },
    async ({ step }): Promise<FanOutReceipt> => {
      /**
       * 🔴 **每一处副作用都必须在 step 里**。Inngest 在每个 step 边界之后会把函数体
       *    从头重放一遍（step 的结果走缓存，step **外**的代码每遍都真跑）。
       *    第一版把开运行记录写在 step 外，复审算出来：这个函数有两个 step，
       *    函数体至少跑 3 遍 → 每周插 3 行 cron_run_logs，其中 2 行永远停在「在跑」。
       *    而这条链路的全部立论就是「那些记录是真的」。
       */
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(FLYWHEEL_SEO_WEEKLY_JOB),
        startedAt: Date.now(),
        weekKey: isoWeekKey(new Date()),
        createdAt: new Date().toISOString(),
      }))
      const run = cronRunHandle(FLYWHEEL_SEO_WEEKLY_JOB, started.runId, started.startedAt)
      const base = {
        job: FLYWHEEL_SEO_WEEKLY_JOB,
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
        return { ...base, status: 'roster_failed', clients_dispatched: 0, estimated_provider_calls: 0, error: roster.reason }
      }

      const events = buildSnapshotEvents(roster.entries, started.weekKey)
      if (events.length === 0) {
        await step.run('log-finish-empty', async () => {
          await run.finish({ processed: 0, completed: 0, failed: 0, summary: { week_key: started.weekKey } })
          return null
        })
        return { ...base, status: 'roster_empty', clients_dispatched: 0, estimated_provider_calls: 0, error: null }
      }

      await step.sendEvent('dispatch-snapshots', events)

      // 🔴 这里的数字全是**派单**的数字，不是**快照**的数字：condition 是「条子发出去了」，
      //    不是「数据拿到了」。真正干成没干成看每个客户自己那份回执，
      //    花费是上限不是实数（见 SnapshotReceipt.provider_calls_max）。
      const estimated = events.length * PROVIDER_CALLS_PER_CLIENT
      await step.run('log-finish-dispatched', async () => {
        await run.finish({
          processed: events.length,
          completed: events.length,
          failed: 0,
          summary: {
            week_key: started.weekKey,
            counts_are: 'dispatched_not_snapshotted',
            clients_dispatched: events.length,
            max_provider_calls: estimated,
          },
        })
        return null
      })
      return { ...base, status: 'dispatched', clients_dispatched: events.length, estimated_provider_calls: estimated, error: null }
    },
  )
}

/** 依赖注入版：便于直接注入假的 pullMetrics / 假的闸，不碰真 provider。 */
export function createFlywheelSeoSnapshotOneFunction(deps: {
  pullMetrics: (clientId: string) => Promise<readonly unknown[]>
  shouldSkip: (clientId: string) => Promise<{ skip: boolean; reason: string | null }>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}flywheel-seo-snapshot-one`,
      name: 'Flywheel SEO weekly: snapshot one client',
      // 🔴 同一客户串行 —— 防的是**同时**跑（竞态），**不是**防重复付款：
      //    先后跑两次照样花两次钱。防重复付款的是 snapshotOneClient 里那道
      //    「最近扫过就跳过」的库闸。这句话第一版写错了，复审揪出来的。
      concurrency: { limit: 1, key: 'event.data.client_id' },
      // 🔴 不重试：这一步里 provider 的钱是**在函数内部**花掉的，失败回执已经如实记下
      //    花了几次。整条重试 = 再付一次钱，换来的只是同一份可能同样失败的数据。
      //    真要补，下周会自然补上；等不及就手动触发。
      retries: 0,
    },
    { event: FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT },
    async ({ event, step }) => {
      const parsed = parseSnapshotDue(event.data)
      if (!parsed.ok) return { kind: 'invalid_payload', reason: parsed.reason }
      const due = parsed.value
      const started = await step.run(`snapshot-log-start-${due.week_key}-${due.client_id}`, async () => ({
        runId: await startCronRunId(FLYWHEEL_SEO_WEEKLY_JOB),
        startedAt: Date.now(),
      }))
      const run = cronRunHandle(FLYWHEEL_SEO_WEEKLY_JOB, started.runId, started.startedAt)
      const result = await step.run(`snapshot-${due.week_key}-${due.client_id}`, async () =>
        snapshotOneClient(due, deps.pullMetrics, deps.shouldSkip),
      )
      await step.run(`snapshot-log-finish-${due.week_key}-${due.client_id}`, async () => {
        await run.finish({
          processed: 1,
          completed: result.status === 'completed' || result.status === 'skipped' ? 1 : 0,
          failed: result.status === 'failed' ? 1 : 0,
          summary: {
            client_id: result.client_id,
            domain: result.domain,
            week_key: result.week_key,
            status: result.status,
            metrics_written: result.metrics_written,
            provider_calls_max: result.provider_calls_max,
            no_publish: true,
          },
          error: result.status === 'failed' ? result.error ?? 'snapshot_failed' : undefined,
        })
        return null
      })
      return result
    },
  )
}

/** 生产实例。 */
export const flywheelSeoWeeklyFanOut = createFlywheelSeoFanOutFunction({
  loadRoster: loadSnapshotRoster,
  supabase: supabaseAdmin,
})

export const flywheelSeoSnapshotOne = createFlywheelSeoSnapshotOneFunction({
  pullMetrics: (clientId) => new SeoContentAdapter().pullMetrics(clientId),
  shouldSkip: (clientId) => recentlySnapshotted(supabaseAdmin, clientId),
})

/**
 * Inngest 云端消费者：线索 → 客户指定的 Google 表格（每小时）。
 *
 * 一个函数两半，跟本仓其它 fan-out 链路同一个写法：
 *   · `cloud-lead-sheet-sync-fanout` —— 每小时查出配了路线的客户，一人发一张条子，
 *     然后立刻结束。它自己不碰任何表格。
 *   · `cloud-lead-sheet-sync-one`    —— 收一张条子写一个客户，出一份机器可读回执。
 *
 * 🔴 **为什么不是挂在每小时那条拉线索的任务后面**：见 `lib/lead-sheets/leads.ts` 头注 ——
 *    读库能重跑、能补历史、能在拉线索那条任务挂掉之后自己追上；挂进去还会跟正在
 *    改同一个文件的 PR #1830 撞车。
 *
 * 🔴 **排在拉线索任务之后跑**：`meta-leads-sync` 在 Render 上每小时整点跑，这条
 *    定在每小时 20 分，给上游留足时间把新线索写进 CRM。早跑的后果不是丢数据（下一轮
 *    会追上），只是晚一小时 —— 但线索这东西晚一小时就是晚一小时。
 *
 * 🔴 **新增函数必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次**，不然它
 *    「安静地不跑」，跟一切正常长得一模一样。所以同时登记进 CRON_REGISTRY：
 *    真没跑起来时健康检查会喊「从来没跑过」。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { loadRoutedClientIds } from '@/lib/lead-sheets/config'
import { syncClientLeadSheets } from '@/lib/lead-sheets/sync'
import { LEAD_SHEET_JOB } from '@/lib/pm-todo/lead-sheet-items'
import type { LeadSheetClientReceipt } from '@/lib/lead-sheets/types'

/** 云端专属事件名，本机 worker 不消费（一事件一主，见 client.ts）。 */
export const LEAD_SHEET_SYNC_DUE_EVENT = 'lead_sheet/sync.due'

/** 每小时 20 分 —— 给上游 `meta-leads-sync`（整点跑）留出把线索落库的时间。 */
export const LEAD_SHEET_SYNC_CRON = '20 * * * *'
export const LEAD_SHEET_SYNC_TZ = 'Pacific/Auckland'

export interface LeadSheetFanOutReceipt {
  readonly job: string
  readonly status: 'dispatched' | 'roster_failed' | 'roster_empty'
  readonly clients_dispatched: number
  readonly error: string | null
  readonly created_at: string
}

/** 同一小时同一客户只派一张条子。Inngest 的事件去重窗口是 24h，够挡住重复触发。 */
export function syncEventId(clientId: string, hourKey: string): string {
  return `lead-sheet-sync:${clientId}:${hourKey}`
}

/** `2026-09-24T09` —— 派单幂等键用的小时戳（UTC，只是个键，不面向人）。 */
export function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13)
}

export const leadSheetSyncFanOut = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}lead-sheet-sync-fanout`,
    name: 'Lead sheets: dispatch one sync job per configured client',
    concurrency: { limit: 1 },
    retries: 2,
  },
  { cron: `TZ=${LEAD_SHEET_SYNC_TZ} ${LEAD_SHEET_SYNC_CRON}` },
  async ({ step }): Promise<LeadSheetFanOutReceipt> => {
    // 🔴 小时键必须在步骤**里**算：步骤外的代码每次重放都重跑一遍，跨小时的
    //    重放会算出另一个键、重新派一批条子。
    const key = await step.run('hour-key', async () => hourKey(new Date()))

    const roster = await step.run('load-roster', async () => {
      try {
        return { ok: true as const, clientIds: await loadRoutedClientIds(supabaseAdmin) }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    })

    if (!roster.ok) {
      /**
       * 🔴 **派单失败必须自己留一行运行记录。**
       *
       * 上线第一天最可能出的错全都落在这里：配置表还没 apply、PostgREST 没
       * reload schema、权限拦住 —— 而派单原先一行记录都不写，于是这些错的
       * 表现跟「还没上线」一模一样，日报里也没有任何错误原因可读。
       */
      await step.run('log-roster-failed', async () => {
        const runId = await startCronRunId(LEAD_SHEET_JOB)
        await cronRunHandle(LEAD_SHEET_JOB, runId, Date.now()).finish({
          processed: 0,
          completed: 0,
          failed: 1,
          summary: { results: [] },
          error: `派单失败，这一轮一个客户都没派出去：${roster.error}`,
        })
      })
      return {
        job: LEAD_SHEET_JOB,
        status: 'roster_failed',
        clients_dispatched: 0,
        error: roster.error,
        created_at: new Date().toISOString(),
      }
    }
    if (roster.clientIds.length === 0) {
      return {
        job: LEAD_SHEET_JOB,
        status: 'roster_empty',
        clients_dispatched: 0,
        error: null,
        created_at: new Date().toISOString(),
      }
    }

    await step.sendEvent(
      'dispatch',
      roster.clientIds.map((clientId) => ({
        id: syncEventId(clientId, key),
        name: LEAD_SHEET_SYNC_DUE_EVENT,
        data: { client_id: clientId, hour_key: key },
      })),
    )

    return {
      job: LEAD_SHEET_JOB,
      status: 'dispatched',
      clients_dispatched: roster.clientIds.length,
      error: null,
      created_at: new Date().toISOString(),
    }
  },
)

export const leadSheetSyncOne = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}lead-sheet-sync-one`,
    name: 'Lead sheets: sync one client into its configured sheets',
    // 🔴 同一客户同时只跑一个 —— 两个实例同时读同一张表会各自算出「表里还没有这条」，
    //    然后各写一行。判重是「先读后写」，防不住并发，这道闸才防得住。
    concurrency: { limit: 1, key: 'event.data.client_id' },
    retries: 2,
    /**
     * 🔴 **没有这段，硬失败之后这条链路会「无声停摆 + 体检全绿」。**
     *
     * `start-run` 已经插了一行 status='running'。重试耗尽或步骤被网关强杀时，
     * `finish-run` 永远跑不到，那一行就永远停在 running：`summary` 是 null →
     * 人工待办读到空数组 → **一条待办都不下发**；而那行的 `started_at` 是新的 →
     * 健康检查认为「最近跑过」。表格停止更新，没有任何地方报警。
     *
     * 2026-09-23 私信简报停产三天就是这个死法（见 messenger-brief-after-sync）。
     */
    onFailure: async ({ event, error }) => {
      const message =
        error?.message ||
        (event.data as { error?: { message?: string } } | undefined)?.error?.message ||
        '未知错误'
      const ts = (event as { ts?: number }).ts
      const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
      await failOpenCronRuns(LEAD_SHEET_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
    },
  },
  { event: LEAD_SHEET_SYNC_DUE_EVENT },
  async ({ event, step }): Promise<LeadSheetClientReceipt> => {
    const clientId = String(event.data?.client_id ?? '')
    if (!clientId) {
      return { clientId: '', clientName: null, routes: [], unrouted: 0, error: '事件里没有 client_id', warning: null }
    }

    // 🔴 开始时刻也必须在步骤**里**取：步骤外的代码每次重放都会重跑一遍，
    //    放外面的话 duration_ms 记的是「最后一次重放到现在」，不是真实耗时。
    const started = await step.run('start-run', async () => ({
      runId: await startCronRunId(LEAD_SHEET_JOB),
      startedAt: Date.now(),
    }))

    const receipt = await step.run('sync', async (): Promise<LeadSheetClientReceipt> => {
      const { data } = await supabaseAdmin
        .from('clients')
        .select('id, name')
        .eq('id', clientId)
        .maybeSingle<{ id: string; name: string | null }>()
      return syncClientLeadSheets(supabaseAdmin, { id: clientId, name: data?.name ?? null })
    })

    await step.run('finish-run', async () => {
      const appended = receipt.routes.reduce((n, r) => n + r.appended, 0)
      const failedRoutes = receipt.routes.filter((r) => r.error)
      const handle = cronRunHandle(LEAD_SHEET_JOB, started.runId, started.startedAt)
      await handle.finish({
        processed: receipt.routes.length,
        completed: receipt.routes.length - failedRoutes.length,
        failed: failedRoutes.length,
        // results 是数组是刻意的：人工待办那一侧按「一客户一条」读，
        // 跟别的 fan-out 任务的 summary 形状保持一致。
        summary: { appended, results: [receipt] },
        // 🔴 有错就必须进 error_message —— 日报的「错误原因」列读的就是这个字段。
        //    只写进 summary 的话，日报会照发一行破折号，没人看得懂（2026-08 实测 9 天无人发现）。
        error:
          [receipt.error, ...failedRoutes.map((r) => `${r.routeKey}: ${r.error}`)]
            .filter(Boolean)
            .join(' | ') || undefined,
      })
    })

    return receipt
  },
)

/**
 * Inngest 云端消费者：推广计划每日检查，每天早上跑一次（只读）。
 *
 * 🔴 本函数只读：读 marketing_plans、跑纯函数检查，唯一的写是 cron_run_logs 回执。
 *    不发布、不扣费、不外发。回执同时进 cron_run_logs 和事件（PROMO_WATCH_EVENT）；
 *    今日待办（pm-todo/promo-plan-watch-items.ts）读的就是 cron_run_logs 里的这份回执，不自己现算。
 * 🔴 读不到计划列表 / 单份计划算失败都不算函数失败：回执 status 带原因，
 *    今日待办会据此出一条带步骤的待办。只有函数自己抛异常才写 failed。
 * 🔴 新增函数必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次，不然「安静地不跑」。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import {
  PROMO_WATCH_EVENT,
  PROMO_WATCH_EVENT_DUE,
  PROMO_WATCH_JOB,
  runPromoPlanWatch,
  type WatchReceipt,
} from '@/lib/marketing-plan/promo/daily-watch-run'

/** 新西兰时间每天 07:10。今日待办读的是回执，所以即使待办先生成，也只是读到前一天的回执并在过期时喊出来。 */
export const PROMO_WATCH_CRON = '10 7 * * *'
export const PROMO_WATCH_TZ = 'Pacific/Auckland'

export const promoPlanDailyWatch = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}promo-plan-daily-watch`,
    name: 'Promo plan daily watch: read plans, run checks, write receipt',
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const message =
        error?.message ||
        (event.data as { error?: { message?: string } } | undefined)?.error?.message ||
        '未知错误'
      const ts = (event as { ts?: number }).ts
      const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
      await failOpenCronRuns(PROMO_WATCH_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
    },
  },
  [{ cron: `TZ=${PROMO_WATCH_TZ} ${PROMO_WATCH_CRON}` }, { event: PROMO_WATCH_EVENT_DUE }],
  async ({ step }): Promise<WatchReceipt> => {
    // 🔴 开始时刻必须在步骤里取：步骤外的代码每次重放都会重跑。
    const started = await step.run('start-run', async () => ({
      runId: await startCronRunId(PROMO_WATCH_JOB),
      startedAt: Date.now(),
    }))

    const receipt = await step.run('watch', async (): Promise<WatchReceipt> => {
      const { receipt } = await runPromoPlanWatch(supabaseAdmin)
      return receipt
    })

    // 回执作为事件发出去：事件名业务可读，回执字段齐全。
    await step.run('emit-receipt', async () => {
      // id = 回执编号：步骤重试时同一份回执不会被重复发出
      await inngest.send({ id: receipt.request_id, name: PROMO_WATCH_EVENT, data: receipt })
    })

    await step.run('finish-run', async () => {
      const failed = receipt.plans.filter(p => p.error).length
      const handle = cronRunHandle(PROMO_WATCH_JOB, started.runId, started.startedAt)
      await handle.finish({
        processed: receipt.plans_checked,
        completed: receipt.plans_checked - failed,
        failed,
        // status 非 ok（读不到计划列表 / 单份计划算失败）写在 summary 里，不写 error：
        // 让今日待办读到的是具体的「检查没跑成」待办，而不是笼统的「巡检没跑成」。
        summary: { ...receipt },
      })
    })

    return receipt
  },
)

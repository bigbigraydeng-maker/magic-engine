/**
 * Inngest 云端消费者：日历上带日期的验证事项，每天早上核对一遍（第一步：只读）。
 *
 * 设计稿：docs/specs/2026-10-08-calendar-closure-audit-as-code.md
 * 取代已停用的本机定时任务 calendar-verification-audit。
 *
 * 🔴 本函数只读：读日历（GET）、读台账目录、读运行记录，唯一的写是 cron_run_logs 回执。
 *    不改台账、不改日历、不发任何东西。回执被今日待办读（pm-todo/calendar-closure-items.ts）。
 * 🔴 读不到日历 / 读不出台账不算函数失败：回执 status 带原因，今日待办会出一条带步骤的待办。
 *    只有函数自己抛异常才写 failed（待办里是「巡检没跑成」）。
 * 🔴 新增函数必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次，不然「安静地不跑」；
 *    所以同时登记进 CRON_REGISTRY。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import { createLiveAuditDeps } from '@/lib/calendar-closure/deps'
import { runCalendarClosureAudit } from '@/lib/calendar-closure/run-audit'
import {
  CALENDAR_CLOSURE_DUE_EVENT,
  CALENDAR_CLOSURE_JOB,
  type AuditReceipt,
} from '@/lib/calendar-closure/types'

/** 新西兰时间每天 07:20（PM 上班前）。 */
export const CALENDAR_CLOSURE_CRON = '20 7 * * *'
export const CALENDAR_CLOSURE_TZ = 'Pacific/Auckland'

export const calendarClosureAudit = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}calendar-closure-audit`,
    name: 'Calendar closure audit: read due verification events, check, write receipt',
    concurrency: { limit: 1 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const message =
        error?.message ||
        (event.data as { error?: { message?: string } } | undefined)?.error?.message ||
        '未知错误'
      const ts = (event as { ts?: number }).ts
      const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
      await failOpenCronRuns(CALENDAR_CLOSURE_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
    },
  },
  [{ cron: `TZ=${CALENDAR_CLOSURE_TZ} ${CALENDAR_CLOSURE_CRON}` }, { event: CALENDAR_CLOSURE_DUE_EVENT }],
  async ({ step }): Promise<AuditReceipt> => {
    // 🔴 开始时刻必须在步骤里取：步骤外的代码每次重放都会重跑。
    const started = await step.run('start-run', async () => ({
      runId: await startCronRunId(CALENDAR_CLOSURE_JOB),
      startedAt: Date.now(),
    }))

    const receipt = await step.run('audit', async (): Promise<AuditReceipt> =>
      runCalendarClosureAudit(createLiveAuditDeps(supabaseAdmin), { dryRun: false, source: 'live' }),
    )

    await step.run('finish-run', async () => {
      const handle = cronRunHandle(CALENDAR_CLOSURE_JOB, started.runId, started.startedAt)
      await handle.finish({
        processed: receipt.processed,
        completed: receipt.results.length,
        failed: 0,
        // status 非 ok（读不到日历/台账）写在 summary 里，不写 error：
        // 让今日待办读到的是具体的「读不到日历」待办，而不是笼统的「巡检没跑成」。
        summary: { ...receipt },
      })
    })

    return receipt
  },
)

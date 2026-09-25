/**
 * 李白 · 提示词库月检（只报告不改）。
 *
 * 每月第一个周二 09:00 新西兰时间跑一次。cron 只能表达「每周二」，函数里再判
 * 「这是不是本月 1–7 号」——标准 cron 的日/周字段是「或」关系，不能直接写
 * 「1-7 号且周二」。周二避开周五周六（今日待办那两天不跑）。
 *
 * 结果写回执，今日待办从回执拉（src/lib/pm-todo/libai-items.ts）。
 * 不花钱、不写任何文件。
 *
 * 结构照抄 simaqian-reputation-weekly.ts：依赖注入版 create...Function(deps) 便于测试，
 * 每一处副作用都必须在 step.run 里（Inngest 在每个 step 边界之后会把函数体从头重放一遍，
 * step 外的代码每遍都真跑）。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { auditPromptLibrary, type PromptLibraryAudit } from '@/lib/content/prompt-library-audit'

export const LIBAI_PROMPT_AUDIT_JOB = 'libai-prompt-library-monthly'
/** 周二 09:00 新西兰时间。函数里再判「本月 1–7 号」。 */
export const LIBAI_PROMPT_AUDIT_CRON = '0 9 * * 2'
export const LIBAI_PROMPT_AUDIT_TZ = 'Pacific/Auckland'
/** 回执多旧就不再进待办：月检一月一次，27 天（不用 7 的倍数） */
export const LIBAI_PROMPT_AUDIT_FRESH_DAYS = 27

export interface PromptAuditReceipt {
  readonly job: string
  readonly status: 'completed' | 'skipped_not_first_week'
  readonly findings_count: number
  readonly error: string | null
  readonly no_publish: true
  readonly created_at: string
}

/** 新西兰时区下的「几号」。 */
export function nzDayOfMonth(now: Date): number {
  const day = new Intl.DateTimeFormat('en-NZ', {
    timeZone: LIBAI_PROMPT_AUDIT_TZ,
    day: 'numeric',
  }).format(now)
  return Number(day)
}

/** 是不是本月第一个周二那一周（1–7 号）。 */
export function isFirstWeekNz(now: Date): boolean {
  return nzDayOfMonth(now) <= 7
}

/** 依赖注入版，便于集成测试注入假 audit / 假时钟。 */
export function createLibaiPromptLibraryMonthlyFunction(deps: {
  audit: typeof auditPromptLibrary
  now: () => Date
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}libai-prompt-library-monthly`,
      name: 'Libai prompt library monthly audit (report only, never edits)',
      // 月检本身不该并发跑两遍——两遍会多一条运行记录。
      concurrency: { limit: 1 },
      // 只读不花钱，可以重试一次。
      retries: 1,
    },
    { cron: `TZ=${LIBAI_PROMPT_AUDIT_TZ} ${LIBAI_PROMPT_AUDIT_CRON}` },
    async ({ step }): Promise<PromptAuditReceipt> => {
      // 🔴 每一处副作用都必须在 step 里，理由同 simaqian-reputation-weekly.ts。
      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(LIBAI_PROMPT_AUDIT_JOB),
        startedAt: Date.now(),
        createdAt: new Date().toISOString(),
      }))
      const run = cronRunHandle(LIBAI_PROMPT_AUDIT_JOB, started.runId, started.startedAt)
      const base = {
        job: LIBAI_PROMPT_AUDIT_JOB,
        no_publish: true as const,
        created_at: started.createdAt,
      }

      const firstWeek = await step.run('decide', async () => isFirstWeekNz(deps.now()))

      if (!firstWeek) {
        await step.run('log-finish-skipped', async () => {
          await run.finish({
            processed: 0,
            summary: { skipped: true, reason: 'not first week of month', no_publish: true },
          })
          return null
        })
        return { ...base, status: 'skipped_not_first_week', findings_count: 0, error: null }
      }

      const audit: PromptLibraryAudit = await step.run('audit', async () => deps.audit())

      await step.run('log-finish', async () => {
        await run.finish({
          processed: audit.files_checked,
          completed: audit.error ? 0 : 1,
          failed: audit.error ? 1 : 0,
          summary: {
            skipped: false,
            no_publish: true,
            files_checked: audit.files_checked,
            findings: audit.findings,
            error: audit.error,
          },
          error: audit.error ?? undefined,
        })
        return null
      })

      return {
        ...base,
        status: 'completed',
        findings_count: audit.findings.length,
        error: audit.error,
      }
    },
  )
}

/** 生产实例。 */
export const libaiPromptLibraryMonthly = createLibaiPromptLibraryMonthlyFunction({
  audit: auditPromptLibrary,
  now: () => new Date(),
})

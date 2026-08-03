/**
 * 定时任务健康检查 —— 回答「按时跑了没有」。
 *
 * PM 2026-08-03：「我希望你自检这些工作，如何能确保按时完成，如果不能完成需要有报错」。
 *
 * 跟现有 daily-cron-digest 的区别（也是它的盲区）：
 *   digest 报的是「跑了但失败」。这里报的是「**该跑却没跑**」——
 *   后者没有任何记录，所以在 digest 眼里它跟「一切正常」完全一样。
 *   工厂排产停摆 8 天、daily-cron-digest 自己哑 51 天，都是死在这个盲区。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { CRON_REGISTRY } from './registry'
import { unhealthyJobs, type JobHealth, type JobHealthInput } from './schedule'

export interface HealthReport {
  checkedAt: string
  total: number
  /** 看不见的（代码没写运行记录）—— 必须单独摆出来 */
  blind: JobHealth[]
  /** 从来没跑过 */
  neverRan: JobHealth[]
  /** 逾期没跑 */
  overdue: JobHealth[]
  /** 调度表达式看不懂 */
  unknown: JobHealth[]
  /**
   * **最近一次**就是失败的（跟上面互不重叠：这类是跑了但没跑成）。
   *
   * 🔴 判据是「最后一次的结果」，不是「窗口内失败过几次」——
   *    site-audit-cron 两周内失败 11 次，但 8/1 起已连续成功三天（那个 bug 当天修的）。
   *    按「失败过就报」会把已经修好的东西天天摆出来，人一旦学会忽略它，
   *    真坏的那天也会被一起忽略。
   */
  failing: { service: string; lastError: string | null }[]
}

/**
 * 每个任务各查一次「最近一次运行」。
 *
 * 🔴 不能用「拉最近 N 条再分组」那种写法(首版就是,当场翻车)：
 *    高频任务两周能写 4400 条,窗口全被它们占满,周更任务的记录根本进不来 ——
 *    于是一批一直在跑的任务被判成「从来没跑过」。
 *    **误报一旦成为常态,真出事那天也会被当噪音划掉。**
 *
 * 40 个各查一条带索引的小查询,并发跑,代价远低于误报。
 */
async function lastRunByJob(supabase: SupabaseClient, jobNames: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  const results = await Promise.all(
    jobNames.map(async (name) => {
      const { data } = await supabase
        .from('cron_run_logs')
        .select('started_at')
        .eq('job_name', name)
        .order('started_at', { ascending: false })
        .limit(1)
      const row = (data ?? [])[0] as { started_at: string } | undefined
      return [name, row ? new Date(row.started_at) : null] as const
    }),
  )
  for (const [name, at] of results) if (at) out.set(name, at)
  return out
}

/** 每个任务**最近一次**的结果 —— 只有最后一次失败才算「现在是坏的」。 */
async function lastOutcome(
  supabase: SupabaseClient,
  jobNames: string[],
): Promise<Map<string, { status: string; error: string | null }>> {
  const out = new Map<string, { status: string; error: string | null }>()
  const rows = await Promise.all(
    jobNames.map(async (name) => {
      const { data } = await supabase
        .from('cron_run_logs')
        .select('status, error_message')
        .eq('job_name', name)
        .order('started_at', { ascending: false })
        .limit(1)
      const r = (data ?? [])[0] as { status: string; error_message: string | null } | undefined
      return [name, r ? { status: r.status, error: r.error_message } : null] as const
    }),
  )
  for (const [name, v] of rows) if (v) out.set(name, v)
  return out
}

export async function checkCronHealth(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<HealthReport> {
  const names = Array.from(new Set(CRON_REGISTRY.map((e) => e.jobName)))
  const [lastRun, outcomes] = await Promise.all([
    lastRunByJob(supabase, names),
    lastOutcome(supabase, names),
  ])

  const inputs: JobHealthInput[] = CRON_REGISTRY.map((e) => ({
    service: e.service,
    jobName: e.jobName,
    schedule: e.schedule,
    logsRuns: e.logsRuns,
    lastRunAt: lastRun.get(e.jobName) ?? null,
  }))

  const bad = unhealthyJobs(inputs, now)

  return {
    checkedAt: now.toISOString(),
    total: CRON_REGISTRY.length,
    blind: bad.filter((h) => h.state === 'blind'),
    neverRan: bad.filter((h) => h.state === 'never_ran'),
    overdue: bad.filter((h) => h.state === 'overdue'),
    unknown: bad.filter((h) => h.state === 'unknown_schedule'),
    failing: CRON_REGISTRY
      .filter((e) => outcomes.get(e.jobName)?.status === 'failed')
      .map((e) => ({ service: e.service, lastError: outcomes.get(e.jobName)?.error ?? null })),
  }
}

/** 说人话的一句话结论 —— 给待办和周报用，不要求看的人懂 cron。 */
export function summarise(r: HealthReport): string {
  const problems: string[] = []
  if (r.neverRan.length) problems.push(`${r.neverRan.length} 个从来没跑过`)
  if (r.overdue.length) problems.push(`${r.overdue.length} 个该跑没跑`)
  if (r.failing.length) problems.push(`${r.failing.length} 个在报错`)
  if (r.blind.length) problems.push(`${r.blind.length} 个查不出跑没跑`)
  if (problems.length === 0) return `${r.total} 个自动任务全部正常`
  return `${r.total} 个自动任务里：${problems.join('、')}`
}

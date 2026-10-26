/**
 * 日报邮件里「Failures」那一格显示什么 —— 一个纯函数，好让它能被断言。
 *
 * WHY
 * ---
 * 日报捞的是 `failed_count > 0 || status = 'failed'` 的跑。这两个条件不是同一件事：
 * 一次跑完全可以「一个待办对象都没失败（`failed_count = 0`），但这次跑整体没干成
 * 该干的事（`status = 'failed'`）」。原来那一格硬写 `${failed_count} failed`，
 * 这种跑就显示成红色的 **「0 failed」** —— 表头还写着 Cron Job Failures，自相矛盾，
 * 看的人只会当成显示 bug 划过去。
 *
 * 真实触发场景：`meta-leads-sync` 的 Mailchimp 出口坏了 —— 线索全都进了 CRM
 * （所以「取不到线索的客户数」= 0），但一个人都没进邮件名单。这次跑必须被看见，
 * 且不能谎称有 N 个客户失败。
 */

import { isStuck } from './health'

export interface DigestRunRow {
  status?: string | null
  failed_count?: number | null
  error_message?: string | null
  /** 卡死判据要用（status='running' + 没有结束时间 + 开跑很久）。 */
  started_at?: string | null
  finished_at?: string | null
}

/** 清理任务收口的孤儿行：新状态 `abandoned`，或迁移未应用时写成 failed 且错误以 abandoned: 开头。 */
export function isAbandonedDigestRow(run: DigestRunRow): boolean {
  if (run.status === 'abandoned') return true
  return (run.error_message ?? '').startsWith('abandoned:')
}

/**
 * `N failed`（真有 N 个对象失败）/ `needs attention`（这次跑没干成，但没有可数的
 * 失败对象）/ `卡住了`（开跑了从没结束）。都不编造数字。
 *
 * 🔴 「卡住了」这一档是 2026-09-23 补的。在这之前，`status='running'` 的行
 *    连进都进不了这封邮件（筛选是 `failed_count>0 || status==='failed'`，
 *    两边都接不住 running）；真进来了也会被渲染成红色的「0 failed」，
 *    看的人只会当成显示 bug 划过去。
 */
export function failureCell(run: DigestRunRow, now: Date = new Date()): string {
  if (isAbandonedDigestRow(run)) return 'abandoned'
  const n = run.failed_count ?? 0
  if (n > 0) return `${n} failed`
  if (run.status === 'failed') return 'needs attention'
  if (run.status === 'partial') return 'partial'
  // 刚开跑几分钟的 running 行不许标成卡死 —— 日报常常就在某个任务的执行窗口里跑
  if (isStuckRow(run, now)) return '卡住了（开跑后从没结束）'
  return '0 failed'
}

/**
 * 这一行是不是「开跑了但一直没结束」。
 *
 * 判据跟 `cron/health.ts` 的 `isStuck()` 完全一致（同一个阈值、同样三个条件）——
 * 这里做一层薄适配，是因为日报拿到的是数据库原始列名（snake_case），
 * 而 `isStuck` 收的是已经映射过的形状。
 */
export function isStuckRow(run: DigestRunRow, now: Date): boolean {
  if (run.status !== 'running' || run.finished_at != null) return false
  if (!run.started_at) return false
  return isStuck(
    { status: 'running', finishedAt: null, startedAt: run.started_at },
    now,
  )
}

/**
 * 这一行该不该进那封失败邮件。
 *
 * 🔴 原来的筛选写在路由里，是 `failed_count > 0 || status === 'failed'` ——
 *    **停在 `running` 的行两边都接不住**：容器被杀时路由自己的 catch 根本没机会
 *    把状态写成 failed，状态就永远停在 running。于是这封邮件**在设计上
 *    不可能报卡死**，而 attribution-cron 2026-09-22 卡死两轮正是这么溜过去的。
 *
 * 抽成具名判据是为了它能被直接断言 —— 判据留在路由里就只能靠「读代码确认」，
 * 而这次整件事修的就是「没真跑过不算数」。
 */
export function isDigestFailure(run: DigestRunRow, now: Date): boolean {
  if (isAbandonedDigestRow(run)) return true
  if ((run.failed_count ?? 0) > 0) return true
  if (run.status === 'failed' || run.status === 'partial') return true
  return isStuckRow(run, now)
}

/**
 * 把运行记录里 `summary` 那一坨 JSON 里**带失败含义的数字**挑出来，渲染成
 * `questions_failed=47` 这样一行。
 *
 * WHY
 * ---
 * 日报的 Error 列只渲染 `error_message` 且截到 200 字。可一大类任务压根不写
 * `error_message` —— 它们把客户级明细写在 `summary` 里（比如 `questions_failed: 47`），
 * 于是 PM 一个字都看不到，只看到一个红色的「0 failed」。
 *
 * 只挑名字里带 fail / error / skip 的**数字**键，且值 > 0：
 * 不做通用 JSON 渲染，避免把整坨配置糊到邮件里。
 */
export function summaryFailureDetail(summary: unknown, maxKeys = 4): string {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return ''
  const out: string[] = []
  for (const [k, v] of Object.entries(summary as Record<string, unknown>)) {
    if (out.length >= maxKeys) break
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    if (!/fail|error|skip/i.test(k)) continue
    out.push(`${k}=${v}`)
  }
  return out.join(' · ')
}

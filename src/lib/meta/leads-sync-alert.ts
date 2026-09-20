/**
 * 把 meta-leads-sync 每个客户各自的成败，压成一行人话喂给
 * `cron_run_logs.error_message` —— 日报邮件的「错误原因」列读的就是这个字段。
 *
 * WHY
 * ---
 * 2026-08-21~08-30，4 个客户（CTS Tours NZ / Roman HU / Magic Lab Class /
 * NZCPE 2026）线索管道全线断供 9 天。日报**每天都在发**（`failed_count=4`
 * 稳稳命中告警条件），但因为 cron 从不给 `finish()` 传 `error`，邮件里是
 * 24 行一模一样的「meta-leads-sync 4 failed —」，一个字都没说是什么事。
 * 真正的报错当时就躺在 summary 里，只是没被搬到人看得见的地方。
 * 告警发了等于没发，CTS 一家漏 45 条线索、NZ$736 白花。
 *
 * 住在 lib 而不是 route 里，有两个理由：Next.js 的 `route.ts` 只允许导出
 * 路由处理器和几个约定配置，多导出一个函数会直接类型检查报错；而且路由层
 * 本就该只放路由。
 *
 * 这里报**两类**不同的病，故意不混成一句：
 *   1. 取不到线索 —— 人根本没进来（`summariseFailures`）
 *   2. 线索进来了，但没进邮件名单 —— 人进了 CRM，Mailchimp 出口把他丢了
 *      （`summariseOutletGaps`）
 * 还有**第 3 类**故意不报进 `error_message`：授权缺口（`blocked`）—— 令牌被
 * Meta 拒了、缺主页权限、主页绑定没核实。它们跟前两类的区别不是轻重，是
 * **「重跑会不会好」**：这三种重跑一万次也一样，只有人动手才会好。
 * 2026-09-18~09-20 实测：3 家挂在授权缺口上，于是这个每 2 小时一跑的任务
 * 26 小时里 13 次全红，而正常的 2 家（含 CTS Tours NZ）真出事时，日检和任何
 * 按 status 报警的东西都分不出来 —— 红色里再多一个红色。所以授权缺口改走
 * 每日待办（`pm-todo/leads-sync-blocked-items.ts`），不再染红整轮。
 * 例外见 `isSystemicOutage`：一家正常的都不剩时，那就是系统性故障，照样红。
 *
 * 第 2 类是 2026-08~09 的第二次静默事故：`clients.mailchimp_audience_id`
 * 那一列没 apply 到生产，出口每小时静默 skip，`leadsIngested` 照常涨，
 * 看起来一切正常，一整个月没人看得见。它**不是**「取不到线索」，说成那样
 * 就是在日报里说假话；也**不该**把客户算进 `failed_count`（那个数的语义是
 * 「取不到线索的客户数」，见 route.ts），否则就是过度告警。
 */

import { isOutletGap, outletGapLabel } from '@/lib/mailchimp/outlet-tally'
import type { LeadsSyncBlocker } from '@/lib/meta/leads-sync-blocker'

/** 只取这个摘要用得上的几个字段，故意不绑死 MetaLeadsSyncResult 全貌。 */
export interface LeadsSyncOutcome {
  clientName: string | null
  error?: string
  /**
   * 有值 = 这家取不到线索是**授权缺口**（令牌被拒 / 缺权限 / 绑定没核实），
   * 人不动手永远不会好。判据见 `meta/leads-sync-blocker.ts`。
   * 这类**不进** `error_message`，改由每日待办点名 —— 理由见本文件头。
   */
  blocked?: LeadsSyncBlocker
  /** 这一轮这家被同步闸或配置挡住、压根没去 Meta 取数（`page_not_verified` 等）。 */
  skipped?: string
  /**
   * Mailchimp 出口这一轮的结果分布，key = `subscribed` / `already_member` /
   * `skipped:<reason>` / `failed:<reason>`，value = 条数。由
   * `lib/meta/leads-sync.ts` 产出。可选：老的调用方（和这个字段落地之前的
   * 历史记录）没有它，当成「这一轮没有出口结果」处理，不报。
   */
  mailchimp?: Record<string, number>
}

/** 单个客户的原因截断长度 —— 防一家的长报错挤掉其他家。 */
const MAX_REASON_CHARS = 160

/**
 * 全好时返回 undefined，`finish()` 就仍把这次跑标成 completed —— 不制造新噪音。
 *
 * **按报错原文去重**是关键，不是顺手优化：一把令牌失效时 N 家的报错是同一句，
 * 不去重会把邮件仅有的 200 字符用同一句话刷满，真正不同的病因反而被挤掉。
 */
export function summariseFailures(results: readonly LeadsSyncOutcome[]): string | undefined {
  // `blocked` 的那几家不在这里报：它们是等人处理的授权缺口，不是这一轮的故障。
  // 混进来就等于把这条任务钉死在红色上（见文件头 2026-09 的实测）。
  const failures = results.filter((r) => r.error && !r.blocked)
  if (failures.length === 0) return undefined

  const byReason = groupByReason(failures.map((f) => ({ name: f.clientName, reason: f.error ?? '' })))
  return `${failures.length}/${results.length} 个客户取不到线索 — ${byReason.join(' ‖ ')}`
}

/**
 * 「线索进来了，但没进邮件名单」—— 没有这种情况时返回 undefined。
 *
 * 跟 `summariseFailures` 一样**按原因分组**：一个共性故障（配置读不出来、
 * 密钥失效）会同时打中所有客户，不合并就会把邮件仅有的 200 字符刷满同一句话。
 *
 * 条数是「这一轮有多少个人本该进名单却没进」，不是客户数 —— PM 关心的是漏了
 * 多少人，不是几家出问题。
 */
export function summariseOutletGaps(results: readonly LeadsSyncOutcome[]): string | undefined {
  const rows: { name: string | null; reason: string; count: number }[] = []
  let total = 0

  for (const r of results) {
    for (const [key, count] of Object.entries(r.mailchimp ?? {})) {
      if (count <= 0 || !isOutletGap(key)) continue
      rows.push({ name: r.clientName, reason: outletGapLabel(key), count })
      total += count
    }
  }
  if (total === 0) return undefined

  return `${total} 条线索进了 CRM 但没进邮件名单 — ${groupByReason(rows).join(' ‖ ')}`
}

/**
 * 授权缺口那一行 —— **不进** `error_message`，只进 `summary.blocked`，
 * 给追查的人一眼看清「这一轮有哪几家卡在等人处理上」。没有时 undefined。
 *
 * 跟另外两类一样按原因分组：一把公用令牌失效会同时打中好几家。
 */
export function summariseBlocked(results: readonly LeadsSyncOutcome[]): string | undefined {
  const blocked = results.filter((r) => r.blocked)
  if (blocked.length === 0) return undefined

  const byReason = groupByReason(
    blocked.map((b) => ({ name: b.clientName, reason: `${b.blocked} — ${b.error ?? ''}` })),
  )
  return `${blocked.length}/${results.length} 个客户卡在授权上，等人处理 — ${byReason.join(' ‖ ')}`
}

/**
 * 这一轮是不是**系统性**故障 —— 也就是整轮 status 该不该判 failed。
 *
 * 判据只有一条：**一家跑通的都不剩**。
 * 只要还有客户正常取到数，这一轮的管道本身就是通的，个别客户的授权缺口是那家
 * 自己的事，由待办点名，不该染红整条任务（否则 CTS 真断供时看不出区别）。
 * 反过来，全军覆没时哪怕每家的报错各不相同，也当系统性故障处理 —— 那多半是
 * 我们这头的应用权限、公用令牌或 Graph 版本整个出了事，必须有人当天看见。
 *
 * 只有一个客户配了主页时，这条判据等价于「它挂了就红」—— 分不出来，红是安全的
 * 那一侧：这时候确实一条线索都进不来。
 */
export function isSystemicOutage(results: readonly LeadsSyncOutcome[]): boolean {
  if (results.length === 0) return false
  return results.every((r) => Boolean(r.error) || Boolean(r.skipped))
}

/**
 * 喂给 `cronRun.finish({ error })` 的那一行。两类病都没有时 undefined
 * （这次跑仍标 completed，不制造新噪音）。
 *
 * 「取不到线索」排在前面：人根本没进来比「进来了没进名单」严重，而日报邮件
 * 只截前 200 字符，先说的那句才保证看得见。两句的完整原文都在
 * `cron_run_logs.error_message` 里，追查时不会丢。
 */
export function summariseSyncProblems(results: readonly LeadsSyncOutcome[]): string | undefined {
  // 全军覆没时把授权缺口也说出来：这一轮要判 failed，而 `error_message` 是日报
  // 唯一会显示的那句话 —— 不带上它，红了却说不出是什么事，又回到 2026-08 那次
  // 「24 行一模一样的破折号」。
  const blocked = isSystemicOutage(results) ? summariseBlocked(results) : undefined
  const parts = [summariseFailures(results), blocked, summariseOutletGaps(results)].filter(
    (p): p is string => Boolean(p),
  )
  return parts.length > 0 ? parts.join('；') : undefined
}

/**
 * 按「原因原文」把客户合并成组：`客户A/客户B: 原因 [N 条]`。
 *
 * 去重是共用的，因为两类病共用同一个死因：共性故障会让 N 家给出一模一样的
 * 那句话，不合并就把邮件的 200 字符全刷成同一句，真正不同的病因反而被挤掉。
 */
function groupByReason(
  rows: readonly { name: string | null; reason: string; count?: number }[],
): string[] {
  const byReason = new Map<string, { names: Set<string>; count: number; counted: boolean }>()

  for (const row of rows) {
    const reason = row.reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS)
    const group = byReason.get(reason) ?? { names: new Set<string>(), count: 0, counted: false }
    group.names.add(row.name ?? '(未命名客户)')
    if (row.count !== undefined) {
      group.count += row.count
      group.counted = true
    }
    byReason.set(reason, group)
  }

  return Array.from(byReason, ([reason, g]) => {
    const names = Array.from(g.names).join('/')
    return g.counted ? `${names}: ${reason} ${g.count} 条` : `${names}: ${reason}`
  })
}

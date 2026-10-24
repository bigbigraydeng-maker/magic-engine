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
 * 第 2 类是 2026-08~09 的第二次静默事故：`clients.mailchimp_audience_id`
 * 那一列没 apply 到生产，出口每小时静默 skip，`leadsIngested` 照常涨，
 * 看起来一切正常，一整个月没人看得见。它**不是**「取不到线索」，说成那样
 * 就是在日报里说假话；也**不该**把客户算进 `failed_count`（那个数的语义是
 * 「取不到线索的客户数」，见 route.ts），否则就是过度告警。
 *
 * Blocked vs failed
 * -----------------
 * A client is *blocked* when the pipeline cannot run for a reason that is not a
 * bug on our side and that already has its own PM todo item: an expired Facebook
 * authorisation, or a page binding that Meta has not verified yet. Those clients
 * are surfaced through their own todo detectors, so they must not colour the run
 * as a failure — otherwise the daily digest cries wolf every hour for something
 * a human is already being asked to fix. Everything else that stops a client from
 * fetching leads is *failed* and does belong in the run's error message.
 */

import { isOutletGap, outletGapLabel } from '@/lib/mailchimp/outlet-tally'
import { isFacebookAuthError } from '@/lib/pm-todo/facebook-sync-items'

/** 只取这个摘要用得上的几个字段，故意不绑死 MetaLeadsSyncResult 全貌。 */
export interface LeadsSyncOutcome {
  clientId?: string
  clientName: string | null
  error?: string
  /**
   * 这一轮为什么没跑起来（如果有）。目前只有 `page_not_verified`：Meta 还没
   * 验证这个主页的绑定，取数接口直接拒绝。跟 `error` 可以同时存在。
   */
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

/** 一个客户这一轮的状态：跑通了 / 被外部原因挡住 / 真的失败了。 */
export type LeadsSyncReceiptState = 'ok' | 'blocked' | 'failed'

/** 逐客户的回执，喂给 PM todo 检测器和日报。 */
export interface LeadsSyncReceipt {
  clientId: string | null
  clientName: string | null
  state: LeadsSyncReceiptState
  detail: string | null
}

/**
 * 把一个客户的结果归成三态之一。
 *
 * `blocked` 优先于 `failed`：主页没验证（`skipped === 'page_not_verified'`）
 * 或 Facebook 授权过期（`isFacebookAuthError`）都是外部原因，各自有 PM todo
 * 盯着，不该把整轮跑标成失败。
 */
export function classifyLeadsSyncOutcome(r: LeadsSyncOutcome): LeadsSyncReceipt {
  const clientId = r.clientId ?? null
  const clientName = r.clientName

  if (r.skipped === 'page_not_verified') {
    return { clientId, clientName, state: 'blocked', detail: r.error ?? 'page_not_verified' }
  }

  if (r.error) {
    // leads-sync 把一个客户多个表单的报错用 ' | ' 拼成一句：只有每一段都是授权类才算
    // blocked，混着真错误（500、代码异常）就是 failed，不能让授权错把它们一起吞掉。
    const parts = r.error.split(' | ').filter((p) => p.trim())
    const allAuth = parts.length > 0 && parts.every(isAuthBlockedError)
    return { clientId, clientName, state: allAuth ? 'blocked' : 'failed', detail: r.error }
  }

  // 没报错但被跳过（缺主页 ID / 缺令牌等）：没同步 ≠ ok，回执里如实标出来。
  if (r.skipped) {
    return { clientId, clientName, state: 'blocked', detail: r.skipped }
  }

  return { clientId, clientName, state: 'ok', detail: null }
}

/** Meta 把限流 / 参数错误也标成 OAuthException：这些不是授权失效，不能算 blocked。 */
const NON_AUTH_OAUTH_CODES = /code"?\s*[:=]\s*(?:4|17|32|100|613)\b/

function isAuthBlockedError(segment: string): boolean {
  return isFacebookAuthError(segment) && !NON_AUTH_OAUTH_CODES.test(segment)
}

/** 逐客户回执，顺序跟入参一致。 */
export function buildLeadsSyncReceipts(results: readonly LeadsSyncOutcome[]): LeadsSyncReceipt[] {
  return results.map(classifyLeadsSyncOutcome)
}

/**
 * 全好时返回 undefined，`finish()` 就仍把这次跑标成 completed —— 不制造新噪音。
 *
 * **按报错原文去重**是关键，不是顺手优化：一把令牌失效时 N 家的报错是同一句，
 * 不去重会把邮件仅有的 200 字符用同一句话刷满，真正不同的病因反而被挤掉。
 */
export function summariseFailures(results: readonly LeadsSyncOutcome[]): string | undefined {
  // 只算 `failed`：`blocked` 的客户有自己的 PM todo 盯着，不该在这里再喊一遍。
  const failures = results.filter((r) => classifyLeadsSyncOutcome(r).state === 'failed')
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
 * 喂给 `cronRun.finish({ error })` 的那一行。两类病都没有时 undefined
 * （这次跑仍标 completed，不制造新噪音）。
 *
 * 「取不到线索」排在前面：人根本没进来比「进来了没进名单」严重，而日报邮件
 * 只截前 200 字符，先说的那句才保证看得见。两句的完整原文都在
 * `cron_run_logs.error_message` 里，追查时不会丢。
 */
export function summariseSyncProblems(results: readonly LeadsSyncOutcome[]): string | undefined {
  const parts = [summariseFailures(results), summariseOutletGaps(results)].filter(
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

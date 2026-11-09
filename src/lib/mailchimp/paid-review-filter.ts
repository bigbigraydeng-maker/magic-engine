/**
 * 从「客人自称付款、待人工核对」的名单里，剔除 PM 已经处理过的人。
 *
 * ## 为什么写入侧过滤还不够（Codex P1 复审 PR #1484）
 *
 * `runPaidTagging` 在**写入侧**已经加了一道：归入 `needsReview` 之前先反查
 * Mailchimp，已经打过 paidTag 就不写。但今日待办的**读取侧**
 * (`pushPaidSignalReviewItems`) 遍历的是**最近 7 天所有**跑完的运行记录 ——
 * PM 今天处理完，今天的 summary 里确实没有他了，可**昨天、前天的 summary 里
 * 还在**，读取侧照样把他捞出来。
 *
 * 结果：同一条待办仍旧天天出现，直到旧日志滚出 7 天窗口 —— PR #1484 声称的
 * 「处理完自然不再命中」并没有真正实现。
 *
 * 为什么不能只看最近一次运行：那 7 天窗口是有原因的（见
 * `pushPaidSignalReviewItems` 头注的三个漏法）—— cron 日常只回溯 3 天，一条
 * 待确认第 1 天出现、三天没人处理，第 4 天就扫不到了。砍掉窗口会让待办凭空消失。
 *
 * 所以正确做法是：窗口照旧，但**在生成待办的那一刻，按 Mailchimp 当前的真实
 * 标签再过滤一次**。判据跟真实状态同源 —— 这也是 `price_claim_unbacked`
 * 那条注释推崇的模式：「判定条件跟闸本身同源，改好就自己消失」。
 *
 * ## fail-open，不是 fail-closed
 *
 * 查不到、查出错、没配 API key、客户没配 audience —— 一律**保留**这个人。
 * 这条链路的两个失败方向代价不对等：多提醒一次只是烦；漏掉一条真待处理的
 * 付款确认，客人会继续收到营销邮件（正是 2026-09-01 那次 192 人群发的事故）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { findMemberByEmail, type FetchLike } from './tags'
import { readPaidTag } from './paid-tagging'
import { isUndefinedColumn } from './audience-config'

export interface PaidReviewCandidate {
  /** 客人邮箱（大小写不敏感，内部统一小写比较） */
  email: string
  /** 这条记录属于哪个客户 —— audience 和标签名都是按客户配的 */
  clientId: string
  /** Current configured tag, when configuration was readable. */
  paidTag?: string
}

/** 一个客户的 Mailchimp 出口配置。读不出来的客户不参与过滤（fail-open）。 */
interface ClientMailchimpConfig {
  audienceId: string
  paidTag: string
}

/**
 * 读若干客户的 audience + 付费标签名。
 *
 * `mailchimp_audience_id` 专列可能还没 apply（42703），那时退回 `leads_config`
 * 里的 jsonb —— 跟 `audience-config.ts` 的兜底顺序一致。这里一次把两个字段都
 * 拿到，避免每个客户查两遍。
 */
async function readConfigs(
  supabase: SupabaseClient,
  clientIds: readonly string[],
): Promise<Map<string, ClientMailchimpConfig>> {
  const out = new Map<string, ClientMailchimpConfig>()
  if (clientIds.length === 0) return out

  // 先试带专列的查询；专列不存在时 Postgres 报 42703，退回只读 leads_config。
  let rows: Array<{ id: string; mailchimp_audience_id?: unknown; leads_config?: unknown }> = []
  const withColumn = await supabase
    .from('clients')
    .select('id, mailchimp_audience_id, leads_config')
    .in('id', clientIds as string[])

  if (withColumn.error) {
    if (!isUndefinedColumn(withColumn.error)) return out
    const fallback = await supabase
      .from('clients')
      .select('id, leads_config')
      .in('id', clientIds as string[])
    // 连兜底都失败 = 读不到配置，返回空表让调用方 fail-open 保留全部
    if (fallback.error) return out
    rows = (fallback.data ?? []) as typeof rows
  } else {
    rows = (withColumn.data ?? []) as typeof rows
  }

  for (const r of rows) {
    const dedicated = typeof r.mailchimp_audience_id === 'string' ? r.mailchimp_audience_id.trim() : ''
    const fromJsonb =
      typeof (r.leads_config as { mailchimp_audience_id?: unknown } | null)?.mailchimp_audience_id === 'string'
        ? String((r.leads_config as { mailchimp_audience_id: string }).mailchimp_audience_id).trim()
        : ''
    // 专列查得到就是权威结果（空串代表运营明确关掉了出口，不再兜底 jsonb）——
    // 跟 audience-config.ts 的 pickDedicatedAudienceId 同一口径。
    const audienceId = 'mailchimp_audience_id' in r ? dedicated : fromJsonb
    if (!audienceId) continue
    out.set(r.id, { audienceId, paidTag: readPaidTag(r.leads_config) })
  }
  return out
}

/** 同时反查几个邮箱 —— 串行会让 N 个候选人乘上单次超时，轻松吃满调用方的整体时限。 */
const DEFAULT_CONCURRENCY = 5
/** 单次反查给多少时间 —— 比 tags.ts 的 20s 默认短得多，配合并发把整批控制在总预算内。 */
const DEFAULT_PER_REQUEST_TIMEOUT_MS = 5_000
/**
 * 整批反查的总预算 —— 必须**远小于**调用方 `pm-daily-todo`（`render.yaml`）
 * 的 120s curl `--max-time`，因为这批查询只是那次运行里的一步，不能独占整个时限
 * （Codex P1 复审 PR #1484：6 个以上候选人时串行反查会累计超过 120s，
 * 连带把同一次运行里其他待办邮件一起杀掉）。
 *
 * 预算到点后**停止再发起新请求**，剩下没查到的候选人一律保留（fail-open，
 * 跟查不到 / 出错时同一条纪律 —— 见文件头「fail-open，不是 fail-closed」）。
 */
const DEFAULT_BUDGET_MS = 15_000

/**
 * 剔除「PM 已经在 Mailchimp 打过付费标签」的候选人。
 *
 * 返回**应该继续下发**的那些。查不到 / 出错 / 预算用完没来得及查的一律保留。
 */
export async function dropAlreadyPaidTagged(
  supabase: SupabaseClient,
  candidates: readonly PaidReviewCandidate[],
  opts: {
    apiKey?: string
    fetchImpl?: FetchLike
    timeoutMs?: number
    concurrency?: number
    budgetMs?: number
  } = {},
): Promise<PaidReviewCandidate[]> {
  const apiKey = opts.apiKey ?? process.env.MAILCHIMP_API_KEY ?? ''
  // 没 key 就没法查 —— 全部保留，绝不因为查不了就当成「都处理过了」
  if (candidates.length === 0) return []

  const configs = await readConfigs(
    supabase,
    Array.from(new Set(candidates.map((c) => c.clientId))),
  )
  const withTags = candidates.map((c) => ({ ...c, paidTag: configs.get(c.clientId)?.paidTag }))
  if (!apiKey) return withTags

  const timeoutMs = opts.timeoutMs ?? DEFAULT_PER_REQUEST_TIMEOUT_MS
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, candidates.length))
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS)

  // 每个候选人默认保留（fail-open）；worker 只在查出「确实已打标签」时才翻成 false。
  const keep = new Array<boolean>(candidates.length).fill(true)
  // 同一个邮箱在同一个客户下只查一次（同一批里可能有重复）—— 存 Promise 而不是
  // 查完的结果，让并发 worker 撞上同一个 key 时也能共享同一次在途请求，
  // 不然并发下两个 worker 会在对方查完前都以为「还没查过」而各发一次。
  const inFlight = new Map<string, Promise<boolean>>()

  function lookup(cfg: ClientMailchimpConfig, email: string, cacheKey: string): Promise<boolean> {
    const existing = inFlight.get(cacheKey)
    if (existing) return existing
    const p = (async () => {
      try {
        const found = await findMemberByEmail(
          { apiKey, audienceId: cfg.audienceId, fetchImpl: opts.fetchImpl, timeoutMs },
          email,
        )
        return found.status === 'found' && found.member.tags.includes(cfg.paidTag)
      } catch {
        // 网络炸了也按「还没处理」算
        return false
      }
    })()
    inFlight.set(cacheKey, p)
    return p
  }

  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++
      if (i >= candidates.length) return
      // 预算用完 —— 不再发起新的反查，这个及之后没轮到的候选人保持默认的「保留」。
      if (Date.now() >= deadline) return

      const c = candidates[i]
      const cfg = configs.get(c.clientId)
      if (!cfg) continue // 这个客户读不出 Mailchimp 配置 → 没法判断 → 保留（keep[i] 已是 true）

      const cacheKey = `${c.clientId}::${c.email.trim().toLowerCase()}`
      const alreadyTagged = await lookup(cfg, c.email, cacheKey)
      keep[i] = !alreadyTagged
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  return withTags.filter((_, i) => keep[i])
}

/**
 * AI 全自动审核的"异常刹车"（PM 拍板 2026-09-15："不用人一条条点，但要有异常刹车"）。
 *
 * 复用 `src/lib/flywheel/anomaly/rules.ts` 的**设计模式**（规则表 + 纯函数
 * `detect(input) → result|null`）——但不复用它的类型本身（子牙复审 MEDIUM）：
 * 那个文件是给 DAPE 六支柱指标"变差了要不要提醒"设计的，语义是"软提醒，业务照跑"；
 * 这里要的是"命中就硬熔断，整条自动处理暂停"，两种后果不该共用同一个类型定义，
 * 否则以后有人往 `ANOMALY_RULES` 里加新支柱规则时会照抄"只通知不阻断"的语义。
 *
 * 🔴 每条规则都同时有一个"相对历史基线的比例阈值"和一个"不随基线抬升的绝对值上限"
 *    （魏征复审 M1：纯相对阈值会被"温水煮青蛙"——每次只比均值高一点点，均值本身
 *    被污染后逐步抬高，长期小额多次就能绕过去）。命中任一个就算触发。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CircuitBreakerRule =
  | 'volume_spike'
  | 'amount_spike'
  | 'uncertain_backlog'
  | 'single_record_amount'
  | 'approval_rate_spike'

export type CircuitBreakerVerdict =
  | { tripped: false }
  | { tripped: true; rule: CircuitBreakerRule; detail: string }

/** 历史基线取多少天的滚动平均。 */
const BASELINE_WINDOW_DAYS = 7
/** "远超"历史均值的倍数——均值再低，也不能无限放大成"随便发都不算异常"。 */
const RELATIVE_MULTIPLIER = 3
/** 不管历史均值多低，这两个是硬顶（按客户体量差异很大，先给一个保守默认值，
 *  真上线后可以按 `clients` 表加一列覆盖，目前这两个客户体量都在这个量级内）。 */
const ABSOLUTE_MAX_APPROVED_PER_DAY = 30
const ABSOLUTE_MAX_AMOUNT_MINOR_PER_DAY = 50_000_00 // 50,000 元（含税）为单位货币的粗略硬顶
/** uncertain 堆积多少条就算"AI 普遍判不了这个客户的数据，需要人看一眼"。 */
const UNCERTAIN_BACKLOG_THRESHOLD = 10
/** 单条金额超过历史最大单笔的这个倍数，防"多打一个零"。 */
const SINGLE_RECORD_MAX_MULTIPLIER = 5
/** AI 上线初期没有"历史批准率"基线，先用一个保守的静态占比上限过渡。 */
const STATIC_APPROVAL_RATE_CAP = 0.9

type OutcomeAmountRow = { amount_minor: number | null }

async function fetchApprovedLast24h(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<{ count: number; amountMinor: number }> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('amount_minor')
    .eq('client_id', clientId)
    .eq('review_status', 'approved')
    .eq('reviewed_by', AI_REVIEWER_IDENTITY)
    .gte('reviewed_at', since)

  if (error) throw new Error(`查最近 24 小时 AI 批准记录失败：${error.message}`)
  const rows = (data ?? []) as OutcomeAmountRow[]
  return {
    count: rows.length,
    amountMinor: rows.reduce((sum, r) => sum + (r.amount_minor ?? 0), 0),
  }
}

async function fetchBaselineDailyAverage(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<{ avgCount: number; avgAmountMinor: number; maxSingleAmountMinor: number }> {
  const since = new Date(now.getTime() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('amount_minor, reviewed_at')
    .eq('client_id', clientId)
    .eq('review_status', 'approved')
    .gte('reviewed_at', since)

  if (error) throw new Error(`查历史基线失败：${error.message}`)
  const rows = (data ?? []) as { amount_minor: number | null; reviewed_at: string | null }[]
  const amounts = rows.map((r) => r.amount_minor ?? 0)
  const maxSingleAmountMinor = amounts.length > 0 ? Math.max(...amounts) : 0
  const totalAmount = amounts.reduce((a, b) => a + b, 0)
  return {
    avgCount: rows.length / BASELINE_WINDOW_DAYS,
    avgAmountMinor: totalAmount / BASELINE_WINDOW_DAYS,
    maxSingleAmountMinor,
  }
}

async function fetchUncertainBacklogCount(
  supabase: SupabaseClient,
  clientId: string,
  minAttempts: number,
): Promise<number> {
  const { count, error } = await supabase
    .from('me_sale_outcomes')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('review_status', 'pending_review')
    .gte('ai_review_attempts', minAttempts)

  if (error) throw new Error(`查 uncertain 堆积数失败：${error.message}`)
  return count ?? 0
}

/**
 * "AI 判断过几条、其中批了几条"——直接查 `me_sale_outcomes`（不查 `me_conversion_audit`）：
 * 审计表没有 `client_id` 列，要按客户过滤得走 `detail->>'client_id'` 这种 jsonb 路径查询，
 * 没必要——`ai_last_reviewed_at` 在每次 AI 判断（不管结果是什么）都会被打上，直接查
 * 这一列比查审计表的 jsonb 字段更直接、也更好测。
 */
async function fetchLast24hJudgedCounts(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<{ approved: number; total: number }> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('review_status, reviewed_by')
    .eq('client_id', clientId)
    .gte('ai_last_reviewed_at', since)

  if (error) throw new Error(`查最近 24 小时 AI 判断次数失败：${error.message}`)
  const rows = (data ?? []) as { review_status: string; reviewed_by: string | null }[]
  return {
    approved: rows.filter((r) => r.review_status === 'approved' && r.reviewed_by === AI_REVIEWER_IDENTITY).length,
    total: rows.length,
  }
}

export const AI_REVIEWER_IDENTITY = 'ai-auto-review@system'

/**
 * 检查一个客户当前是否应该触发异常刹车。命中任一规则就返回 `tripped: true`，
 * 调用方负责把这个客户的 `ai_auto_review_enabled` 关掉并通知 PM。
 *
 * 只读，不改任何状态——熔断动作本身（关开关、写审计、生成待办）由调用方做，
 * 保持这个函数纯粹、好测。
 */
export async function checkCircuitBreaker(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<CircuitBreakerVerdict> {
  const [recent, baseline, uncertainBacklog, judged] = await Promise.all([
    fetchApprovedLast24h(supabase, clientId, now),
    fetchBaselineDailyAverage(supabase, clientId, now),
    fetchUncertainBacklogCount(supabase, clientId, 1),
    fetchLast24hJudgedCounts(supabase, clientId, now),
  ])

  // ── 笔数异常：相对基线 或 绝对硬顶，任一命中 ──────────────────────────
  const volumeRelativeLimit = Math.max(baseline.avgCount * RELATIVE_MULTIPLIER, 1)
  if (recent.count > volumeRelativeLimit || recent.count > ABSOLUTE_MAX_APPROVED_PER_DAY) {
    return {
      tripped: true,
      rule: 'volume_spike',
      detail: `近 24 小时 AI 批准并发送了 ${recent.count} 笔，历史日均 ${baseline.avgCount.toFixed(1)} 笔（硬顶 ${ABSOLUTE_MAX_APPROVED_PER_DAY} 笔）`,
    }
  }

  // ── 金额异常：相对基线 或 绝对硬顶 ─────────────────────────────────────
  const amountRelativeLimit = Math.max(baseline.avgAmountMinor * RELATIVE_MULTIPLIER, 1)
  if (recent.amountMinor > amountRelativeLimit || recent.amountMinor > ABSOLUTE_MAX_AMOUNT_MINOR_PER_DAY) {
    return {
      tripped: true,
      rule: 'amount_spike',
      detail: `近 24 小时 AI 批准并发送的金额合计 ${(recent.amountMinor / 100).toFixed(2)}，历史日均 ${(baseline.avgAmountMinor / 100).toFixed(2)}`,
    }
  }

  // ── uncertain 堆积：AI 对这个客户的数据普遍判不了 ─────────────────────
  if (uncertainBacklog >= UNCERTAIN_BACKLOG_THRESHOLD) {
    return {
      tripped: true,
      rule: 'uncertain_backlog',
      detail: `有 ${uncertainBacklog} 条记录 AI 判不出来（uncertain），可能是这个客户的数据出了什么问题`,
    }
  }

  // 单笔金额异常（防"多打一个零"）由 `isSingleRecordAmountAnomalous()` 在
  // `ai-auto-review-run.ts` 处理每一条记录时就地检查，不在这里做批量汇总——
  // 等到 24 小时汇总层面才发现，为时已晚（那笔钱已经真的发出去了）。

  // ── 批准占比异常：总量没涨，但该拒的都放行了 ─────────────────────────
  if (judged.total >= 5) {
    const approvalRate = judged.approved / judged.total
    if (approvalRate > STATIC_APPROVAL_RATE_CAP) {
      return {
        tripped: true,
        rule: 'approval_rate_spike',
        detail: `近 24 小时 AI 判断的批准占比 ${(approvalRate * 100).toFixed(0)}%（共判 ${judged.total} 条），超过 ${(STATIC_APPROVAL_RATE_CAP * 100).toFixed(0)}% 的上限`,
      }
    }
  }

  return { tripped: false }
}

/**
 * 单条记录级别的"金额是不是离谱"检查——魏征复审要求"不用等到批量统计层面才发现"，
 * 在处理每一条记录时就地调用，命中就把这一条单独当作触发信号（不需要等到 24 小时汇总）。
 */
export function isSingleRecordAmountAnomalous(
  amountMinor: number | null,
  historicalMaxSingleAmountMinor: number,
): boolean {
  if (amountMinor == null || historicalMaxSingleAmountMinor <= 0) return false
  return amountMinor > historicalMaxSingleAmountMinor * SINGLE_RECORD_MAX_MULTIPLIER
}

export { fetchBaselineDailyAverage }

/**
 * 成交审核 AI 全自动判断的批处理入口（PM 拍板 2026-09-15）。
 *
 * 这里把 `ai-auto-review.ts`（判断）、`ai-auto-review-circuit-breaker.ts`（熔断）、
 * `writeback-service.ts`（发送，完全不改动它内部任何一道既有安全闸）三块粘起来。
 *
 * 🟢 **已作废（2026-09-15 更新）**：下面这段原本写的是"这一版只有手动触发路由，
 * 没有接 Inngest 定时"——那是子牙复审当时的建议（先观察几天判断质量和熔断阈值再
 * 决定）。PM 看到一次干净的手动试跑结果（NAL 15 条：14 条正确判过期、1 条 uncertain、
 * 0 条误发）之后，在会话里明确拍板"做"，直接接了定时——见
 * `src/lib/inngest/functions/conversion-daily-pipeline.ts`（每天 06:00 Pacific/Auckland
 * 调这个文件的 `runAiAutoReviewForClient()`）。这个函数本身**没有变**，变的只是
 * "谁在什么时候调用它"——手动触发路由 `ai-auto-review-run/route.ts` 依然存在，
 * 两条调用路径并存，不是二选一。原段落保留在下面，只为留档"当初为什么先手动"：
 *
 * ~~这一版只有手动触发路由，没有接 Inngest 定时（子牙复审 BLOCKER：草稿原计划
 * 照抄的 `nal-messenger-sync`/`cts-crm-sync` 恰恰是"先纯手动观察"的先例，不是"双轨
 * 模式"，全自动+真发送的风险比那两个"只写 pending_review、人还要再点一次"的场景更高，
 * 更应该先观察几天再决定要不要接定时）。要不要接 Inngest 定时，等手动跑几天、判断质量
 * 和熔断阈值都校准过之后再评估——见 ROADMAP 里的记录。~~
 *
 * 🔴 每个客户开工前先查 `clients.ai_auto_review_enabled`——这是唯一独立于异常熔断的
 * 停止开关（魏征复审 BLOCKER：原方案只有"命中异常规则才会停"，PM 自己想随时喊停却
 * 没有能立刻按的按钮）。同构复用 `messenger_agent_enabled_*` 那套"一个字段管一件事"
 * 的开关模式，不新开第二套语义。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { judgeOutcome, type AiReviewInput } from './ai-auto-review'
import {
  checkCircuitBreaker,
  isSingleRecordAmountAnomalous,
  fetchBaselineDailyAverage,
  AI_REVIEWER_IDENTITY,
  type CircuitBreakerRule,
} from './ai-auto-review-circuit-breaker'
import { sendApprovedOutcome, type SendDeps } from './writeback-service'

/** 一次批处理最多处理这么多条——限制单次运行的最坏影响范围，跟熔断是两道独立的闸。 */
export const MAX_BATCH_SIZE = 50
/** AI 判过几次还是 uncertain 就不再自动重判，等人来看（复用今日待办既有的 pending_review 展示）。 */
export const MAX_UNCERTAIN_ATTEMPTS = 3
/** 判过 uncertain 之后，多久才允许下一次批处理再判一次——避免几分钟内被连续两次批处理重复判断。 */
const UNCERTAIN_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000
/** 广告平台只收这么多天内的事件——比这更老的直接判过期，省一次 AI 调用。 */
const META_WINDOW_DAYS = 7
/**
 * 单次批处理内部的运行中止损硬顶——独立于历史基线的熔断（那个只在开工前查一次）。
 * 防的是"这一次批处理本身，因为 AI 判断链路当场出了问题，在几十条之内就把大量
 * 本该拒绝的记录批了"，命中就中止本轮剩下的记录（魏征复审：单次批处理内部也要
 * 有自己的止损，不能只靠下一轮的熔断检查才发现）。导出常量方便测试直接驱动到位，
 * 不需要在测试里手写魔法数字或者铺几十条假记录。
 */
export const BATCH_HARD_STOP_COUNT = 20
export const BATCH_HARD_STOP_AMOUNT_MINOR = 30_000_00

/**
 * 直接对应 `.select(...)` 里列出的那几列。这不是从任意 JSON 猜出来的形状——
 * 字段名跟下面 `select()` 调用里的字符串逐一对应，改列名要两边一起改。
 */
export type PendingOutcomeRow = {
  id: string
  client_id: string
  contact_id: string | null
  outcome_kind: 'purchase' | 'balance' | 'lead'
  customer_first: string | null
  customer_last: string | null
  amount_minor: number | null
  currency: string | null
  source_kind: string
  occurred_at: string
  ai_review_attempts: number
  ai_last_reviewed_at: string | null
}

export type RunItemResult = {
  outcomeId: string
  verdict: 'approve' | 'reject' | 'uncertain' | 'expired'
  message: string
}

export type RunSummary =
  | { ran: false; reason: 'disabled' | 'circuit_breaker_tripped' | 'error'; detail?: string }
  | { ran: true; processed: number; approved: number; rejected: number; uncertain: number; expired: number; items: RunItemResult[] }

export type AiAutoReviewRunDeps = {
  supabase: SupabaseClient
  sendDeps: Omit<SendDeps, 'supabase'>
  now?: Date
  /** 熔断触发后的通知——由调用方决定怎么下发（PM 待办管道），保持这个文件专注状态机。 */
  onCircuitBreakerTripped?: (params: { clientId: string; rule: CircuitBreakerRule; detail: string }) => Promise<void>
}

/**
 * 对一个客户跑一轮 AI 全自动审核。返回这一轮做了什么，方便手动触发路由如实回报。
 */
export async function runAiAutoReviewForClient(
  clientId: string,
  deps: AiAutoReviewRunDeps,
): Promise<RunSummary> {
  const { supabase } = deps
  const now = deps.now ?? new Date()

  const { data: clientRow, error: clientErr } = await supabase
    .from('clients')
    .select('id, ai_auto_review_enabled')
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) throw new Error(`读取客户配置失败：${clientErr.message}`)
  if (!clientRow) throw new Error('客户不存在')
  const clientEnabled = clientRow as { ai_auto_review_enabled: boolean }
  if (!clientEnabled.ai_auto_review_enabled) {
    return { ran: false, reason: 'disabled' }
  }

  // ── 开工前先查熔断：命中就整批不处理，只暂停+通知 ─────────────────────
  const breaker = await checkCircuitBreaker(supabase, clientId, now)
  if (breaker.tripped) {
    await tripCircuitBreaker(supabase, clientId, breaker.rule, breaker.detail)
    if (deps.onCircuitBreakerTripped) {
      await deps.onCircuitBreakerTripped({ clientId, rule: breaker.rule, detail: breaker.detail })
    }
    return { ran: false, reason: 'circuit_breaker_tripped', detail: breaker.detail }
  }

  const baseline = await fetchBaselineDailyAverage(supabase, clientId, now)

  const cooldownCutoff = new Date(now.getTime() - UNCERTAIN_RETRY_COOLDOWN_MS).toISOString()
  const { data: pending, error: pendingErr } = await supabase
    .from('me_sale_outcomes')
    .select(
      'id, client_id, contact_id, outcome_kind, customer_first, customer_last, ' +
        'amount_minor, currency, source_kind, occurred_at, ai_review_attempts, ai_last_reviewed_at',
    )
    .eq('client_id', clientId)
    .eq('review_status', 'pending_review')
    .is('redacted_at', null)
    .lt('ai_review_attempts', MAX_UNCERTAIN_ATTEMPTS)
    .or(`ai_last_reviewed_at.is.null,ai_last_reviewed_at.lt.${cooldownCutoff}`)
    .order('occurred_at', { ascending: true })
    .limit(MAX_BATCH_SIZE)

  if (pendingErr) throw new Error(`读取待审核记录失败：${pendingErr.message}`)

  // 实测核实：select() 只取了上面列出的那几列，字段名跟 PendingOutcomeRow 逐一对应
  // （不是从任意形状猜的），跟 writeback-service.ts 里 OutcomeRow 的同款断言一致
  // ——这里是唯一一处需要断言 Supabase 泛型返回值形状的地方。
  const rows = (pending ?? []) as unknown as PendingOutcomeRow[]
  const items: RunItemResult[] = []
  let approved = 0
  let rejected = 0
  let uncertain = 0
  let expired = 0

  // 这一轮内部的运行中汇总——见文件头 `BATCH_HARD_STOP_COUNT`/`_AMOUNT_MINOR` 的说明。
  let batchApprovedCount = 0
  let batchApprovedAmountMinor = 0

  for (const row of rows) {
    if (batchApprovedCount >= BATCH_HARD_STOP_COUNT || batchApprovedAmountMinor >= BATCH_HARD_STOP_AMOUNT_MINOR) {
      await tripCircuitBreaker(
        supabase,
        clientId,
        'volume_spike',
        `本次批处理内已批准 ${batchApprovedCount} 笔、合计 ${(batchApprovedAmountMinor / 100).toFixed(2)}，达到单次运行硬顶，提前停止本轮剩余记录`,
      )
      if (deps.onCircuitBreakerTripped) {
        await deps.onCircuitBreakerTripped({
          clientId,
          rule: 'volume_spike',
          detail: `单次批处理内硬顶触发，已处理 ${items.length}/${rows.length} 条后停止`,
        })
      }
      break
    }

    const ageDays = Math.floor((now.getTime() - new Date(row.occurred_at).getTime()) / 86_400_000)

    // 明显过期的不浪费一次 AI 调用，直接判过期不发送。
    if (ageDays > META_WINDOW_DAYS) {
      const didReject = await rejectOutcome(
        supabase,
        row.id,
        'other',
        `已超过广告平台 ${META_WINDOW_DAYS} 天时间窗口，系统自动标记不发送`,
        now,
      )
      if (!didReject) {
        // 已经被人工页面抢先处理过了，不写一条跟事实不符的"AI 已拒绝"审计。
        items.push({ outcomeId: row.id, verdict: 'uncertain', message: '已被抢先处理，本轮跳过' })
        continue
      }
      await writeAudit(supabase, row.id, 'ai_auto_rejected', {
        reason: 'expired',
        ageDays,
        model: null,
        promptVersion: null,
      })
      expired++
      items.push({ outcomeId: row.id, verdict: 'expired', message: '已过期，自动标记不发送' })
      continue
    }

    if (isSingleRecordAmountAnomalous(row.amount_minor, baseline.maxSingleAmountMinor)) {
      await tripCircuitBreaker(
        supabase,
        clientId,
        'single_record_amount',
        `记录 ${row.id} 金额 ${((row.amount_minor ?? 0) / 100).toFixed(2)} 远超历史单笔最大值 ${(baseline.maxSingleAmountMinor / 100).toFixed(2)}`,
      )
      if (deps.onCircuitBreakerTripped) {
        await deps.onCircuitBreakerTripped({
          clientId,
          rule: 'single_record_amount',
          detail: `单条记录金额异常，已处理 ${items.length}/${rows.length} 条后停止`,
        })
      }
      break
    }

    const judgeInput: AiReviewInput = {
      outcomeKind: row.outcome_kind,
      customerFirst: row.customer_first,
      customerLast: row.customer_last,
      amountMinor: row.amount_minor,
      currency: row.currency,
      sourceKind: row.source_kind,
      occurredAt: row.occurred_at,
      now,
    }
    const verdict = await judgeOutcome(judgeInput)

    // 不管判成什么，都打上"AI 刚看过这条"的时间戳——熔断规则的"批准占比"要靠这个查数。
    await supabase
      .from('me_sale_outcomes')
      .update({ ai_last_reviewed_at: now.toISOString() })
      .eq('id', row.id)

    if (verdict.verdict === 'approve') {
      const ok = await approveOutcome(supabase, row.id, now)
      if (!ok) {
        // 有人（人工页面）抢先处理过了，不重复走发送流程。
        items.push({ outcomeId: row.id, verdict: 'uncertain', message: '已被抢先处理，本轮跳过' })
        continue
      }
      await writeAudit(supabase, row.id, 'ai_auto_approved', {
        reason: verdict.reason,
        model: verdict.model,
        promptVersion: verdict.promptVersion,
        inputSnapshot: verdict.inputSnapshot,
        rawOutput: verdict.rawOutput,
      })

      let sendMessage = '已批准，发送时出错，可以稍后在页面上重试'
      try {
        const sendResult = await sendApprovedOutcome(row.id, { supabase, ...deps.sendDeps, now })
        sendMessage = sendResult.message
        await writeAudit(supabase, row.id, 'sent', { status: sendResult.status })
      } catch (e) {
        sendMessage = `已批准，但发送时出错：${e instanceof Error ? e.message : String(e)}`
      }

      approved++
      batchApprovedCount++
      batchApprovedAmountMinor += row.amount_minor ?? 0
      items.push({ outcomeId: row.id, verdict: 'approve', message: sendMessage })
    } else if (verdict.verdict === 'reject') {
      const didReject = await rejectOutcome(supabase, row.id, 'other', verdict.reason, now)
      if (!didReject) {
        // 已经被人工页面抢先处理过了，不写一条跟事实不符的"AI 已拒绝"审计。
        items.push({ outcomeId: row.id, verdict: 'uncertain', message: '已被抢先处理，本轮跳过' })
        continue
      }
      await writeAudit(supabase, row.id, 'ai_auto_rejected', {
        reason: verdict.reason,
        model: verdict.model,
        promptVersion: verdict.promptVersion,
        inputSnapshot: verdict.inputSnapshot,
        rawOutput: verdict.rawOutput,
      })
      rejected++
      items.push({ outcomeId: row.id, verdict: 'reject', message: verdict.reason })
    } else {
      await supabase
        .from('me_sale_outcomes')
        .update({ ai_review_attempts: row.ai_review_attempts + 1 })
        .eq('id', row.id)
      await writeAudit(supabase, row.id, 'ai_auto_uncertain', {
        reason: verdict.reason,
        attempt: row.ai_review_attempts + 1,
        model: verdict.model,
        promptVersion: verdict.promptVersion,
        inputSnapshot: verdict.inputSnapshot,
        rawOutput: verdict.rawOutput,
      })
      uncertain++
      items.push({ outcomeId: row.id, verdict: 'uncertain', message: verdict.reason })
    }
  }

  return { ran: true, processed: items.length, approved, rejected, uncertain, expired, items }
}

/** CAS：只在 pending_review 时才批准，返回是否真的改到了（防跟人工页面并发抢跑）。 */
async function approveOutcome(supabase: SupabaseClient, outcomeId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'approved',
      reviewed_by: AI_REVIEWER_IDENTITY,
      reviewed_at: now.toISOString(),
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: crypto.randomUUID(),
      updated_at: now.toISOString(),
    })
    .eq('id', outcomeId)
    .eq('review_status', 'pending_review')
    .select('id')

  if (error) throw new Error(`批准失败：${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * CAS：只在 pending_review 时才拒绝，返回是否真的改到了——跟 `approveOutcome()`
 * 对称（魏征最终复审 MEDIUM：原来这里没判受影响行数，如果这条记录已经被人工
 * 页面抢先批准并发送，这里的 UPDATE 会静默匹配 0 行，但调用方仍然会写一条
 * "AI 已拒绝"的审计记录——审计说的和实际发生的对不上）。
 */
async function rejectOutcome(
  supabase: SupabaseClient,
  outcomeId: string,
  reason: string,
  note: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'rejected',
      reject_reason: reason,
      reject_note: note,
      reviewed_by: AI_REVIEWER_IDENTITY,
      reviewed_at: now.toISOString(),
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: crypto.randomUUID(),
      updated_at: now.toISOString(),
    })
    .eq('id', outcomeId)
    .eq('review_status', 'pending_review')
    .select('id')

  if (error) throw new Error(`拒绝失败：${error.message}`)
  return (data?.length ?? 0) > 0
}

async function writeAudit(
  supabase: SupabaseClient,
  outcomeId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await supabase.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action,
    actor: AI_REVIEWER_IDENTITY,
    detail,
  })
}

/**
 * 熔断触发：先关开关、再写审计（同构复用 `kill-switch.ts` 的顺序原则——
 * 开关没关成，审计写了也没用；开关关了，审计写失败，安全的方向仍然是"已经停了"）。
 */
async function tripCircuitBreaker(
  supabase: SupabaseClient,
  clientId: string,
  rule: CircuitBreakerRule,
  detail: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('clients')
    .update({ ai_auto_review_enabled: false, ai_auto_review_paused_reason: `${rule}: ${detail}` })
    .eq('id', clientId)
    .select('id')

  if (error) throw new Error(`熔断暂停失败：${error.message}`)
  if ((data?.length ?? 0) === 0) throw new Error('熔断暂停失败：客户不存在')

  await supabase.from('me_conversion_audit').insert({
    action: 'circuit_breaker_tripped',
    actor: AI_REVIEWER_IDENTITY,
    detail: { client_id: clientId, rule, detail },
  })
}

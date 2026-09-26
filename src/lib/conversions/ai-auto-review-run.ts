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
import { approvalCutoffIso, eventAgeMs, isTooLateToApprove, DAY_MS, META_EVENT_WINDOW_DAYS } from './event-window'

/** 一次批处理最多处理这么多条——限制单次运行的最坏影响范围，跟熔断是两道独立的闸。 */
export const MAX_BATCH_SIZE = 50
/** AI 判过几次还是 uncertain 就不再自动重判，等人来看（复用今日待办既有的 pending_review 展示）。 */
export const MAX_UNCERTAIN_ATTEMPTS = 3
/** 判过 uncertain 之后，多久才允许下一次批处理再判一次——避免几分钟内被连续两次批处理重复判断。 */
const UNCERTAIN_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000
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
  | {
      ran: true
      /**
       * 本块处理的总条数 = 直接判过期清掉的（`expired`）+ 交给 AI 判的。两者共用单轮上限，
       * 流水线拿它跟块大小比来决定还要不要跑下一块；想看「AI 真判了几条」请用
       * approved + rejected + uncertain，别直接看这个数。
       */
      processed: number
      approved: number
      /** 本次批准的金额合计（分）——给下一块当硬顶起点用，见 `RunOptions.carried`。 */
      approvedAmountMinor: number
      rejected: number
      uncertain: number
      expired: number
      items: RunItemResult[]
    }

/**
 * 分块调用参数（2026-09-22，`conversion-daily-pipeline` 拆块）。
 *
 * 一批 50 条 × (一次 AI 判断 + 一次发送) 最坏要几分钟，会被网关 ~125 秒超时强杀
 * （PITFALLS F10）。Inngest 那边改成每块几条、循环调本函数；为了让「拆成几块」跟
 * 「一块 50 条」的安全行为**完全一致**，两处要跟着走：
 *   · `carried`：上几块累计批准的条数/金额，作为本块「单次运行硬顶」的起点——
 *     否则硬顶被拆块清零，等于绕过。
 *   · `carried` 存在（非首块）时**跳过开工前的熔断预检**：那个预检按
 *     `ai_last_reviewed_at` 查近 24 小时，会把本次运行前几块刚批的行当成「异常激增」，
 *     第一次跑就把客户开关关掉（子牙/魏征 2026-09-22 设计复审 BLOCKER）。原来一批只
 *     预检一次，拆块后也只在首块预检一次。块内的单笔金额异常检查照旧每条都查。
 */
export type RunOptions = {
  maxBatchSize?: number
  carried?: { approvedCount: number; approvedAmountMinor: number }
}

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
  opts: RunOptions = {},
): Promise<RunSummary> {
  const { supabase } = deps
  const now = deps.now ?? new Date()
  const batchSize = opts.maxBatchSize ?? MAX_BATCH_SIZE

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
  // 非首块（opts.carried 存在）跳过——理由见 RunOptions 的注释。
  if (!opts.carried) {
    const breaker = await checkCircuitBreaker(supabase, clientId, now)
    if (breaker.tripped) {
      await tripCircuitBreaker(supabase, clientId, breaker.rule, breaker.detail)
      if (deps.onCircuitBreakerTripped) {
        await deps.onCircuitBreakerTripped({ clientId, rule: breaker.rule, detail: breaker.detail })
      }
      return { ran: false, reason: 'circuit_breaker_tripped', detail: breaker.detail }
    }
  }

  const baseline = await fetchBaselineDailyAverage(supabase, clientId, now)

  // ── 先清掉已经来不及发的：不看判过几次、不看冷却，一律直接判过期 ────────────
  // 原来只有「判过不到 3 次、且过了冷却」的行才会被捞出来判过期；判满 3 次 uncertain
  // 的行永远停在待审核，过期后只能人手批量拒绝（2026-09-20、09-26 各清过一次）。
  const sweep = await sweepExpiredPending(supabase, clientId, now, batchSize)
  const items: RunItemResult[] = [...sweep.items]
  let expired = sweep.expired
  const remaining = batchSize - sweep.items.length

  const cooldownCutoff = new Date(now.getTime() - UNCERTAIN_RETRY_COOLDOWN_MS).toISOString()
  const { data: pending, error: pendingErr } = remaining <= 0
    ? { data: [], error: null }
    : await supabase
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
    .limit(remaining)

  if (pendingErr) throw new Error(`读取待审核记录失败：${pendingErr.message}`)

  // 实测核实：select() 只取了上面列出的那几列，字段名跟 PendingOutcomeRow 逐一对应
  // （不是从任意形状猜的），跟 writeback-service.ts 里 OutcomeRow 的同款断言一致
  // ——这里是唯一一处需要断言 Supabase 泛型返回值形状的地方。
  const rows = (pending ?? []) as unknown as PendingOutcomeRow[]
  let approved = 0
  let rejected = 0
  let uncertain = 0

  // 这一轮内部的运行中汇总——见文件头 `BATCH_HARD_STOP_COUNT`/`_AMOUNT_MINOR` 的说明。
  // 分块调用时从上几块的累计起算（`opts.carried`），硬顶不因拆块而清零。
  let batchApprovedCount = opts.carried?.approvedCount ?? 0
  let batchApprovedAmountMinor = opts.carried?.approvedAmountMinor ?? 0
  /** 本块自己批了多少（返回值里报的是本块的数，不含 carried）。 */
  let approvedAmountMinorThisCall = 0

  for (const row of rows) {
    if (batchApprovedCount >= BATCH_HARD_STOP_COUNT || batchApprovedAmountMinor >= BATCH_HARD_STOP_AMOUNT_MINOR) {
      await tripCircuitBreaker(
        supabase,
        clientId,
        'volume_spike',
        `本次运行内已批准 ${batchApprovedCount} 笔、合计 ${(batchApprovedAmountMinor / 100).toFixed(2)}` +
          `${opts.carried ? `（含前几块累计 ${opts.carried.approvedCount} 笔）` : ''}，达到单次运行硬顶，提前停止本轮剩余记录`,
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

    // 兜底：上面的清理已经按同一口径处理过，这里正常不会命中；留着防查询条件以后被改漂。
    // 来不及发的绝不交给 AI——模型对「第 7 天算不算」会犹豫，判 uncertain 堆积触发熔断。
    if (isTooLateToApprove(row.occurred_at, now)) {
      const item = await expireOutcome(supabase, row, now)
      if (item.verdict === 'expired') expired++
      items.push(item)
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
    // 🔴 写失败要抛：这个时间戳同时是分块调用的冷却依据（6 小时内不再捞这条），
    //    写丢了下一块会再判一次、再烧一次 AI 调用（魏征 2026-09-22 复审 m3）。
    const { error: stampErr } = await supabase
      .from('me_sale_outcomes')
      .update({ ai_last_reviewed_at: now.toISOString() })
      .eq('id', row.id)
    if (stampErr) throw new Error(`写入 AI 审核时间戳失败：${stampErr.message}`)

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
        // 🔴 不把判断用的 `now` 透传给发送：分块调用时 `now` 是流水线开跑时刻，可能已落后
        //    十几分钟；发送状态机拿它写 `last_attempt_at`、再用它判「卡在 sending 超过 5 分钟」，
        //    过去时的 `last_attempt_at` 会让看板那边把在途发送误判成断线 → in_doubt → 双发
        //    （子牙 2026-09-22 实施后复审 MAJOR）。发送一律用真实时间。
        const sendResult = await sendApprovedOutcome(row.id, { supabase, ...deps.sendDeps })
        sendMessage = sendResult.message
        await writeAudit(supabase, row.id, 'sent', { status: sendResult.status })
      } catch (e) {
        sendMessage = `已批准，但发送时出错：${e instanceof Error ? e.message : String(e)}`
      }

      approved++
      batchApprovedCount++
      batchApprovedAmountMinor += row.amount_minor ?? 0
      approvedAmountMinorThisCall += row.amount_minor ?? 0
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

  return {
    ran: true,
    processed: items.length,
    approved,
    approvedAmountMinor: approvedAmountMinorThisCall,
    rejected,
    uncertain,
    expired,
    items,
  }
}

/**
 * 把「已过期或离过期不到余量」的待审核行直接判不发送，不调 AI。
 * 只挑这一个客户、未脱敏、仍在待审核的行；最多 `limit` 条，跟单轮上限共用一个额度。
 * 不查客户开关——调用方负责（本文件只在开关打开时调用）。
 */
export async function sweepExpiredPending(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
  limit: number = MAX_BATCH_SIZE,
): Promise<{ expired: number; items: RunItemResult[] }> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, occurred_at')
    .eq('client_id', clientId)
    .eq('review_status', 'pending_review')
    .is('redacted_at', null)
    .lt('occurred_at', approvalCutoffIso(now))
    .order('occurred_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`读取已过期待审核记录失败：${error.message}`)

  const items: RunItemResult[] = []
  let expired = 0
  for (const row of (data ?? []) as { id: string; occurred_at: string }[]) {
    const item = await expireOutcome(supabase, row, now)
    if (item.verdict === 'expired') expired++
    items.push(item)
  }
  return { expired, items }
}

async function expireOutcome(
  supabase: SupabaseClient,
  row: { id: string; occurred_at: string },
  now: Date,
): Promise<RunItemResult> {
  const ageDays = eventAgeMs(row.occurred_at, now) / DAY_MS
  const didReject = await rejectOutcome(
    supabase,
    row.id,
    'other',
    `已过去 ${ageDays.toFixed(1)} 天，超过或即将超过广告平台 ${META_EVENT_WINDOW_DAYS} 天时间窗口，系统自动标记不发送`,
    now,
  )
  if (!didReject) {
    // 已经被人工页面抢先处理过了，不写一条跟事实不符的"AI 已拒绝"审计。
    return { outcomeId: row.id, verdict: 'uncertain', message: '已被抢先处理，本轮跳过' }
  }
  await writeAudit(supabase, row.id, 'ai_auto_rejected', {
    reason: 'expired',
    ageDays: Math.round(ageDays * 100) / 100,
    model: null,
    promptVersion: null,
  })
  return { outcomeId: row.id, verdict: 'expired', message: '已过期，自动标记不发送' }
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

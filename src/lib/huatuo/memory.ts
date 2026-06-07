/**
 * 华佗 — Memory Adapter (Phase DAPE W1)
 *
 * Ref: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §3 + §5 Week 1
 *
 * 接通三层 memory 到华佗 prompt：
 *   1. client_learned_preferences (Phase 23 已落地) — via memory service
 *   2. zhuge_feedback_events (诸葛亮反馈学习) — 客户主动反馈 done/dismissed/irrelevant
 *   3. prescription_outcomes (上次处方兑现率) — 实测值 vs 预测值
 *
 * 双 prompt 模式：
 *   - short (~500 tokens) — 自助客户，仅 preferences + 最近 feedback 摘要
 *   - long (~3000 tokens) — FDE 客户，全部三层 + outcome 详细
 *
 * 设计原则：
 *   - 所有子查询失败降级为空（非阻塞，与 memory service 一致）
 *   - has_content=false → prompt 段落留空（行为兼容旧版）
 *   - 不动 schema / 不动 RLS policy
 *   - 加 [huatuo:memory] log 让魏征能验证真被调用
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMemoryForClient } from '@/lib/memory'
import { formatMemoryForPrompt } from '@/lib/memory/format'
import type { MemoryContext } from '@/lib/memory/types'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type HuatuoPromptMode = 'short' | 'long'

/** zhuge_feedback_events 一条 — 客户对建议的反馈 */
export interface ZhugeFeedbackSummary {
  suggestion_title: string
  feedback_state: 'done' | 'dismissed' | 'irrelevant'
  current_area_label: string | null
  created_at: string
}

/** prescription_outcomes 摘要 — 上次处方某 KPI 的实测 vs 预测 */
export interface PrescriptionOutcomeSummary {
  kpi_metric: string
  target_value: number | null
  actual_value: number | null
  unit: string | null
  dimension: string | null
  days_since_approval: number | null
  /** 兑现率 = actual / target；null 表示数据不全无法算 */
  fulfillment_ratio: number | null
}

/** 华佗 memory bundle — 三层 memory 汇总 */
export interface HuatuoMemoryBundle {
  /** L3 memory service 输出（含 preferences / patterns / failed / decisions） */
  memoryContext: MemoryContext
  /** 最近 N 条客户反馈（来自 zhuge_feedback_events） */
  recentFeedback: ZhugeFeedbackSummary[]
  /** 上次处方的 outcome 汇总（按 KPI 聚合） */
  lastPrescriptionOutcomes: PrescriptionOutcomeSummary[]
  /** 是否有任何 memory 内容可用 */
  has_content: boolean
}

// ── 加载主入口 ────────────────────────────────────────────────────────────────

export interface LoadHuatuoMemoryOptions {
  /** prompt 模式决定加载深度 */
  mode: HuatuoPromptMode
  /** 短模式默认 3 条反馈 / 长模式默认 10 条 */
  feedbackLimit?: number
  /** 短模式默认 5 个 outcome / 长模式默认 15 个 */
  outcomeLimit?: number
}

/**
 * 一次性加载华佗所需的全部 memory。任何子查询失败均降级为空数组（非阻塞）。
 *
 * 短模式：仅 preferences (高置信) + 最近 3 条 feedback + 最近 5 个 outcome
 * 长模式：preferences + patterns + failed + decisions + 10 条 feedback + 15 个 outcome
 */
export async function loadHuatuoMemoryBundle(
  supabase: SupabaseClient,
  clientId: string,
  options: LoadHuatuoMemoryOptions,
): Promise<HuatuoMemoryBundle> {
  const startedAt = Date.now()
  const isShort = options.mode === 'short'
  const feedbackLimit = options.feedbackLimit ?? (isShort ? 3 : 10)
  const outcomeLimit = options.outcomeLimit ?? (isShort ? 5 : 15)

  // 短模式只保留高置信 preferences，跳过 patterns/failed/decisions 以省 token
  const minConfidence = isShort ? 0.75 : 0.6
  const maxRecentDecisions = isShort ? 0 : 5

  const [memoryContext, recentFeedback, lastPrescriptionOutcomes] = await Promise.all([
    loadMemoryForClient(supabase, clientId, {
      minConfidence,
      maxRecentDecisions,
    }),
    loadRecentZhugeFeedback(supabase, clientId, feedbackLimit),
    loadLastPrescriptionOutcomes(supabase, clientId, outcomeLimit),
  ])

  // 短模式裁掉 proven_patterns / failed_experiments，省 token；preferences/decisions 保留
  const trimmedMemory: MemoryContext = isShort
    ? {
        ...memoryContext,
        proven_patterns: [],
        failed_experiments: [],
        recent_decisions: [],
        has_content: memoryContext.preferences.length > 0,
      }
    : memoryContext

  const has_content =
    trimmedMemory.has_content ||
    recentFeedback.length > 0 ||
    lastPrescriptionOutcomes.length > 0

  const duration = Date.now() - startedAt

  // 魏征 §3 要求：metrics 验证 — agent 真调 memory 时有日志
  console.info('[huatuo:memory] loaded', {
    client_id: clientId,
    mode: options.mode,
    preferences: trimmedMemory.preferences.length,
    proven_patterns: trimmedMemory.proven_patterns.length,
    failed_experiments: trimmedMemory.failed_experiments.length,
    recent_decisions: trimmedMemory.recent_decisions.length,
    recent_feedback: recentFeedback.length,
    last_prescription_outcomes: lastPrescriptionOutcomes.length,
    has_content,
    duration_ms: duration,
  })

  return {
    memoryContext: trimmedMemory,
    recentFeedback,
    lastPrescriptionOutcomes,
    has_content,
  }
}

// ── 子查询：zhuge_feedback_events ─────────────────────────────────────────────

/**
 * 加载最近 N 条客户对诸葛亮建议的反馈。
 * 任何错误降级为 []（非阻塞）。
 */
async function loadRecentZhugeFeedback(
  supabase: SupabaseClient,
  clientId: string,
  limit: number,
): Promise<ZhugeFeedbackSummary[]> {
  try {
    const { data, error } = await supabase
      .from('zhuge_feedback_events')
      .select('suggestion_title, feedback_state, current_area_label, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[huatuo:memory] loadRecentZhugeFeedback error:', error.message)
      return []
    }
    return (data ?? []) as ZhugeFeedbackSummary[]
  } catch (err) {
    console.warn(
      '[huatuo:memory] loadRecentZhugeFeedback exception:',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

// ── 子查询：prescription_outcomes ────────────────────────────────────────────

/**
 * 加载客户最近一份「已批准」处方的 KPI outcome。
 *
 * 步骤：
 *   1. 找最近一份 approved prescription
 *   2. 读它的所有 outcome（按 measured_at DESC）
 *   3. 聚合成 PrescriptionOutcomeSummary[]，计算 fulfillment_ratio
 *
 * 任何错误降级为 []（非阻塞）。
 */
async function loadLastPrescriptionOutcomes(
  supabase: SupabaseClient,
  clientId: string,
  limit: number,
): Promise<PrescriptionOutcomeSummary[]> {
  try {
    // Step 1: 找最近 approved 处方
    const { data: prescRow, error: pErr } = await supabase
      .from('prescriptions')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (pErr) {
      console.warn('[huatuo:memory] last approved prescription lookup error:', pErr.message)
      return []
    }
    if (!prescRow?.id) return []  // 没有 approved 处方，正常情况，返回空

    // Step 2: 读它的 outcomes
    const { data, error } = await supabase
      .from('prescription_outcomes')
      .select('kpi_metric, target_value, actual_value, unit, dimension, days_since_approval, measured_at')
      .eq('prescription_id', prescRow.id)
      .eq('client_id', clientId)
      .order('measured_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[huatuo:memory] loadLastPrescriptionOutcomes error:', error.message)
      return []
    }

    return (data ?? []).map((row) => ({
      kpi_metric: row.kpi_metric,
      target_value: row.target_value,
      actual_value: row.actual_value,
      unit: row.unit,
      dimension: row.dimension,
      days_since_approval: row.days_since_approval,
      fulfillment_ratio: computeFulfillmentRatio(row.target_value, row.actual_value),
    }))
  } catch (err) {
    console.warn(
      '[huatuo:memory] loadLastPrescriptionOutcomes exception:',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

/**
 * 计算兑现率 = actual / target。
 * 任一数字缺失或 target 为 0 → null。
 */
export function computeFulfillmentRatio(
  target: number | null,
  actual: number | null,
): number | null {
  if (target == null || actual == null) return null
  if (!Number.isFinite(target) || !Number.isFinite(actual)) return null
  if (target === 0) return null
  const ratio = actual / target
  return Number(ratio.toFixed(2))
}

// ── prompt 渲染 ──────────────────────────────────────────────────────────────

/**
 * 把 HuatuoMemoryBundle 渲染成 prompt 文本块。
 *
 * 短模式输出 ~500 tokens 摘要；长模式输出 ~3000 tokens 详细。
 * has_content=false → 返回空字符串（行为兼容旧版）。
 */
export function formatHuatuoMemoryForPrompt(
  bundle: HuatuoMemoryBundle,
  mode: HuatuoPromptMode,
): string {
  if (!bundle.has_content) return ''

  const parts: string[] = []
  const isShort = mode === 'short'

  // ── L3 memory（preferences / patterns / failed / decisions） ────────────
  if (bundle.memoryContext.has_content) {
    const memoryText = formatMemoryForPrompt(bundle.memoryContext, {
      // 短模式只保留 preferences；其他三段已在 loadHuatuoMemoryBundle 中裁空，
      // 但显式 include 设置增加防御性
      includePreferences: true,
      includeProvenPatterns: !isShort,
      includeFailedExperiments: !isShort,
      includeRecentDecisions: !isShort,
      heading: isShort
        ? 'Client Memory (Quick)'
        : 'Client Memory (L3 Long-term Learning)',
    })
    if (memoryText.trim()) parts.push(memoryText)
  }

  // ── 客户反馈摘要（zhuge_feedback_events） ───────────────────────────────
  if (bundle.recentFeedback.length > 0) {
    parts.push(renderFeedbackSection(bundle.recentFeedback, isShort))
  }

  // ── 上次处方兑现率（prescription_outcomes） ────────────────────────────
  if (bundle.lastPrescriptionOutcomes.length > 0) {
    parts.push(renderOutcomesSection(bundle.lastPrescriptionOutcomes, isShort))
  }

  if (parts.length === 0) return ''

  return parts.join('\n') + '\n'
}

function renderFeedbackSection(
  feedback: ZhugeFeedbackSummary[],
  isShort: boolean,
): string {
  const heading = isShort
    ? '## 客户最近反馈（参考偏好）'
    : '## 客户最近反馈（来自诸葛亮工作台 feedback events）'

  const intro = isShort
    ? '客户最近对建议的处理。生成处方时请尽量贴近 done 的方向，避免重复 dismissed/irrelevant 的方向。'
    : '客户最近对诸葛亮建议的实际处理。请把 done 的方向视为 high-conviction 信号；dismissed/irrelevant 的方向视为低优先级或客户已表达不感兴趣。'

  const lines: string[] = [heading, '', intro, '']
  for (const f of feedback) {
    const area = f.current_area_label ? ` [${f.current_area_label}]` : ''
    const state = labelForFeedbackState(f.feedback_state)
    lines.push(`  - ${state}${area} ${f.suggestion_title}`)
  }
  return lines.join('\n')
}

function labelForFeedbackState(state: string): string {
  switch (state) {
    case 'done':
      return '✓ 已采纳'
    case 'dismissed':
      return '✗ 已忽略'
    case 'irrelevant':
      return '✗ 不相关'
    default:
      return `? ${state}`
  }
}

function renderOutcomesSection(
  outcomes: PrescriptionOutcomeSummary[],
  isShort: boolean,
): string {
  const heading = isShort
    ? '## 上次处方兑现率（学习信号）'
    : '## 上次处方兑现率（prescription_outcomes 实测回流）'

  // 计算平均兑现率（仅对有 ratio 的项）
  const ratiosWithValue = outcomes.filter((o) => o.fulfillment_ratio != null)
  const avgRatio =
    ratiosWithValue.length > 0
      ? ratiosWithValue.reduce((sum, o) => sum + (o.fulfillment_ratio as number), 0) /
        ratiosWithValue.length
      : null

  const intro = isShort
    ? `客户上一份处方的 KPI 实测情况${avgRatio != null ? `（平均兑现率 ${(avgRatio * 100).toFixed(0)}%）` : ''}。新处方请避开兑现率 < 60% 的 KPI 类型，倾向兑现率 > 100% 的方向。`
    : `客户上一份「已批准」处方的 KPI 实测回流${avgRatio != null ? `（平均兑现率 ${(avgRatio * 100).toFixed(0)}%）` : ''}。这是华佗自己上次开出处方后**实测结果**——请基于此调整新处方：兑现率 < 60% 的 KPI 类型说明上次预估过于乐观，新处方 target_value 应保守；兑现率 > 100% 说明该方向是客户强项，可加码。`

  const lines: string[] = [heading, '', intro, '']
  for (const o of outcomes) {
    const ratioLabel =
      o.fulfillment_ratio != null
        ? `${(o.fulfillment_ratio * 100).toFixed(0)}%`
        : 'n/a'
    const dim = o.dimension ? ` [${o.dimension}]` : ''
    const unit = o.unit ?? ''
    const target = o.target_value != null ? `target ${o.target_value}${unit}` : 'target n/a'
    const actual = o.actual_value != null ? `actual ${o.actual_value}${unit}` : 'actual n/a'
    const days = o.days_since_approval != null ? ` (+${o.days_since_approval}d)` : ''
    lines.push(`  - ${dim} ${o.kpi_metric}: ${target} → ${actual} = ${ratioLabel}${days}`)
  }
  return lines.join('\n')
}

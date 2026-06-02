/**
 * Phase 31 M4 — Goal verdict 归因
 *
 * 不同于 flywheel action 的短期效果归因（src/lib/flywheel/attribution/job.ts），
 * Goal 层归因看的是 90 天累积达成率：
 *
 *   progress = (current - baseline) / (target - baseline)
 *
 *   progress >= 0.80   → confirmed       （达成或接近目标）
 *   0.50 <= p < 0.80   → partial         （部分胜利）
 *   p < 0.50           → reversed        （未达成）
 *   current 缺失 / 没动作 → inconclusive  （数据不足）
 *
 * Current value 来源：
 *   - 主指标 measurement='auto'：未来从 GA4 / SerpAPI / Apify 等数据源自动读
 *     （M4 MVP：仅占位，让 FDE 手动 PATCH current_value）
 *   - 主指标 measurement='self_report' / 'hybrid'：客户自报（Phase 32 补签字）
 *
 * 设计原则：
 *   - Verdict 由主指标决定（supporting_metrics 仅在 summary 里展示，不参与判定）
 *   - 不依赖现有 6 维度评分（地基不稳，产品讨论决定）
 *   - 留 verdict_summary 文字字段让 FDE 在归档时补充上下文
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GoalRow, GoalVerdict, TargetDirection } from '@/types/strategy'

// ─── Verdict computation ─────────────────────────────────────────────────────

export interface ComputeVerdictInput {
  baseline_value: number
  target_value: number
  current_value: number | null
  /** Phase 32: 'decrease' for inventory clearance / churn reduction. Defaults to 'increase'. */
  target_direction?: TargetDirection
}

export interface ComputeVerdictResult {
  verdict: GoalVerdict
  progress_pct: number | null   // 0-100+, null when current_value missing
  confidence: number            // 0-1
  summary_line: string          // one-liner for verdict_summary
}

export function computeGoalVerdict(input: ComputeVerdictInput): ComputeVerdictResult {
  const { baseline_value, target_value, current_value, target_direction = 'increase' } = input

  if (current_value == null) {
    return {
      verdict: 'inconclusive',
      progress_pct: null,
      confidence: 0,
      summary_line: 'No current value reported — verdict deferred.',
    }
  }

  // Avoid div-by-zero when baseline equals target (createGoal already blocks this,
  // but defensive guard for legacy data).
  if (target_value === baseline_value) {
    return {
      verdict: 'inconclusive',
      progress_pct: null,
      confidence: 0,
      summary_line: 'Baseline equals target — cannot compute progress.',
    }
  }

  // Phase 32: direction-aware progress.
  // The standard formula (current - baseline) / (target - baseline) is mathematically
  // direction-agnostic — when target < baseline (decrease), both numerator and denominator
  // flip sign, so progress is still 0→1 as we approach target. We make this explicit
  // for code clarity and to support future direction-specific logic.
  const progress = target_direction === 'decrease'
    ? (baseline_value - current_value) / (baseline_value - target_value)
    : (current_value - baseline_value) / (target_value - baseline_value)
  const progress_pct = Math.round(progress * 1000) / 10  // one decimal

  // Confidence scales with how far we are from the threshold (more conviction
  // for extreme outcomes, less for borderline ones)
  let verdict: GoalVerdict
  let confidence: number

  if (progress >= 0.80) {
    verdict = 'confirmed'
    confidence = Math.min(0.95, 0.7 + (progress - 0.80) * 0.5)
  } else if (progress >= 0.50) {
    verdict = 'partial'
    confidence = 0.5 + (progress - 0.50) * 0.5
  } else if (progress > 0) {
    verdict = 'reversed'
    confidence = Math.min(0.95, 0.5 + (0.50 - progress) * 0.5)
  } else {
    // No movement or moved in wrong direction
    verdict = 'reversed'
    confidence = 0.85
  }

  confidence = Math.round(confidence * 100) / 100

  const directionLabel = target_direction === 'decrease' ? ' (decrease)' : ''
  const summary_line = `Progress ${progress_pct}%${directionLabel} (${current_value} vs target ${target_value}, baseline ${baseline_value})`

  return { verdict, progress_pct, confidence, summary_line }
}

// ─── Apply verdict to a goal row ─────────────────────────────────────────────

/**
 * Compute verdict for one goal and write back to DB.
 * Used by:
 *   - Daily cron (auto-judge expired goals)
 *   - Manual "simulate expiry" QA tool
 *
 * Caller provides current_value (M4 MVP — no auto-fetching from data sources yet).
 */
export interface JudgeGoalInput {
  goal: GoalRow
  current_value: number | null
  extra_summary?: string         // optional FDE-supplied context
}

export async function judgeGoalAndArchive(
  supabase: SupabaseClient,
  input: JudgeGoalInput,
): Promise<{ ok: boolean; verdict?: GoalVerdict; error?: string }> {
  const { goal, current_value, extra_summary } = input

  if (goal.status !== 'active' && goal.status !== 'expired') {
    return { ok: false, error: `Cannot judge goal in status '${goal.status}'` }
  }

  const result = computeGoalVerdict({
    baseline_value: goal.baseline_value,
    target_value: goal.target_value,
    current_value,
    target_direction: goal.target_direction,  // P32: support decrease
  })

  const fullSummary = extra_summary
    ? `${result.summary_line}\n\n${extra_summary}`
    : result.summary_line

  const { error } = await supabase
    .from('goals')
    .update({
      verdict: result.verdict,
      verdict_at: new Date().toISOString(),
      verdict_summary: fullSummary,
      status: 'archived',
    })
    .eq('id', goal.id)

  if (error) return { ok: false, error: error.message }
  return { ok: true, verdict: result.verdict }
}

// ─── Batch: find and judge all expired-but-not-archived goals ────────────────

/**
 * Used by the daily cron. For each goal whose period_end has passed and
 * status='active', mark status='expired' (so FDE sees it needs verdict input).
 *
 * MVP: doesn't auto-archive — FDE must supply current_value in the UI.
 * (Auto-fetching primary metric current value is Phase 32+ work.)
 */
export async function flagExpiredGoals(
  supabase: SupabaseClient,
): Promise<{ flagged_count: number; error?: string }> {
  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('goals')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('period_end', today)
    .select('id')

  if (error) return { flagged_count: 0, error: error.message }
  return { flagged_count: data?.length ?? 0 }
}

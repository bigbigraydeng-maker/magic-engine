/**
 * Phase 23 — MemoryService
 *
 * 统一读写 L3 记忆层（4 张表）。供各 Agent 在 prompt 构建前调用。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  MemoryContext,
  MemoryLoadOptions,
  LearnedPreference,
  ProvenPattern,
  FailedExperiment,
  DecisionHistory,
  CreateLearnedPreferenceInput,
  CreateProvenPatternInput,
  CreateFailedExperimentInput,
  CreateDecisionHistoryInput,
} from './types'

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * 为指定客户加载 MemoryContext 汇总包，供 Agent prompt 注入。
 * 任何子查询失败都降级为空数组（非阻塞）。
 */
export async function loadMemoryForClient(
  supabase: SupabaseClient,
  clientId: string,
  options: MemoryLoadOptions = {},
): Promise<MemoryContext> {
  const {
    flywheel,
    maxRecentDecisions = 5,
    minConfidence = 0.6,
  } = options

  const [preferences, patterns, experiments, decisions] = await Promise.all([
    loadPreferences(supabase, clientId, flywheel, minConfidence),
    loadPatterns(supabase, clientId, flywheel),
    loadFailedExperiments(supabase, clientId),
    loadRecentDecisions(supabase, clientId, maxRecentDecisions),
  ])

  const has_content =
    preferences.length > 0 ||
    patterns.length > 0 ||
    experiments.length > 0 ||
    decisions.length > 0

  return {
    preferences: preferences.map((p) => ({
      preference_type: p.preference_type,
      content: p.content,
      confidence_score: p.confidence_score,
      flywheel: p.flywheel ?? null,
    })),
    proven_patterns: patterns.map((p) => ({
      pattern_type: p.pattern_type,
      pattern_content: p.pattern_content,
      performance_metric: p.performance_metric ?? null,
      flywheel: p.flywheel ?? null,
    })),
    failed_experiments: experiments.map((e) => ({
      experiment_description: e.experiment_description,
      failure_reason: e.failure_reason,
      dimension: e.dimension ?? null,
    })),
    recent_decisions: decisions.map((d) => ({
      decision_context: d.decision_context,
      chosen_action: d.chosen_action,
      alternatives_rejected: d.alternatives_rejected,
      reasoning: d.reasoning,
      outcome_verdict: d.outcome_verdict ?? null,
      created_at: d.created_at,
    })),
    has_content,
  }
}

async function loadPreferences(
  supabase: SupabaseClient,
  clientId: string,
  flywheel?: string,
  minConfidence?: number,
): Promise<LearnedPreference[]> {
  try {
    let q = supabase
      .from('client_learned_preferences')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .gte('confidence_score', minConfidence ?? 0.6)
      .order('confidence_score', { ascending: false })
      .limit(20)

    if (flywheel) {
      q = q.or(`flywheel.eq.${flywheel},flywheel.is.null`)
    }

    const { data, error } = await q
    if (error) {
      console.warn('[memory] loadPreferences error:', error.message)
      return []
    }
    return (data ?? []) as LearnedPreference[]
  } catch {
    return []
  }
}

async function loadPatterns(
  supabase: SupabaseClient,
  clientId: string,
  flywheel?: string,
): Promise<ProvenPattern[]> {
  try {
    let q = supabase
      .from('client_proven_patterns')
      .select('*')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(15)

    if (flywheel) {
      q = q.or(`flywheel.eq.${flywheel},flywheel.is.null`)
    }

    const { data, error } = await q
    if (error) {
      console.warn('[memory] loadPatterns error:', error.message)
      return []
    }
    return (data ?? []) as ProvenPattern[]
  } catch {
    return []
  }
}

async function loadFailedExperiments(
  supabase: SupabaseClient,
  clientId: string,
): Promise<FailedExperiment[]> {
  try {
    const { data, error } = await supabase
      .from('client_failed_experiments')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.warn('[memory] loadFailedExperiments error:', error.message)
      return []
    }
    return (data ?? []) as FailedExperiment[]
  } catch {
    return []
  }
}

async function loadRecentDecisions(
  supabase: SupabaseClient,
  clientId: string,
  limit: number,
): Promise<DecisionHistory[]> {
  try {
    const { data, error } = await supabase
      .from('client_decision_history')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.warn('[memory] loadRecentDecisions error:', error.message)
      return []
    }
    return (data ?? []) as DecisionHistory[]
  } catch {
    return []
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function savePreference(
  supabase: SupabaseClient,
  input: CreateLearnedPreferenceInput,
): Promise<LearnedPreference | null> {
  const { data, error } = await supabase
    .from('client_learned_preferences')
    .insert({
      client_id: input.client_id,
      preference_type: input.preference_type,
      content: input.content,
      source: input.source,
      extracted_from_table: input.extracted_from_table ?? null,
      extracted_from_id: input.extracted_from_id ?? null,
      confidence_score: input.confidence_score ?? 1.0,
      flywheel: input.flywheel ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[memory] savePreference error:', error.message)
    return null
  }
  return data as LearnedPreference
}

export async function saveProvenPattern(
  supabase: SupabaseClient,
  input: CreateProvenPatternInput,
): Promise<ProvenPattern | null> {
  const { data, error } = await supabase
    .from('client_proven_patterns')
    .insert({
      client_id: input.client_id,
      pattern_type: input.pattern_type,
      pattern_content: input.pattern_content,
      performance_metric: input.performance_metric ?? null,
      measurement_period_start: input.measurement_period_start ?? null,
      measurement_period_end: input.measurement_period_end ?? null,
      flywheel: input.flywheel ?? null,
      source_table: input.source_table ?? null,
      source_id: input.source_id ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[memory] saveProvenPattern error:', error.message)
    return null
  }
  return data as ProvenPattern
}

export async function saveFailedExperiment(
  supabase: SupabaseClient,
  input: CreateFailedExperimentInput,
): Promise<FailedExperiment | null> {
  const { data, error } = await supabase
    .from('client_failed_experiments')
    .insert({
      client_id: input.client_id,
      experiment_description: input.experiment_description,
      failure_reason: input.failure_reason,
      dimension: input.dimension ?? null,
      tried_at: input.tried_at ?? null,
      source_table: input.source_table ?? null,
      source_id: input.source_id ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('[memory] saveFailedExperiment error:', error.message)
    return null
  }
  return data as FailedExperiment
}

export async function saveDecisionHistory(
  supabase: SupabaseClient,
  input: CreateDecisionHistoryInput,
): Promise<DecisionHistory | null> {
  const { data, error } = await supabase
    .from('client_decision_history')
    .insert({
      client_id: input.client_id,
      zhuge_session_id: input.zhuge_session_id ?? null,
      decision_context: input.decision_context,
      chosen_action: input.chosen_action,
      alternatives_rejected: input.alternatives_rejected,
      reasoning: input.reasoning,
    })
    .select()
    .single()

  if (error) {
    console.error('[memory] saveDecisionHistory error:', error.message)
    return null
  }
  return data as DecisionHistory
}

/**
 * 回填决策结果（由 Phase 23.C 自动抽取器调用）
 */
export async function updateDecisionOutcome(
  supabase: SupabaseClient,
  decisionId: string,
  verdict: 'success' | 'failure' | 'inconclusive',
  notes?: string,
): Promise<void> {
  const { error } = await supabase
    .from('client_decision_history')
    .update({ outcome_verdict: verdict, outcome_notes: notes ?? null })
    .eq('id', decisionId)

  if (error) {
    console.error('[memory] updateDecisionOutcome error:', error.message)
  }
}

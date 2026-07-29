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
  GlobalLesson,
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

  const [preferences, patterns, experiments, decisions, globalLessons] = await Promise.all([
    loadPreferences(supabase, clientId, flywheel, minConfidence),
    loadPatterns(supabase, clientId, flywheel),
    loadFailedExperiments(supabase, clientId),
    loadRecentDecisions(supabase, clientId, maxRecentDecisions),
    loadGlobalLessons(supabase, clientId, flywheel, minConfidence),
  ])

  // 🔴 刻意不含 globalLessons：全局经验对每个客户都存在，计入会让 has_content 恒为
  // true，从而改变所有既有调用方的行为（原本无记忆的客户不输出 memory 块）。
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
    global_lessons: globalLessons.map((l) => ({
      lesson: l.lesson,
      rationale: l.rationale ?? null,
      scope: l.scope,
      industry: l.industry ?? null,
      flywheel: l.flywheel ?? null,
      confidence: l.confidence,
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

/**
 * 加载跨客户经验（global_learned_lessons）。
 *
 * 匹配规则（三选一即命中）：
 *   - scope='global'                    → 对所有客户生效
 *   - scope='channel'                   → 渠道通用（如「Meta AI 会删合规词」）
 *   - scope='industry' 且 industry 相符 → 仅同行业客户
 *
 * 额外过滤：
 *   - is_active=true
 *   - confidence >= minConfidence（与客户级 preferences 同一门槛）
 *   - contradicted_count <= confirmed_count（被反例推翻更多次的经验不再注入）
 *
 * 任何失败都降级为空数组，绝不阻塞 agent —— 与本文件其他 loader 行为一致。
 */
async function loadGlobalLessons(
  supabase: SupabaseClient,
  clientId: string,
  flywheel?: string,
  minConfidence?: number,
): Promise<GlobalLesson[]> {
  try {
    // 先取客户行业；取不到就只拿 global/channel 两层，不影响主流程
    let industry: string | null = null
    const { data: clientRow } = await supabase
      .from('clients')
      .select('industry')
      .eq('id', clientId)
      .maybeSingle()
    if (clientRow && typeof (clientRow as { industry?: unknown }).industry === 'string') {
      industry = (clientRow as { industry: string }).industry
    }

    // 公共过滤（两条 scope 支线共用）
    const baseQuery = () => {
      let q = supabase
        .from('global_learned_lessons')
        .select('*')
        .eq('is_active', true)
        .gte('confidence', minConfidence ?? 0.6)
        .order('confidence', { ascending: false })
        .limit(25)

      if (flywheel) {
        // 'cross' 表示跨飞轮通用，任何飞轮都应读到
        q = q.or(`flywheel.eq.${flywheel},flywheel.eq.cross,flywheel.is.null`)
      }
      return q
    }

    // 🔴 industry 是 PM 在后台自由填写的文本，绝不能拼进 .or() 过滤串：
    //   - 值里带 `,` `(` `)` 会破坏 PostgREST 语法 → 整条查询失败 → 该客户读不到
    //     任何全局经验（连恒命中的 global/channel 也丢），且只有一行 warn，静默出错
    //   - 精心构造的值能闭合 and(...) 分组、注入额外 scope 条件 → 读到别行业的经验，
    //     击穿「地产的课只喂地产客户」这道隔离闸（已实测复现）
    // 因此拆成两条查询：scope 用固定字面量，industry 走参数化 .in()。
    const industryCandidates = buildIndustryMatchCandidates(industry)

    const [baseRes, industryRes] = await Promise.all([
      baseQuery().in('scope', ['global', 'channel']),
      industryCandidates.length > 0
        ? baseQuery().eq('scope', 'industry').in('industry', industryCandidates)
        : Promise.resolve({ data: [] as GlobalLesson[], error: null }),
    ])

    if (baseRes.error) {
      console.warn('[memory] loadGlobalLessons base error:', baseRes.error.message)
    }
    if (industryRes.error) {
      console.warn('[memory] loadGlobalLessons industry error:', industryRes.error.message)
    }

    // 两条支线各自降级：一条失败不牵连另一条
    const merged = [
      ...((baseRes.data ?? []) as GlobalLesson[]),
      ...((industryRes.data ?? []) as GlobalLesson[]),
    ]

    return (
      merged
        // 被推翻次数多于确认次数的经验不再注入（把偶然当规律的防线）
        .filter((l) => (l.contradicted_count ?? 0) <= (l.confirmed_count ?? 1))
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 25)
    )
  } catch {
    return []
  }
}

/**
 * 把 clients.industry（PM 自由填写）归一成能跟 global_learned_lessons.industry
 * （代码侧规范值，如 `real_estate`）对上的候选列表。
 *
 * 同时保留原值与归一值，所以 `Real Estate` / `real estate` / `real_estate`
 * 三种写法都能命中同一批行业经验 —— 后台填写不规范不该让客户读不到课。
 * 返回空数组 = 不查 industry 层（只吃 global/channel）。
 */
function buildIndustryMatchCandidates(raw: string | null): string[] {
  const trimmed = raw?.trim()
  if (!trimmed) return []

  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === trimmed ? [trimmed] : [trimmed, normalized]
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

/**
 * Phase 23.C — L3 记忆自动抽取器
 *
 * 从 flywheel_outcomes + flywheel_actions 中规则化地推导 L3 记忆条目：
 *
 *   1. confirmed outcomes (confidence ≥ 0.6) → client_proven_patterns
 *   2. reversed  outcomes (confidence ≥ 0.6) → client_failed_experiments
 *   3. 同 action_type ≥ MIN_OCCURRENCES 次 confirmed → client_learned_preferences
 *   4. client_decision_history.outcome_verdict 回填（时间窗内匹配 outcomes）
 *
 * 设计原则：
 *   - 纯规则版本，无 LLM 调用 — 廉价、可解释、易回滚
 *   - 幂等：通过 (source_table='flywheel_outcomes', source_id=outcome.id) 去重
 *   - 失败不阻塞：单条出错记入 errors，继续处理其余
 *   - 不删除已有记忆 — 抽取器只追加 + 标记，FDE 可在 P23.E 中清理
 *
 * Reference: ROADMAP.md Phase 23.C
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  saveProvenPattern,
  saveFailedExperiment,
  savePreference,
  updateDecisionOutcome,
} from './service'
import type { FlywheelName, PatternType, PreferenceType } from './types'

// ── 配置参数 ──────────────────────────────────────────────────────────────────

/** 写入 patterns/experiments 的最低 outcome confidence */
const MIN_OUTCOME_CONFIDENCE = 0.6

/** 同 action_type 连续 confirmed ≥ N 次才生成 learned_preference */
const MIN_OCCURRENCES_FOR_PREFERENCE = 3

/** decision → outcome 匹配的时间窗（天） */
const DECISION_MATCH_WINDOW_DAYS = 14

// ── 公共类型 ──────────────────────────────────────────────────────────────────

export interface ExtractorResult {
  outcomes_processed: number
  patterns_added: number
  experiments_added: number
  preferences_added: number
  decisions_updated: number
  errors: string[]
}

export interface ExtractorBatchResult {
  clients_processed: number
  aggregate: ExtractorResult
  per_client_errors: Array<{ client_id: string; error: string }>
}

// ── 内部类型 ──────────────────────────────────────────────────────────────────

interface OutcomeJoinRow {
  outcome_id: string
  client_id: string
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number | null
  verdict: 'confirmed' | 'inconclusive' | 'reversed'
  computed_at: string
  window_days: number
  action_id: string
  action_type: string
  flywheel: FlywheelName
  vendor: string | null
  executed_at: string
}

// ── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 为单个客户跑抽取器。
 * 任何 step 失败都会记入 errors，不会抛出。
 */
export async function runExtractorForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ExtractorResult> {
  const result: ExtractorResult = {
    outcomes_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    decisions_updated: 0,
    errors: [],
  }

  // 1. 拉取该客户所有 high-confidence outcomes + JOIN action
  let outcomes: OutcomeJoinRow[] = []
  try {
    outcomes = await loadOutcomesWithActions(supabase, clientId)
    result.outcomes_processed = outcomes.length
  } catch (err) {
    result.errors.push(`load outcomes: ${msgOf(err)}`)
    return result
  }

  if (outcomes.length === 0) {
    return result
  }

  // 2. 拉取已抽取的 source_id 集合（去重用）
  let existingPatternSourceIds = new Set<string>()
  let existingExperimentSourceIds = new Set<string>()
  try {
    existingPatternSourceIds = await loadExistingSourceIds(
      supabase, clientId, 'client_proven_patterns',
    )
    existingExperimentSourceIds = await loadExistingSourceIds(
      supabase, clientId, 'client_failed_experiments',
    )
  } catch (err) {
    result.errors.push(`load existing: ${msgOf(err)}`)
    // 继续 — 即使读取失败，重复写入也只是浪费空间，不会破坏数据
  }

  // 3. 逐条处理 outcomes
  for (const out of outcomes) {
    try {
      if (out.verdict === 'confirmed' && (out.confidence ?? 0) >= MIN_OUTCOME_CONFIDENCE) {
        if (!existingPatternSourceIds.has(out.outcome_id)) {
          const saved = await saveProvenPattern(supabase, {
            client_id: out.client_id,
            pattern_type: actionToPatternType(out.action_type),
            pattern_content: describePattern(out),
            performance_metric: describeMetric(out),
            flywheel: out.flywheel,
            source_table: 'flywheel_outcomes',
            source_id: out.outcome_id,
          })
          if (saved) result.patterns_added++
        }
      } else if (out.verdict === 'reversed' && (out.confidence ?? 0) >= MIN_OUTCOME_CONFIDENCE) {
        if (!existingExperimentSourceIds.has(out.outcome_id)) {
          const saved = await saveFailedExperiment(supabase, {
            client_id: out.client_id,
            experiment_description: describeExperiment(out),
            failure_reason: describeFailure(out),
            dimension: flywheelToDimension(out.flywheel),
            tried_at: out.executed_at,
            source_table: 'flywheel_outcomes',
            source_id: out.outcome_id,
          })
          if (saved) result.experiments_added++
        }
      }
    } catch (err) {
      result.errors.push(`outcome ${out.outcome_id}: ${msgOf(err)}`)
    }
  }

  // 4. 聚合 action_type 频次 → 生成 preferences
  try {
    const added = await extractPreferencesFromActionTypes(
      supabase, clientId, outcomes,
    )
    result.preferences_added += added
  } catch (err) {
    result.errors.push(`extract preferences: ${msgOf(err)}`)
  }

  // 5. 回填 decision_history.outcome_verdict
  try {
    const updated = await backfillDecisionOutcomes(supabase, clientId)
    result.decisions_updated += updated
  } catch (err) {
    result.errors.push(`backfill decisions: ${msgOf(err)}`)
  }

  return result
}

/**
 * 跑全部客户。返回每客户级聚合 + 错误名单。
 */
export async function runExtractorForAllClients(
  supabase: SupabaseClient,
): Promise<ExtractorBatchResult> {
  const aggregate: ExtractorResult = {
    outcomes_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    decisions_updated: 0,
    errors: [],
  }
  const perClientErrors: Array<{ client_id: string; error: string }> = []

  // 仅处理在 outcomes 表里出现过的客户（无 outcome 客户跳过）
  const { data: rows, error } = await supabase
    .from('flywheel_outcomes')
    .select('client_id')
    .order('client_id')

  if (error) {
    return {
      clients_processed: 0,
      aggregate,
      per_client_errors: [{ client_id: '*', error: `list clients: ${error.message}` }],
    }
  }

  const clientIds = Array.from(new Set((rows ?? []).map(r => r.client_id))).filter(Boolean)
  let processed = 0

  for (const clientId of clientIds) {
    try {
      const r = await runExtractorForClient(supabase, clientId)
      processed++
      aggregate.outcomes_processed   += r.outcomes_processed
      aggregate.patterns_added       += r.patterns_added
      aggregate.experiments_added    += r.experiments_added
      aggregate.preferences_added    += r.preferences_added
      aggregate.decisions_updated    += r.decisions_updated
      if (r.errors.length > 0) {
        perClientErrors.push({ client_id: clientId, error: r.errors.join(' | ') })
      }
    } catch (err) {
      perClientErrors.push({ client_id: clientId, error: msgOf(err) })
    }
  }

  return { clients_processed: processed, aggregate, per_client_errors: perClientErrors }
}

// ── 数据加载 helpers ──────────────────────────────────────────────────────────

async function loadOutcomesWithActions(
  supabase: SupabaseClient,
  clientId: string,
): Promise<OutcomeJoinRow[]> {
  // 单跑 JOIN 在 PostgREST 风格里不直观；用两步查询并在内存里合并
  const { data: outcomeRows, error: outcomeErr } = await supabase
    .from('flywheel_outcomes')
    .select('id, client_id, action_id, metric_key, delta, delta_pct, confidence, verdict, computed_at, window_days')
    .eq('client_id', clientId)
    .in('verdict', ['confirmed', 'reversed'])
    .order('computed_at', { ascending: false })

  if (outcomeErr) throw new Error(outcomeErr.message)
  if (!outcomeRows || outcomeRows.length === 0) return []

  const actionIds = Array.from(new Set(outcomeRows.map(r => r.action_id).filter(Boolean)))
  if (actionIds.length === 0) return []

  const { data: actionRows, error: actionErr } = await supabase
    .from('flywheel_actions')
    .select('id, action_type, flywheel, vendor, executed_at')
    .in('id', actionIds)

  if (actionErr) throw new Error(actionErr.message)

  const actionMap = new Map<string, { action_type: string; flywheel: FlywheelName; vendor: string | null; executed_at: string }>()
  for (const a of actionRows ?? []) {
    actionMap.set(a.id, {
      action_type: a.action_type,
      flywheel: a.flywheel,
      vendor: a.vendor ?? null,
      executed_at: a.executed_at,
    })
  }

  const joined: OutcomeJoinRow[] = []
  for (const o of outcomeRows) {
    const a = actionMap.get(o.action_id)
    if (!a) continue
    joined.push({
      outcome_id: o.id,
      client_id: o.client_id,
      metric_key: o.metric_key,
      delta: o.delta,
      delta_pct: o.delta_pct,
      confidence: o.confidence,
      verdict: o.verdict,
      computed_at: o.computed_at,
      window_days: o.window_days,
      action_id: o.action_id,
      action_type: a.action_type,
      flywheel: a.flywheel,
      vendor: a.vendor,
      executed_at: a.executed_at,
    })
  }
  return joined
}

async function loadExistingSourceIds(
  supabase: SupabaseClient,
  clientId: string,
  table: 'client_proven_patterns' | 'client_failed_experiments',
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(table)
    .select('source_id')
    .eq('client_id', clientId)
    .eq('source_table', 'flywheel_outcomes')
    .not('source_id', 'is', null)

  if (error) {
    console.warn(`[extractor] load existing ${table}: ${error.message}`)
    return new Set()
  }
  return new Set((data ?? []).map((r: { source_id: string | null }) => r.source_id).filter((v): v is string => !!v))
}

// ── Preference 聚合 ───────────────────────────────────────────────────────────

/**
 * 同一 action_type 在该客户上 confirmed 次数达到阈值，生成 learned_preference。
 * 已存在同 (preference_type, content, source='auto_extracted', flywheel) 不重复写。
 */
async function extractPreferencesFromActionTypes(
  supabase: SupabaseClient,
  clientId: string,
  outcomes: OutcomeJoinRow[],
): Promise<number> {
  // 按 (flywheel, action_type) 聚合 confirmed 数量
  const grouped = new Map<string, { count: number; flywheel: FlywheelName; actionType: string; samples: OutcomeJoinRow[] }>()
  for (const o of outcomes) {
    if (o.verdict !== 'confirmed') continue
    if ((o.confidence ?? 0) < MIN_OUTCOME_CONFIDENCE) continue
    const key = `${o.flywheel}::${o.action_type}`
    const entry = grouped.get(key) ?? { count: 0, flywheel: o.flywheel, actionType: o.action_type, samples: [] }
    entry.count++
    if (entry.samples.length < 3) entry.samples.push(o)
    grouped.set(key, entry)
  }

  // 已有 auto_extracted preferences 的内容集（按 flywheel + content 去重）
  const { data: existing } = await supabase
    .from('client_learned_preferences')
    .select('content, flywheel, preference_type')
    .eq('client_id', clientId)
    .eq('source', 'auto_extracted')

  const existingKeys = new Set(
    (existing ?? []).map((r: { content: string; flywheel: string | null; preference_type: string }) =>
      `${r.flywheel ?? 'global'}::${r.preference_type}::${r.content}`,
    ),
  )

  let added = 0
  for (const entry of Array.from(grouped.values())) {
    if (entry.count < MIN_OCCURRENCES_FOR_PREFERENCE) continue

    const preference: { preference_type: PreferenceType; content: string; flywheel: FlywheelName } = {
      preference_type: 'format',
      content: `${entry.count} 次 confirmed: action_type='${entry.actionType}' 在 ${entry.flywheel} 飞轮持续跑赢`,
      flywheel: entry.flywheel,
    }
    const key = `${preference.flywheel}::${preference.preference_type}::${preference.content}`
    if (existingKeys.has(key)) continue

    // confidence_score 与样本数挂钩（cap 0.95）
    const confidence = Math.min(0.95, 0.5 + (entry.count - MIN_OCCURRENCES_FOR_PREFERENCE) * 0.1)

    const sample = entry.samples[0]
    const saved = await savePreference(supabase, {
      client_id: clientId,
      preference_type: preference.preference_type,
      content: preference.content,
      source: 'auto_extracted',
      confidence_score: confidence,
      flywheel: preference.flywheel,
      extracted_from_table: 'flywheel_outcomes',
      extracted_from_id: sample?.outcome_id,
    })
    if (saved) {
      added++
      existingKeys.add(key)
    }
  }
  return added
}

// ── Decision verdict backfill ─────────────────────────────────────────────────

/**
 * 把 client_decision_history.outcome_verdict 是 null 的记录补全：
 * 在 created_at + window 天内查该客户 outcomes，按 majority verdict 决定。
 */
async function backfillDecisionOutcomes(
  supabase: SupabaseClient,
  clientId: string,
): Promise<number> {
  const { data: decisions, error } = await supabase
    .from('client_decision_history')
    .select('id, created_at')
    .eq('client_id', clientId)
    .is('outcome_verdict', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(error.message)
  }
  if (!decisions || decisions.length === 0) return 0

  let updated = 0
  for (const d of decisions) {
    const start = new Date(d.created_at)
    const end = new Date(start)
    end.setDate(end.getDate() + DECISION_MATCH_WINDOW_DAYS)

    const { data: outcomes, error: oErr } = await supabase
      .from('flywheel_outcomes')
      .select('verdict')
      .eq('client_id', clientId)
      .gte('computed_at', start.toISOString())
      .lte('computed_at', end.toISOString())

    if (oErr) continue
    if (!outcomes || outcomes.length === 0) continue

    const verdict = aggregateVerdicts(outcomes.map((o: { verdict: string }) => o.verdict))
    if (!verdict) continue

    await updateDecisionOutcome(supabase, d.id, verdict, `auto-derived from ${outcomes.length} outcomes within ${DECISION_MATCH_WINDOW_DAYS}d window`)
    updated++
  }
  return updated
}

function aggregateVerdicts(verdicts: string[]): 'success' | 'failure' | 'inconclusive' | null {
  let confirmed = 0
  let reversed = 0
  let inconclusive = 0
  for (const v of verdicts) {
    if (v === 'confirmed') confirmed++
    else if (v === 'reversed') reversed++
    else if (v === 'inconclusive') inconclusive++
  }
  const total = confirmed + reversed + inconclusive
  if (total === 0) return null
  if (confirmed > reversed && confirmed >= total / 2) return 'success'
  if (reversed > confirmed && reversed >= total / 2) return 'failure'
  return 'inconclusive'
}

// ── Action-type → pattern_type / description mapping ──────────────────────────

function actionToPatternType(actionType: string): PatternType {
  const a = actionType.toLowerCase()
  if (a.includes('hook') || a.includes('headline') || a.includes('title')) return 'headline'
  if (a.includes('cta')) return 'cta'
  if (a.includes('structure') || a.includes('layout')) return 'structure'
  if (a.includes('publish') || a.includes('post') || a.includes('compose')) return 'format'
  return 'angle'
}

function describePattern(out: OutcomeJoinRow): string {
  const dPct = out.delta_pct != null ? `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}%` : 'positive delta'
  return `${out.flywheel} 飞轮 '${out.action_type}' 在 ${out.window_days} 天窗口内 ${dPct} 提升 ${out.metric_key}（confidence ${round2(out.confidence ?? 0)}）`
}

function describeMetric(out: OutcomeJoinRow): string {
  if (out.delta_pct != null) {
    return `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}% on ${out.metric_key} (${out.window_days}d window)`
  }
  if (out.delta != null) {
    return `Δ ${round2(out.delta)} on ${out.metric_key} (${out.window_days}d window)`
  }
  return `confirmed on ${out.metric_key}`
}

function describeExperiment(out: OutcomeJoinRow): string {
  return `${out.flywheel} 飞轮尝试 action_type='${out.action_type}'（目标指标 ${out.metric_key}）`
}

function describeFailure(out: OutcomeJoinRow): string {
  const dPct = out.delta_pct != null ? `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}%` : '反向变动'
  return `${out.window_days} 天窗口内 ${out.metric_key} ${dPct}，verdict=reversed（confidence ${round2(out.confidence ?? 0)}）`
}

function flywheelToDimension(fw: FlywheelName): 'seo' | 'ai_visibility' | 'ads' | 'social' {
  switch (fw) {
    case 'geo':    return 'ai_visibility'
    case 'seo':    return 'seo'
    case 'ads':    return 'ads'
    case 'social': return 'social'
  }
}

// ── Misc utils ────────────────────────────────────────────────────────────────

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

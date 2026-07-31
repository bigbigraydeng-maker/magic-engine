/**
 * Phase 23 — Cross-Agent Memory Layer 类型定义
 *
 * L3 长期学习层：四张表的 TypeScript 类型 + 供各 Agent 消费的 MemoryContext 汇总包。
 */

import type { DiagnosticDimension } from '@/types/diagnostic'

// ── 飞轮名 ────────────────────────────────────────────────────────────────────

export type FlywheelName = 'seo' | 'geo' | 'ads' | 'social'

// ── 1. client_learned_preferences ────────────────────────────────────────────

export type PreferenceType = 'style' | 'topic' | 'format' | 'tone' | 'audience' | 'other'
export type PreferenceSource = 'fde_annotation' | 'client_feedback' | 'auto_extracted'

export interface LearnedPreference {
  id: string
  client_id: string
  preference_type: PreferenceType
  content: string
  source: PreferenceSource
  extracted_from_table?: string | null
  extracted_from_id?: string | null
  confidence_score: number
  flywheel?: FlywheelName | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CreateLearnedPreferenceInput {
  client_id: string
  preference_type: PreferenceType
  content: string
  source: PreferenceSource
  extracted_from_table?: string
  extracted_from_id?: string
  confidence_score?: number
  flywheel?: FlywheelName
}

// ── 2. client_proven_patterns ─────────────────────────────────────────────────

// ── 5. global_learned_lessons（跨客户层，无 client_id）─────────────────────────

export type LessonScope = 'global' | 'industry' | 'channel'
export type LessonSource = 'agent_observation' | 'auto_extracted' | 'fde_annotation' | 'incident'

export interface GlobalLesson {
  id: string
  /** 幂等键：同一经验重复观察走 upsert + confirmed_count+1，不堆重复行 */
  lesson_key: string
  scope: LessonScope
  /** 仅 scope='industry' 时有意义，对应 clients.industry */
  industry: string | null
  /** 'cross' 表示跨飞轮通用（如「配置必须走 UI」） */
  flywheel: FlywheelName | 'cross' | null
  lesson: string
  rationale: string | null
  /** 证据链，DB 层 NOT NULL —— 无出处的「经验」不许入库 */
  evidence: Record<string, unknown>
  confidence: number
  confirmed_count: number
  /** 被反例推翻的次数；远超 confirmed 时应下架 */
  contradicted_count: number
  source: LessonSource
  is_active: boolean
  created_at: string
  updated_at: string
}

export type PatternType = 'hook' | 'cta' | 'angle' | 'format' | 'headline' | 'structure'

export interface ProvenPattern {
  id: string
  client_id: string
  pattern_type: PatternType
  pattern_content: string
  performance_metric?: string | null
  measurement_period_start?: string | null
  measurement_period_end?: string | null
  flywheel?: FlywheelName | null
  source_table?: string | null
  source_id?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CreateProvenPatternInput {
  client_id: string
  pattern_type: PatternType
  pattern_content: string
  performance_metric?: string
  measurement_period_start?: string
  measurement_period_end?: string
  flywheel?: FlywheelName
  source_table?: string
  source_id?: string
}

// ── 3. client_failed_experiments ─────────────────────────────────────────────

export interface FailedExperiment {
  id: string
  client_id: string
  experiment_description: string
  failure_reason: string
  dimension?: DiagnosticDimension | null
  tried_at?: string | null
  source_table?: string | null
  source_id?: string | null
  created_at: string
}

export interface CreateFailedExperimentInput {
  client_id: string
  experiment_description: string
  failure_reason: string
  dimension?: DiagnosticDimension
  tried_at?: string
  source_table?: string
  source_id?: string
}

// ── 4. client_decision_history ────────────────────────────────────────────────

export type OutcomeVerdict = 'success' | 'failure' | 'inconclusive'

export interface DecisionHistory {
  id: string
  client_id: string
  zhuge_session_id?: string | null
  decision_context: string
  chosen_action: string
  alternatives_rejected: string[]
  reasoning: string
  outcome_verdict?: OutcomeVerdict | null
  outcome_notes?: string | null
  created_at: string
}

export interface CreateDecisionHistoryInput {
  client_id: string
  zhuge_session_id?: string
  decision_context: string
  chosen_action: string
  alternatives_rejected: string[]
  reasoning: string
}

// ── MemoryContext — 注入给各 Agent 的汇总包 ───────────────────────────────────

/**
 * MemoryContext 是从数据库查询后汇总的只读快照，
 * 供张骞 / 华佗 / 诸葛亮 / 鲁班 / AI Factory 注入到各自的 prompt 中。
 *
 * 设计原则：
 *   - 所有字段均为可选 —— 无记忆时也能正常运作（向后兼容）
 *   - 内容为纯文本 / 简单列表，方便直接拼进 prompt
 *   - 由 MemoryService.loadForClient() 统一生成，agent 侧只读
 */
export interface MemoryContext {
  /** 该客户的长期内容偏好（active，按 confidence 排序） */
  preferences: Pick<LearnedPreference, 'preference_type' | 'content' | 'confidence_score' | 'flywheel'>[]

  /**
   * 跨客户经验（global_learned_lessons）——不属于任何单个客户的认知，
   * 例如「学区房广告不能只投住在学区附近的人」。按客户 industry + flywheel 匹配。
   * 与上面四类客户级记忆并列，但**不计入 has_content**（见该字段说明）。
   *
   * 可选：既有调用方（含大量测试）手工构造 MemoryContext 字面量，设为必填会全部编译失败。
   * loadMemoryForClient 总会填充它；消费方一律按 `?? []` 处理。
   */
  global_lessons?: Pick<GlobalLesson, 'lesson' | 'rationale' | 'scope' | 'industry' | 'flywheel' | 'confidence'>[]

  /** 已验证的获胜模式（active） */
  proven_patterns: Pick<ProvenPattern, 'pattern_type' | 'pattern_content' | 'performance_metric' | 'flywheel'>[]

  /** 已知失败实验（避免重蹈覆辙） */
  failed_experiments: Pick<FailedExperiment, 'experiment_description' | 'failure_reason' | 'dimension'>[]

  /** 最近 N 次诸葛亮决策历史 */
  recent_decisions: Pick<DecisionHistory, 'decision_context' | 'chosen_action' | 'alternatives_rejected' | 'reasoning' | 'outcome_verdict' | 'created_at'>[]

  /**
   * 是否有实质性**客户级**记忆可注入（四类客户级记忆全空时为 false）。
   * 🔴 刻意不含 global_lessons：全局经验对每个客户都存在，计入会让 has_content 恒为 true，
   * 改变所有既有调用方的行为。全局经验的输出由 formatMemoryForPrompt 单独判断。
   */
  has_content: boolean
}

// ── MemoryService 接口 ────────────────────────────────────────────────────────

export interface MemoryLoadOptions {
  /** 只返回指定飞轮的偏好/模式（null = 全飞轮） */
  flywheel?: FlywheelName
  /** 最多返回的最近决策数，默认 5 */
  maxRecentDecisions?: number
  /** 最低 confidence_score 阈值，默认 0.6 */
  minConfidence?: number
}

/**
 * 诸葛亮 Zhūgě Liàng — 策略调度引擎 类型定义
 *
 * 命名来源：「运筹帷幄，决胜千里」
 * 诸葛亮是四 Agent 链（张骞→华佗→诸葛亮→鲁班）的决策层：
 *   输入：张骞证据 + 华佗诊断 → 输出：priority_actions work order → 鲁班执行
 *
 * Reference: ROADMAP.md Phase 12.G
 */

import type { Client } from '@/types/magic-engine'
import type { DiagnosticDimension, DiagnosticFinding } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { ExecutionMode } from '@/lib/flywheel/adapters/types'
import type { MemoryContext } from '@/lib/memory/types'

// ── Re-exports for convenience ────────────────────────────────────────────────

export type { Client, DiagnosticDimension, DiagnosticFinding, ExecutionMode, MemoryContext }

// ── DAPE W2 prompt mode (dual-track business) ─────────────────────────────────

/**
 * DAPE W2 (spec §1.5.6 + §2.x.6) — Dual prompt mode for dual-track business.
 *
 * - 'short' = Self-Serve client path. Cheap, fast, small token budget.
 *   Only client-level memory injected (Layer 1).
 * - 'long'  = FDE client path. Deep, expensive, full memory.
 *   Client-level + industry-level + global baseline injected (Layers 1+2+3).
 *
 * When undefined, defaults to 'long' (FDE behaviour) to preserve backward
 * compatibility with callers that haven't been updated yet.
 */
export type ZhugePromptMode = 'short' | 'long'

/**
 * DAPE W2 — Industry-level memory snapshot (Layer 2).
 *
 * Lightweight summary derived from industry_benchmarks rows for the client's
 * sub-industry. Used by zhuge conductor + luban-router to anchor recommendations
 * against real peer performance instead of fabricated targets.
 */
export interface IndustryBenchmarkSummary {
  sub_industry: string | null
  /** Per-dimension snapshot (only dimensions present in industry_benchmarks). */
  dimensions: Array<{
    dimension: 'seo' | 'social' | 'reputation' | 'ai_visibility'
    score_p50: number | null
    score_p75: number | null
    score_p90: number | null
    typical_monthly_budget_aud: number | null
    confidence: number
    source: string | null
  }>
  /** True when at least one dimension row was found. */
  has_content: boolean
}

/**
 * DAPE W2 — Self-feedback snapshot (zhuge's own feedback closed loop).
 *
 * Recent zhuge_feedback_events rows for the client. Lets the proactive
 * lens (and the conductor) avoid resurrecting suggestions the client
 * already dismissed or marked irrelevant.
 */
export interface ZhugeFeedbackSummary {
  /** True when at least one event row was loaded. */
  has_content: boolean
  /** Total events sampled (capped). */
  total: number
  /** Counts per feedback_state in the sample. */
  state_counts: { done: number; dismissed: number; irrelevant: number }
  /** Suggestion keys the client repeatedly dismissed (≥2 dismissals). */
  dismissed_keys: string[]
  /** Suggestion keys the client repeatedly marked irrelevant (≥2 irrelevant). */
  irrelevant_keys: string[]
  /** Most recent N events (raw rows for prompt injection). */
  recent_events: Array<{
    suggestion_key: string
    suggestion_title: string
    feedback_state: 'done' | 'dismissed' | 'irrelevant'
    created_at: string
  }>
}

// ── Diagnostic scores snapshot ────────────────────────────────────────────────

/** Flattened 0–100 score per dimension; null = data unavailable / dimension skipped. */
export type DiagnosticScores = Partial<Record<DiagnosticDimension, number | null>>

// ── Business context ──────────────────────────────────────────────────────────

/**
 * Operational constraints and goals the conductor must respect when
 * deciding which actions to recommend and in which order.
 */
export interface BusinessContext {
  /** Monthly marketing budget in AUD/NZD — null when not set. */
  monthly_budget_aud: number | null
  /** Primary business goal for this quarter, e.g. "increase lead volume". */
  primary_goal: string | null
  /** Known blockers that may prevent certain actions, e.g. "no Google Ads account". */
  blockers: string[]
  /** Whether the client has an FDE (Fractional Digital Executive) assigned. */
  has_fde: boolean
  /** Market the client operates in. */
  market: 'AU' | 'NZ' | 'AU/NZ'
}

// ── Luban tool descriptor ─────────────────────────────────────────────────────

/**
 * Describes a single鲁班-executable tool available for this client.
 * The conductor uses this list to decide whether an action can be
 * auto-executed or needs FDE / external handling.
 */
export interface LubanTool {
  /** Dot-separated name used in executable_by, e.g. 'luban.generate_blog_post'. */
  name: string
  /** One-line description of what the tool does. */
  description: string
  /** Which flywheel this tool belongs to. */
  flywheel: 'seo' | 'geo' | 'ads' | 'social'
  /** Execution mode this tool operates in. */
  execution_mode: ExecutionMode
}

// ── Priority action (work order unit) ────────────────────────────────────────

/**
 * A single recommended action produced by the conductor.
 * Mirrors the ROADMAP interface spec exactly.
 */
export interface PriorityAction {
  /** 1 = highest priority. */
  rank: number
  dimension: DiagnosticDimension
  /** Short machine-readable action slug, e.g. 'publish_geo_directive'. */
  action_type: string
  /** Human-readable explanation of why this action should be done now. */
  why_now: string
  /** References to specific evidence from 张骞 / 华佗 that backs this recommendation. */
  evidence_refs: string[]
  expected_impact: 'low' | 'medium' | 'high'
  effort: 'low' | 'medium' | 'high'
  execution_mode: ExecutionMode
  /** Luban tool name if auto-executable; null if FDE or external handling required. */
  executable_by: string | null
  /**
   * Optional action-type-specific payload. When set, action-persister writes it
   * to execution_items.steps_json so the Content Workbench (and any other
   * downstream UI) can pre-fill domain-aware fields instead of re-deriving them
   * from action_type/title.
   *
   * SEO patrol uses this to carry the real target keyword
   * (e.g. { keyword: 'chengdu panda tours', rule_id: 'keyword_opportunity', ... }),
   * so the article studio prefills the keyword field with the keyword the rule
   * actually identified, not the generic "Publish Blog" title.
   */
  metadata?: Record<string, unknown>
}

// ── Conductor input / output ──────────────────────────────────────────────────

/** Full input bundle passed to the conductor. */
export interface ZhugeInput {
  client: Client
  /** Latest 张骞 discovery snapshot. */
  discoveryEvidence: DiscoveryReport
  /** 华佗 dimension scores (0–100 or null). */
  diagnosticScores: DiagnosticScores
  /** 华佗 finding list (all severities). */
  findings: DiagnosticFinding[]
  /** 鲁班 tools currently available for this client. */
  availableLubanTools: LubanTool[]
  businessContext: BusinessContext
  /** Phase 23 L3 记忆层注入（可选 — 无记忆时行为与旧版完全一致）。 */
  memoryContext?: MemoryContext
  /**
   * DAPE W2 — Layer 2 行业级 memory（industry_benchmarks 汇总）。
   * Only used in long mode; passed-through harmlessly in short mode.
   */
  industryBenchmarkSummary?: IndustryBenchmarkSummary
  /**
   * DAPE W2 — zhuge 自身的反馈学习闭环（zhuge_feedback_events）。
   * Used by conductor to skip recommendations the client already dismissed.
   */
  feedbackSummary?: ZhugeFeedbackSummary
  /**
   * DAPE W2 — Prompt mode. Defaults to 'long' when omitted (FDE behaviour,
   * backward-compatible). Self-Serve callers should pass 'short' to save tokens.
   */
  promptMode?: ZhugePromptMode
}

/** Structured work order produced by the conductor. */
export interface ZhugeOutput {
  top_actions: PriorityAction[]
  /** ISO 8601 timestamp of when this work order was generated. */
  generated_at: string
  /** Claude cost for this conductor call. */
  cost_usd: number
  /** Tokens consumed. */
  input_tokens: number
  output_tokens: number
}

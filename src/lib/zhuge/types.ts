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

// ── Re-exports for convenience ────────────────────────────────────────────────

export type { Client, DiagnosticDimension, DiagnosticFinding, ExecutionMode }

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

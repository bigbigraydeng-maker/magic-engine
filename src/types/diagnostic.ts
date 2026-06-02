// ============================================
// Diagnostic Engine — Core Types (P8.5.1)
// ============================================

import type { ExecutionTarget } from '@/lib/flywheel/adapters/types'
export type { ExecutionTarget }

export type DiagnosticDimension =
  | 'seo'
  | 'ai_visibility'
  | 'ads'
  | 'social'
  | 'reputation'
  | 'competitor'

export type DiagnosticSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type FixType = 'me_auto' | 'fde_manual' | 'third_party'

// ── Finding Types (Appendix A) ────────────────────────────────────────────────

export type SeoFindingType =
  | 'missing_meta_title'
  | 'missing_meta_description'
  | 'thin_content'
  | 'missing_schema_markup'
  | 'broken_internal_links'
  | 'duplicate_content'
  | 'missing_h1'
  | 'page_speed_poor'
  | 'missing_alt_text'
  | 'no_sitemap'
  | 'keyword_gap_critical'
  | 'low_domain_rank'
  | 'keywords_not_configured'  // P8.5.19: no target keywords set up
  | 'low_referring_domains'    // P8.10.S2.1: backlink profile too thin
  | 'serp_invisible'           // P8.10.S2.1: no target keyword ranks in top 100 SERP
  | 'serp_buried'              // P8.10.S2.1: ranked keywords avg position > 30

export type AiVisibilityFindingType =
  | 'brand_not_mentioned'
  | 'low_ai_rank'
  | 'no_geo_directive'
  | 'geo_directive_outdated'
  | 'missing_faq_content'
  | 'insufficient_entity_coverage'
  | 'ai_visibility_not_tracked'  // P8.5.22: AI Tracker never ran for this client
  | 'live_probe_no_mention'

export type AdsFindingType =
  | 'high_cpc'
  | 'low_quality_score'
  | 'missing_ad_extensions'
  | 'poor_landing_page_relevance'
  | 'budget_inefficiency'

export type SocialFindingType =
  | 'low_posting_frequency'
  | 'low_engagement_rate'
  | 'missing_platform_presence'
  | 'inconsistent_brand_voice'
  | 'no_content_calendar'
  | 'social_accounts_not_linked'  // P8.5.23: IG/FB handles not configured

export type ReputationFindingType =
  | 'negative_reviews'
  | 'low_review_rating'
  | 'missing_review_responses'
  | 'insufficient_review_count'
  | 'inconsistent_business_info'
  | 'no_review_platform'
  | 'business_not_listed'  // P8.5.20: no Google Business Profile found

export type CompetitorFindingType =
  | 'competitor_keyword_gap'
  | 'competitor_content_gap'
  | 'competitor_backlink_gap'
  | 'competitor_ranking_advantage'
  | 'market_share_loss'
  | 'traffic_gap_large'
  | 'no_competitor_data'
  | 'competitor_data_insufficient'  // P8.5.21: < 3 competitors detected

export type FindingType =
  | SeoFindingType
  | AiVisibilityFindingType
  | AdsFindingType
  | SocialFindingType
  | ReputationFindingType
  | CompetitorFindingType

// ── DiagnosticRun (§2.1) ──────────────────────────────────────────────────────

export type DiagnosticRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type DiagnosticTrigger = 'user' | 'cron' | 'onboarding'

export interface DiagnosticRun {
  id: string
  client_id: string
  triggered_by: DiagnosticTrigger
  status: DiagnosticRunStatus
  dimensions_requested: DiagnosticDimension[]
  /** P8.5.26: dimensions excluded from overall_score due to missing data */
  dimensions_skipped: DiagnosticDimension[]
  overall_score: number | null
  /** Score per dimension. `null` value = data not available (excluded from overall_score). */
  dimension_scores: Partial<Record<DiagnosticDimension, number | null>> | null
  findings_count: number
  critical_count: number
  high_count: number
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  created_at: string
}

// ── DiagnosticFinding (§2.2) ──────────────────────────────────────────────────

export interface DiagnosticFinding {
  id: string
  run_id: string
  client_id: string
  dimension: DiagnosticDimension
  finding_type: FindingType
  severity: DiagnosticSeverity
  title: string
  description: string
  evidence: Record<string, unknown> | null
  recommendation: string
  fix_type: FixType
  priority_score: number
  created_at: string
}

// ── Prescription (§2.3) ───────────────────────────────────────────────────────

export type PrescriptionStatus =
  | 'generating'   // 华佗后台异步执行中
  | 'failed'       // 异步执行失败
  | 'draft'
  | 'approved'
  | 'rejected'
  | 'superseded'

export interface Prescription {
  id: string
  client_id: string
  run_id: string | null
  discovery_id: string | null
  status: PrescriptionStatus
  intake: PrescriptionIntake | null
  content: PrescriptionContent | null
  generated_at: string | null
  approved_at: string | null
  error_message: string | null
  progress_note: string | null
  /** 本处方补充了哪份处方（增量，原处方保持有效）。NULL = 原始处方 */
  supplements_id: string | null
  /** 本处方修订/替代了哪份处方（批准后原处方置 superseded）。NULL = 非修订 */
  supersedes_id: string | null
  created_at: string
  updated_at: string
}

/**
 * 华佗"补充/修订"模式的上下文 — 让华佗知道原处方做了啥、执行到哪了。
 */
export type PriorPrescriptionMode = 'supplement' | 'revision'

export interface PriorPrescriptionContext {
  mode: PriorPrescriptionMode
  /** 被补充/修订的处方全文 */
  priorContent: PrescriptionContent
  /** 原处方的执行进度摘要（已完成/进行中/待处理 + 已完成动作清单） */
  executionSummary: string
}

// ── ExecutionItem (§2.4) ──────────────────────────────────────────────────────

export type ExecutionItemStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

/** 执行项来源 — diagnostic（处方派发）/ marketing_plan（营销计划派发）/ fde_manual（FDE 手动录入）/ proactive_signal（诸葛亮主动检测）*/
export type ExecutionItemSource = 'diagnostic' | 'marketing_plan' | 'fde_manual' | 'proactive_signal' | 'zhuge' | 'luban' | 'fde'

export interface ExecutionItem {
  id: string
  /** 处方派发任务时有值；marketing_plan 来源时为 null */
  prescription_id: string | null
  client_id: string
  finding_id: string | null
  dimension: DiagnosticDimension
  phase: number
  title: string
  description: string
  fix_type: FixType
  status: ExecutionItemStatus
  steps_json: Record<string, unknown> | null
  execution_target: ExecutionTarget | null
  assigned_to: string | null
  due_date: string | null
  started_at: string | null
  completed_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
  /** 关联的内容帖子 ID。社媒/SEO 内容类执行项的产出物。published 后自动 mark completed。 */
  content_post_id: string | null
  /** 来源类型 — 决定看板分组和徽章显示 */
  source: ExecutionItemSource
  /** marketing_plan 来源时有值，作为分组键 */
  marketing_plan_id: string | null
  /** Phase 31/33: Initiative this action belongs to (nullable for legacy items) */
  initiative_id: string | null
}

/** 内容飞轮闭环 — 执行看板 row 上展示的关联内容预览（execution GET 时 embed） */
export interface LinkedContentPost {
  id: string
  title: string
  status: string
  platforms: string[]
  caption: string | null
  scheduled_at: string | null
  visual_asset_url: string | null // 取 final 版本或 latest version 的 storage_url
}

// ── ExecutionLog (鲁班执行代理 — P8.10.S4) ────────────────────────────────────

export type ExecutionLogAuthor = 'fde' | 'luban' | 'system'
export type ExecutionLogKind =
  | 'note'           // FDE 手写进度记录
  | 'status_change'  // 状态流转（system 自动写）
  | 'ai_assist'      // 鲁班 AI 协助产出
  | 'blocker'        // FDE 标记的卡点
  | 'adjustment'     // 对 action 的调整建议

export interface ExecutionLog {
  id: string
  execution_item_id: string
  client_id: string
  author: ExecutionLogAuthor
  kind: ExecutionLogKind
  content: string
  meta: Record<string, unknown> | null
  created_at: string
}

// ── PrescriptionIntake (§4.1) ─────────────────────────────────────────────────

export type TimelineUrgency = 'immediate' | 'short_term' | 'long_term'

export interface PrescriptionIntake {
  business_goal: string
  timeline_urgency: TimelineUrgency
  monthly_budget_aud: number
  priority_dimensions: DiagnosticDimension[]
  notes: string | null
}

// ── PrescriptionContent (§4.3) ────────────────────────────────────────────────

export type EffortLevel = 'low' | 'medium' | 'high'

export interface PrescriptionAction {
  id: string
  title: string
  description: string
  dimension: DiagnosticDimension
  fix_type: FixType
  phase: number
  effort: EffortLevel
  impact: EffortLevel
  finding_ids: string[]

  // ── 华佗 Agent 扩展字段（P8.10.S3 FDE-ready）─────────────────────
  /** FDE 预计工时（小时） */
  estimated_hours?: number
  /** 执行所需技能标签（中文，如「SEO 文案」「WordPress 开发」「Photoshop」） */
  required_skills?: string[]
  /** 如何度量这个动作是否生效（中文，如「GA4 月有机会话数」） */
  measurement_method?: string
  /** 依赖的其他 action.id（必须先完成才能做这个） */
  dependencies?: string[]
  /** 由哪个 Magic Engine 模块承接（决定路由到哪个工作台） */
  module?: 'seo_engine' | 'social_matrix' | 'ads_intelligence' | 'insight_reports' | 'manual'
  /**
   * 飞轮执行路由（P12.A.11）。由 deriveExecutionTarget(dimension, fix_type) 推导，
   * 决定执行看板该卡片走哪个 adapter / 弹什么抽屉。
   */
  execution_target?: ExecutionTarget
}

export interface PrescriptionPhase {
  phase_number: number
  name: string
  duration_weeks: number
  actions: PrescriptionAction[]
}

export interface KPITarget {
  metric: string
  current_value: number | null
  target_value: number
  unit: string
  dimension: DiagnosticDimension
  /** 华佗：目标对应的时间窗口（如「6 个月」） */
  timeframe?: string
  /** 华佗：目标值的现实性置信度 0–1（基于行业基准） */
  realism_confidence?: number
  /** 华佗：参考的基准 ID（来自 industry_benchmarks） */
  benchmark_id?: string
}

export interface BudgetAllocationItem {
  dimension: DiagnosticDimension
  amount_aud: number
  percentage: number
}

export interface PrescriptionContent {
  summary: string
  phases: PrescriptionPhase[]
  kpi_targets: KPITarget[]
  budget_allocation: BudgetAllocationItem[]
}

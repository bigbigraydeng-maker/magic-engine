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
  | 'social_scrape_failed'        // 2026-06-05: Apify scraper threw for a configured platform
  | 'social_collector_error'      // 2026-06-05: collector stalled / crashed before per-platform loop

export type ReputationFindingType =
  | 'negative_reviews'
  | 'low_review_rating'
  | 'missing_review_responses'
  | 'insufficient_review_count'
  | 'inconsistent_business_info'
  | 'no_review_platform'
  | 'business_not_listed'         // P8.5.20: no Google Business Profile found
  | 'reviews_likely_off_platform' // A1: high rating but very few GBP reviews → industry platforms
  | 'review_lookup_failed'        // 2026-06-06: multiple review platforms attempted, all returned null (transient outage / query mismatch)

export type CompetitorFindingType =
  | 'competitor_keyword_gap'
  | 'competitor_content_gap'
  | 'competitor_backlink_gap'
  | 'competitor_ranking_advantage'
  | 'market_share_loss'
  | 'traffic_gap_large'
  | 'no_competitor_data'
  | 'competitor_data_insufficient'  // P8.5.21: < 3 competitors detected
  | 'competitor_traffic_unknowable' // BUG-FMT-S14: ≥3 competitors but traffic data missing — score=null instead of fake 100/100

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
  /**
   * DAPE Week 2 W4 — Phase 31 三层骨架对齐: 处方跟 Goal 一对一.
   * NULL = pre-DAPE legacy 处方 (CTS/Oztop 现有 6 条). DAPE-era API enforces non-null.
   * Spec: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §2.3
   */
  goal_id: string | null
  /**
   * 同一 Goal 下处方版本号 (v1/v2/v3...). API 插入时自动 = max(version)+1.
   * supersedes_id 链路指向上一版的真实 row id; version 是给 UI 渲染滚动 chips 用.
   */
  version: number
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

/**
 * Execution item lifecycle status.
 *
 * - `pending` / `in_progress` / `completed` / `skipped` — FDE-facing transitions.
 * - `superseded` — **system-only** terminal state, written when DAPE/Zhuge regenerates
 *   recommendations and supersedes an older pending row (see
 *   `src/lib/zhuge/action-persister.ts::writeExecutionItems`). FDE cannot transition
 *   a card into this state; it appears only in read paths (kanban / timeline / docx).
 */
export type ExecutionItemStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'superseded'

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
  /** 关联的量产包 ID — 一键量产生成的 production_package。multi-post 任务的归属。 */
  production_package_id: string | null
  /** 来源类型 — 决定看板分组和徽章显示 */
  source: ExecutionItemSource
  /** marketing_plan 来源时有值，作为分组键 */
  marketing_plan_id: string | null
  /** Phase 31/33: Initiative this action belongs to (nullable for legacy items) */
  initiative_id: string | null
  /** Kanban Content Workbench: wall-clock when the latest content generation started. NULL = never tried. */
  generation_started_at: string | null
  /** Kanban Content Workbench: populated when the latest generation failed. NULL = no failure / cleared on retry. */
  generation_error: string | null
  /**
   * Phase 22.E.S13: machine-readable action slug from SEO_ACTION_TYPE /
   * other flywheel vocabularies. Drives Content Studio tab routing — landing
   * page / page SEO optimiser tabs branch on this. NULL for legacy items
   * written before P24.A added the DB column.
   */
  action_type: string | null
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

/**
 * Kanban 卡片内容状态条 — 四档信号（文/图/视/发），FDE 不开抽屉就能看到进度。
 *
 * 每档值：
 *   - 'ready'      ✓  绿色 — 已就绪
 *   - 'generating' ⏳ 蓝色 — 生成中
 *   - 'failed'     ✗  红色 — 失败（可重试）
 *   - 'pending'    ·  灰色 — 未开始
 *   - 'na'         —  灰色 — 不适用（如纯文章任务无视频档）
 *
 * priority_signal 是边框色推导依据：
 *   - 'failed'      → 红边（最高优先级，FDE 立刻处理）
 *   - 'stale'       → 黄边（超时）
 *   - 'generating'  → 蓝边（不打扰）
 *   - 'published'   → 绿边
 *   - 'normal'      → 白边
 */
export type ContentStateSignal = 'ready' | 'generating' | 'failed' | 'pending' | 'na'
export type CardPrioritySignal = 'failed' | 'stale' | 'generating' | 'published' | 'normal'

export interface CardContentState {
  text:       ContentStateSignal      // caption / script 有无
  image:      ContentStateSignal      // visual_assets 状态
  video:      ContentStateSignal      // reels_drafts 状态
  publish:    ContentStateSignal      // publer_post_id / scheduled_at
  priority:   CardPrioritySignal
  /** 最近一次相关状态变更时间（ISO 字符串）— 用于卡片右下角"3 分钟前" */
  last_changed_at: string | null
  /** 多帖任务进度（量产包）— 仅 production_package_id 非空时填 */
  package_progress?: {
    total:      number
    ready:      number
    generating: number
    failed:     number
  }
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
  /**
   * DAPE Week 2 W4 — phase 由 Goal period 派生时长, 每个 phase 派生 1 个 Initiative.
   * NULL = legacy 处方 (3 阶段固定"止血/建设/护城河"). 新处方华佗必须填.
   *
   * Initiative 在处方批准时自动 batch insert (见 PATCH /prescription/[pId]).
   * Spec §2.3.3.
   */
  initiative_seed?: PhaseInitiativeSeed
}

/**
 * DAPE Week 2 W4 — 处方每个 phase 派生 1 个 Initiative 的种子.
 * 字段对齐 Phase 31 `CreateInitiativeInput`. tier 由 initiative_type 自动推导.
 */
export interface PhaseInitiativeSeed {
  /** Phase 31 6 类型 + unassigned. terminal 类型直接 drive Goal verdict, supporting 服务其他 Initiative. */
  initiative_type:
    | 'demand_generation'
    | 'conversion_optimization'
    | 'trust_building'
    | 'competitive_defense'
    | 'market_education'
    | 'content_asset_production'
    | 'unassigned'
  /** Initiative 标题 (跟 phase.name 一致, 或更精炼). 中文. */
  title: string
  /** 进攻 / 防守 / 快攻 / 慢推. NULL = 待 FDE 填. */
  posture?: 'offensive' | 'defensive' | 'fast' | 'slow' | null
  /** 占 Goal 总预算的百分比. 同 Goal 下所有 Initiative budget_percent 之和 ≤ 100. */
  budget_percent?: number | null
  /** 为什么押这一条 (战略假设, 90 天后验证). FDE/AI 一起填. */
  hypothesis?: string | null
  /** Supporting 类型必须指向 1 个 terminal Initiative. 由派生逻辑后填 (不在 huatuo 输出). */
  supports_phase_number?: number | null
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
  /**
   * DAPE W3 — 处方大白话叙事（spec §2.2/§2.3）。
   * 华佗在跑完处方生成后给客户一段 200–400 字的中文总结，回答三个问题：
   *   1. 当前最大的问题是什么（一句话）
   *   2. 处方分几个阶段怎么解决（按 phase 列举）
   *   3. 阶段一最该先动的 1–2 件事（具体到 action title）
   * 可选 — 旧数据不带此字段，UI/序列化要兜底为空字符串。
   */
  narrative?: string
}

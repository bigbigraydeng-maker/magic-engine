/**
 * Marketing Plan — TypeScript types
 *
 * Phase 14.B: 营销计划层
 * Master Brief (品牌 DNA) × Campaign Brief (活动目标) → Marketing Plan → Luban 任务
 *
 * Plan 结构对齐资深 Marketing Manager 的标准工作流：
 *   - social: 各平台数量/频率
 *   - blog:   月度文章数 + 主题清单
 *   - kpis:   计划层 KPI
 *   - tasks:  批准后派发到 Luban 的具体任务清单
 */

// ─── Plan 状态 ────────────────────────────────────────────────────────────────

export type MarketingPlanStatus = 'draft' | 'approved' | 'completed' | 'archived'

// ─── 社媒维度配置 ──────────────────────────────────────────────────────────────

export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok' | 'linkedin'

export interface PlatformContentMix {
  /** 每周帖子数（图文）*/
  posts_per_week: number
  /** 每月 Reels/短视频数 */
  reels_per_month: number
  /** 每周 Story 数（仅 Facebook/Instagram 有 Story）*/
  stories_per_week: number
  /** 平台层 tone / 风格补充说明（覆盖 Master Brief 默认）*/
  tone_note?: string | null
}

export type SocialPlanByPlatform = Partial<Record<SocialPlatform, PlatformContentMix>>

// ─── 博客维度 ──────────────────────────────────────────────────────────────────

/**
 * 单个博客主题。
 * source_strategy_item_id 指向 content_strategy_items 表中的某条建议（如果有），
 * 用于回溯主题来源（SEO 数据驱动）。
 */
export interface BlogTopicPlan {
  title: string
  primary_keyword: string | null
  keyword_volume: number | null
  keyword_kd: number | null
  due_week: number                    // 1-N（计划周期内的第几周）
  rationale: string                   // 为什么选这个主题
  source_strategy_item_id?: string | null
  content_mode?: 'unified' | 'geo_only' | 'seo_only'
}

export interface BlogPlan {
  /** 计划周期内总博客数 */
  monthly_count: number
  topics: BlogTopicPlan[]
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

export interface PlanKPIs {
  social_engagement?: string | null
  blog_traffic?: string | null
  ai_visibility?: string | null
  /** 自由文字 KPI（其他维度）*/
  other?: string | null
}

// ─── 任务（派发到 Luban）──────────────────────────────────────────────────────

export type PlanTaskKind = 'social_post' | 'social_reel' | 'social_story' | 'blog_article'

export interface PlanTask {
  /** 任务类型 — 决定 Luban kanban 上的徽章和工作台跳转目标 */
  kind: PlanTaskKind
  /** 仅 social_* 任务有 platform */
  platform?: SocialPlatform
  /** 任务标题（显示在 Luban 卡片上）*/
  title: string
  /** 详细描述（注入到生成 prompt）*/
  description: string
  /** 截止日期（影响 phase 分组）*/
  due_date: string                       // YYYY-MM-DD
  /** 主题（社媒帖子）或主关键词（博客）*/
  topic?: string | null
  /** 关联到博客 plan 的某个 topic（用于关联生成内容）*/
  source_blog_topic_index?: number | null
  /** 关联 Strategy 数据来源 */
  source_strategy_item_id?: string | null
}

// ─── 完整 Plan 数据 ────────────────────────────────────────────────────────────

export interface MarketingPlanData {
  social: SocialPlanByPlatform
  blog: BlogPlan
  kpis: PlanKPIs
  tasks: PlanTask[]
  /** AI 生成阶段的总览说明（让 FDE 快速理解 plan 思路）*/
  executive_summary?: string | null
}

// ─── 数据库行类型 ─────────────────────────────────────────────────────────────

export interface MarketingPlan {
  id: string
  client_id: string
  campaign_id: string | null
  master_brief_id: string | null
  title: string
  status: MarketingPlanStatus
  start_date: string | null              // YYYY-MM-DD
  end_date: string | null
  plan_data: MarketingPlanData
  generation_meta: {
    model?: string
    prompt_version?: string
    generation_cost_usd?: number
    generated_at?: string
  } | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

// ─── 生成请求 ──────────────────────────────────────────────────────────────────

export interface GeneratePlanRequest {
  campaign_id?: string                   // 可选 — 不传则只用 Master Brief
  title: string
  start_date: string                     // YYYY-MM-DD
  end_date: string
  /** 用户指定的关注点（可选，注入到 prompt 引导 AI）*/
  focus_note?: string
  /** 期望的内容强度 — light/standard/aggressive */
  intensity?: 'light' | 'standard' | 'aggressive'
}

// ─── 派发结果 ──────────────────────────────────────────────────────────────────

export interface DispatchResult {
  marketing_plan_id: string
  tasks_created: number
  task_ids: string[]
}

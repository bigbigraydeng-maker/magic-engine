/**
 * Marketing Plan — TypeScript types
 *
 * Phase 14.B: 营销计划层
 * Master Brief (品牌 DNA) × Campaign Brief (活动目标) → Marketing Plan → Luban 任务
 *
 * Plan 结构对齐资深 Marketing Manager 的标准工作流：
 *   - social: 各平台数量/频率
 *   - blog:   月度文章数 + 主题清单
 *   - email:  newsletter 主题 + 发送节奏（仅已开通邮件渠道客户才会生成，见 generator.ts 的 gate）
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

// ─── Newsletter / 邮件维度 ──────────────────────────────────────────────────────

/**
 * 单个 newsletter 主题。
 *
 * `requires_link` 是 2026-09 CTS 事故（一封"中国免签"提醒信打开率不低但点击率
 * 必然为 0——正文压根没放链接）之后加的强制字段：只要这封信提到具体的团 / 产品 /
 * 房源，`requires_link` 必须为 true，task 描述里必须明确写"要放哪个页面的真实链接"。
 * 不带具体产品的软性问候信可以是 false，但即便如此也必须在 task 描述里写清楚
 * 该给读者一个什么样的低门槛下一步（哪怕只是"回复邮件"），不能什么都不给。
 */
export interface EmailTopicPlan {
  title: string
  angle: string
  due_date: string                    // YYYY-MM-DD
  rationale: string                   // 为什么这个时间点发这个主题
  /** 这封信主要发给谁（自由文本，如"近 30 天未开单的沉睡潜客"）——不是 Mailchimp tag 名，tag 名留给 FDE 在客户配置里对应 */
  target_segment: string | null
  requires_link: boolean
}

export interface EmailPlan {
  /** 平均发送间隔（天）。0 = 本计划期不建议发 newsletter（例如客户没有邮件渠道）。 */
  cadence_days: number
  topics: EmailTopicPlan[]
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

export type PlanTaskKind = 'social_post' | 'social_reel' | 'social_story' | 'blog_article' | 'newsletter_email'

/** Phase 20.D: 素材依赖标注 — FDE 执行前需准备的素材类型 */
export type PlanTaskRequires = 'none' | 'client_photo' | 'client_video' | 'client_info'

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
  /** 关联到 email plan 的某个 topic（用于关联生成内容，仅 kind='newsletter_email' 使用）*/
  source_email_topic_index?: number | null
  /** 关联 Strategy 数据来源 */
  source_strategy_item_id?: string | null
  /**
   * 仅 kind='newsletter_email' 使用，原样搬自对应 EmailTopicPlan.requires_link。
   * true 时 FDE 发布前必须确认正文里带了真实链接——不是提示，是硬检查项
   * （见 EmailTopicPlan 上的事故背景说明）。
   */
  requires_link?: boolean | null
  /**
   * Phase 20.D: 素材依赖标注
   *   'none'         — ME 可全自动生成，无需客户提供素材
   *   'client_photo' — 需要客户提供实景照片
   *   'client_video' — 需要客户提供视频素材或到场拍摄
   *   'client_info'  — 需要客户提供信息（产品数据、案例等）
   */
  requires?: PlanTaskRequires | null
}

// ─── 完整 Plan 数据 ────────────────────────────────────────────────────────────

export interface MarketingPlanData {
  social: SocialPlanByPlatform
  blog: BlogPlan
  /**
   * 可选——只有传了邮件渠道历史表现数据（见 generator.ts 的
   * emailPerformance 参数）AI 才会填这段；没传时固定是
   * `{ cadence_days: 0, topics: [] }`，代表"这个客户没有邮件渠道，不规划"。
   * 换客户测试：Roman/Oztop 没有邮件渠道时这个字段天然是空壳，不会有任何
   * newsletter_email 任务被生成，不需要为它们改代码。
   */
  email?: EmailPlan
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
    /** true = 生成时撞到输出上限被截断，tasks/email 等数组可能不完整，需要人工核对再批准。 */
    truncated?: boolean
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
  /** 期望的内容强度 — light/standard/aggressive/ai_factory（ai_factory = AI Factory 全速量产档）*/
  intensity?: 'light' | 'standard' | 'aggressive' | 'ai_factory'
  /** Phase 33: Initiative this plan is executing against */
  initiative_id?: string
}

// ─── 派发结果 ──────────────────────────────────────────────────────────────────

export interface DispatchResult {
  marketing_plan_id: string
  tasks_created: number
  task_ids: string[]
  packages_created: number
  package_ids: string[]
}

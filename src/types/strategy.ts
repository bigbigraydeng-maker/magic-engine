/**
 * Phase 31 + 32 Strategy Layer — TypeScript types
 *
 * Mirrors the Supabase schema in:
 *   supabase/migrations/20260619000003_phase31_strategy_layer_foundation.sql
 *   supabase/migrations/20260620000001_phase32_goal_subtypes_multi_active.sql
 *
 * Three-layer model (flat MVP; hierarchy reserved for high-tier FDE service):
 *   GOAL (multiple active per client) ← P32 移除 1-active 限制
 *      ↓
 *   INITIATIVES (multiple, terminal/supporting)
 *      ↓
 *   ACTIONS (execution_items.initiative_id)
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type GoalIntent = 'acquisition' | 'sales' | 'awareness'

// ─── Goal sub-types (Phase 32) ───────────────────────────────────────────────
// 按 intent 分流，让指标候选库 + verdict 公式按 sub_type 推荐差异化行为

export type SalesSubType =
  | 'ongoing_revenue'      // 月营收持续型（Oztop 电商月 5 万）
  | 'inventory_clearance'  // 清仓型（Oztop Walnut 地板）— 配 target_direction=decrease
  | 'product_launch'       // 产品/团报名型（CTS 春节团）— 倒计时
  | 'conversion_lift'      // 漏斗转化优化

export type AcquisitionSubType =
  | 'ongoing'              // 持续获客（Oztop Brisbane 月询盘）
  | 'event_driven'         // 事件驱动获客

export type AwarenessSubtype =
  | 'new_market'
  | 'event_campaign'
  | 'geographic_expansion'
  | 'reputation_recovery'

/** Union of all sub-types — used as `goals.sub_type` text column. */
export type GoalSubType = SalesSubType | AcquisitionSubType | AwarenessSubtype

export type TargetDirection = 'increase' | 'decrease'

export type GoalStatus = 'draft' | 'active' | 'expired' | 'archived'

export type GoalVerdict = 'confirmed' | 'partial' | 'reversed' | 'inconclusive'

export type InitiativeType =
  | 'demand_generation'
  | 'conversion_optimization'
  | 'trust_building'
  | 'competitive_defense'
  | 'market_education'
  | 'content_asset_production'
  | 'unassigned'

export type InitiativeTier = 'terminal' | 'supporting'

export type InitiativePosture = 'offensive' | 'defensive' | 'fast' | 'slow'

// ─── Sub-type catalog (drives UI Step 2 + metric recommendations) ────────────

export const GOAL_SUBTYPES_BY_INTENT: Record<GoalIntent, Array<{
  value: GoalSubType
  label_zh: string
  label_en: string
  emoji: string
  description: string
  default_direction: TargetDirection
  example: string
}>> = {
  sales: [
    { value: 'ongoing_revenue', label_zh: '月营收持续', label_en: 'Ongoing Revenue', emoji: '📈',
      description: '持续型 sales — 月营收 / 月订单数 / 月签约额',
      default_direction: 'increase',
      example: 'Oztop 电商渠道月销 0 → 50k AUD' },
    { value: 'inventory_clearance', label_zh: '清仓型', label_en: 'Inventory Clearance', emoji: '📦',
      description: '清空库存型 — 主指标向下走 (库存件数 → 0)',
      default_direction: 'decrease',
      example: 'Oztop Walnut 地板库存 500 → 0 件' },
    { value: 'product_launch', label_zh: '产品/团报名', label_en: 'Product Launch', emoji: '🚀',
      description: '产品发布 / 团报名 — 倒计时到截止日',
      default_direction: 'increase',
      example: 'CTS 2026 春节团报名 0 → 30 人' },
    { value: 'conversion_lift', label_zh: '转化优化', label_en: 'Conversion Lift', emoji: '🎯',
      description: '已有流量但转化弱 — 漏斗下游优化',
      default_direction: 'increase',
      example: '电商加购率 2% → 5%' },
  ],
  acquisition: [
    { value: 'ongoing', label_zh: '持续获客', label_en: 'Ongoing', emoji: '🌱',
      description: '90 天滚动 — 月询盘 / 表单提交 / 线索数',
      default_direction: 'increase',
      example: 'Oztop Brisbane 月询盘 20 → 50' },
    { value: 'event_driven', label_zh: '事件驱动', label_en: 'Event-driven', emoji: '⚡',
      description: '活动 / 展会 / 季节性获客',
      default_direction: 'increase',
      example: '春节后促销 60 天集中获客' },
  ],
  awareness: [
    { value: 'new_market', label_zh: '新品牌进入', label_en: 'New Market', emoji: '🏙',
      description: '新品牌进入新市场 — 倒计时到关键日',
      default_direction: 'increase',
      example: '中国车企进 NZ' },
    { value: 'event_campaign', label_zh: '活动推广', label_en: 'Event Campaign', emoji: '🎪',
      description: '活动 / 博览会 / 发布会 — 倒计时',
      default_direction: 'increase',
      example: '新西兰中国商品博览会' },
    { value: 'geographic_expansion', label_zh: '地理扩张', label_en: 'Geographic Expansion', emoji: '🗺',
      description: '已有品牌进入新城市 / 新州',
      default_direction: 'increase',
      example: 'Christchurch 拓 Auckland' },
    { value: 'reputation_recovery', label_zh: '口碑修复', label_en: 'Reputation Recovery', emoji: '🛡',
      description: '负面事件 / 危机后口碑修复',
      default_direction: 'increase',
      example: '差评涌入后形象修复' },
  ],
}

/** Quick lookup: sub_type → default direction (for verdict computation). */
export function getDefaultDirectionForSubType(subType: GoalSubType | null): TargetDirection {
  if (!subType) return 'increase'
  for (const intent of ['sales', 'acquisition', 'awareness'] as GoalIntent[]) {
    const found = GOAL_SUBTYPES_BY_INTENT[intent].find(s => s.value === subType)
    if (found) return found.default_direction
  }
  return 'increase'
}

// ─── Initiative type catalog (drives UI selectors + AI suggestions) ──────────

export const INITIATIVE_TYPE_TIER: Record<InitiativeType, InitiativeTier> = {
  demand_generation:        'terminal',
  conversion_optimization:  'terminal',
  trust_building:           'terminal',
  competitive_defense:      'terminal',
  market_education:         'terminal',
  content_asset_production: 'supporting',
  unassigned:               'supporting',
}

export const INITIATIVE_TYPE_LABEL: Record<InitiativeType, { en: string; zh: string; description: string }> = {
  demand_generation: {
    en: 'Demand Generation',
    zh: '需求生成',
    description: '让更多潜客知道你存在 — 跨 SEO/Social/Ads/AI Visibility',
  },
  conversion_optimization: {
    en: 'Conversion Optimization',
    zh: '转化优化',
    description: '把流量变成订单 — Landing+Retargeting+信任建设',
  },
  trust_building: {
    en: 'Trust Building',
    zh: '信任建设',
    description: '让市场相信你靠谱 — Reputation+UGC+PR',
  },
  competitive_defense: {
    en: 'Competitive Defense',
    zh: '竞争防御',
    description: '守住份额 / 应对竞品 — 用 Phase 30 行业基准对照',
  },
  market_education: {
    en: 'Market Education',
    zh: '市场教育',
    description: '让市场理解你的品类或价值 — 内容+AI Vis+PR（新品类适用）',
  },
  content_asset_production: {
    en: 'Content & Asset Production',
    zh: '内容资产生产',
    description: '弹药库 — 服务其他 Initiative，不直接驱动 Goal verdict',
  },
  unassigned: {
    en: 'Unassigned Backlog',
    zh: '未分类积压',
    description: '系统迁移产生的兜底分类，FDE 应该重新归类到真实 Initiative',
  },
}

// ─── Database row types ──────────────────────────────────────────────────────

export interface GoalRow {
  id: string
  client_id: string

  intent: GoalIntent
  awareness_subtype: AwarenessSubtype | null
  /** Phase 32: per-intent sub-type (sales/acquisition/awareness specific). */
  sub_type: GoalSubType | null
  title: string

  primary_metric_key: string
  primary_metric_label: string
  primary_metric_unit: string | null
  baseline_value: number
  target_value: number
  /** Phase 32: 'decrease' for inventory clearance, churn reduction etc. */
  target_direction: TargetDirection

  supporting_metrics: SupportingMetric[]

  period_start: string  // ISO date
  period_end: string

  budget_amount: number | null
  budget_currency: string | null

  status: GoalStatus
  verdict: GoalVerdict | null
  verdict_at: string | null
  verdict_summary: string | null

  fde_reasoning: string | null
  is_beta: boolean

  /** A2.1 — auto-fetched current value (cron or manual trigger) */
  current_value: number | null
  /** ISO timestamp of last auto-fetch */
  current_value_fetched_at: string | null
  /**
   * Source label. UI checks .startsWith('auto.') to know it came from a machine.
   *   - 'auto.cron': written by scheduled refresh cron
   *   - 'auto.<source>': written by UI fetch button — source matches the real
   *     underlying data source (ga4_organic_sessions / ga4_conversions /
   *     gsc_brand_clicks / dataforseo_keyword_volume / ai_visibility_top3)
   *   - 'auto.manual': legacy fallback for unknown shapes
   *   - 'self_report': FDE / PM manually typed in a value
   *   - null: never fetched yet
   */
  current_value_source: string | null

  created_at: string
  updated_at: string
  created_by: string | null
}

export interface SupportingMetric {
  key: string
  label: string
  unit?: string
  baseline?: number
  target?: number
}

export interface InitiativeRow {
  id: string
  goal_id: string
  client_id: string

  initiative_type: InitiativeType
  tier: InitiativeTier
  title: string
  posture: InitiativePosture | null

  budget_percent: number | null
  budget_amount: number | null

  hypothesis: string | null
  hypothesis_polished_by_ai: boolean

  supports_initiative_id: string | null

  /** Phase 33: Campaign UUIDs linked to this initiative. */
  campaign_ids: string[]

  is_archived: boolean
  sort_order: number

  created_at: string
  updated_at: string
}

// ─── Metric catalog: recommended primary metrics per intent ──────────────────

export interface MetricCandidate {
  key: string
  label_en: string
  label_zh: string
  unit: string
  measurement: 'auto' | 'self_report' | 'hybrid'
  recommended_for: GoalIntent[]
  /** Phase 32: optional filter by sub-type (if absent, applies to all sub-types). */
  recommended_for_sub_types?: GoalSubType[]
  /** Phase 32: default direction for this metric (increase by default). */
  default_direction?: TargetDirection
  note?: string
}

export const PRIMARY_METRIC_CATALOG: MetricCandidate[] = [
  // ── Acquisition: ongoing ─────────────────────────────────────────────────
  { key: 'leads_count', label_en: 'New leads / inquiries', label_zh: '新增线索/询盘',
    unit: 'count/mo', measurement: 'hybrid',
    recommended_for: ['acquisition'],
    recommended_for_sub_types: ['ongoing', 'event_driven'],
    default_direction: 'increase',
    note: 'GA4 form + 客户自报电话/微信咨询' },
  { key: 'form_submissions', label_en: 'GA4 form submissions', label_zh: 'GA4 表单提交',
    unit: 'count/mo', measurement: 'auto',
    recommended_for: ['acquisition'],
    recommended_for_sub_types: ['ongoing', 'event_driven'],
    default_direction: 'increase' },
  { key: 'phone_calls', label_en: 'Phone calls in', label_zh: '电话呼入',
    unit: 'count/mo', measurement: 'self_report',
    recommended_for: ['acquisition'],
    recommended_for_sub_types: ['ongoing', 'event_driven'],
    default_direction: 'increase' },

  // ── Sales: ongoing_revenue ───────────────────────────────────────────────
  { key: 'monthly_revenue', label_en: 'Monthly revenue', label_zh: '月营收',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['ongoing_revenue'],
    default_direction: 'increase',
    note: '客户每月填粗值，季度对账（签字流程留 Phase 33+）' },
  { key: 'orders_count', label_en: 'Order count', label_zh: '订单数',
    unit: 'count/mo', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['ongoing_revenue'],
    default_direction: 'increase' },
  { key: 'avg_order_value', label_en: 'Average order value', label_zh: '平均客单价',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['ongoing_revenue', 'conversion_lift'],
    default_direction: 'increase' },
  { key: 'contract_value_signed', label_en: 'Contract value signed', label_zh: '签约合同总额',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['ongoing_revenue', 'product_launch'],
    default_direction: 'increase',
    note: 'B2B/房产适用' },

  // ── Sales: inventory_clearance (P32 NEW) ─────────────────────────────────
  { key: 'inventory_units_remaining', label_en: 'Inventory units remaining', label_zh: '剩余库存件数',
    unit: 'units', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['inventory_clearance'],
    default_direction: 'decrease',
    note: '清仓型 Goal — 库存往下走（baseline=起始库存，target=0 或剩余底线）' },
  { key: 'inventory_value_remaining', label_en: 'Inventory $ value remaining', label_zh: '剩余库存金额',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['inventory_clearance'],
    default_direction: 'decrease' },

  // ── Sales: product_launch (P32 NEW) ──────────────────────────────────────
  { key: 'signups_count', label_en: 'Sign-ups / bookings', label_zh: '报名/预订数',
    unit: 'count', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['product_launch'],
    default_direction: 'increase',
    note: '产品发布或团报名 — baseline=0, target=招满人数' },
  { key: 'pre_orders_count', label_en: 'Pre-orders', label_zh: '预售单数',
    unit: 'count', measurement: 'self_report',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['product_launch'],
    default_direction: 'increase' },

  // ── Sales: conversion_lift (P32 NEW) ─────────────────────────────────────
  { key: 'conversion_rate', label_en: 'Conversion rate %', label_zh: '转化率 %',
    unit: '%', measurement: 'auto',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['conversion_lift'],
    default_direction: 'increase',
    note: 'GA4 add-to-cart / checkout / form 转化率' },
  { key: 'cart_abandonment_rate', label_en: 'Cart abandonment %', label_zh: '购物车放弃率 %',
    unit: '%', measurement: 'auto',
    recommended_for: ['sales'],
    recommended_for_sub_types: ['conversion_lift'],
    default_direction: 'decrease',
    note: '电商专用 — 放弃率往下走' },

  // ── Awareness ────────────────────────────────────────────────────────────
  { key: 'brand_search_volume', label_en: 'Brand keyword search volume', label_zh: '品牌词搜索量',
    unit: 'searches/mo', measurement: 'auto',
    recommended_for: ['awareness'],
    default_direction: 'increase' },
  { key: 'media_mentions', label_en: 'Media mentions', label_zh: '媒体提及次数',
    unit: 'count/mo', measurement: 'hybrid',
    recommended_for: ['awareness'],
    recommended_for_sub_types: ['new_market', 'event_campaign', 'reputation_recovery'],
    default_direction: 'increase',
    note: '车企/博览会类适用' },
  { key: 'ai_visibility_score', label_en: 'AI visibility score', label_zh: 'AI 可见度分',
    unit: 'score 0-100', measurement: 'auto',
    recommended_for: ['awareness'],
    default_direction: 'increase' },
  { key: 'social_followers_growth', label_en: 'Social followers growth', label_zh: '社媒粉丝增量',
    unit: 'count/mo', measurement: 'auto',
    recommended_for: ['awareness'],
    default_direction: 'increase' },
  { key: 'organic_traffic', label_en: 'Organic traffic', label_zh: '自然流量',
    unit: 'sessions/mo', measurement: 'auto',
    recommended_for: ['awareness', 'acquisition'],
    default_direction: 'increase' },
]

/**
 * Filter PRIMARY_METRIC_CATALOG by (intent, sub_type).
 * Falls back to intent-level filter when sub_type-specific metrics are empty.
 */
export function getRecommendedMetrics(
  intent: GoalIntent,
  subType: GoalSubType | null,
): MetricCandidate[] {
  if (!subType) {
    return PRIMARY_METRIC_CATALOG.filter(m => m.recommended_for.includes(intent))
  }
  // Try sub-type-specific first
  const specific = PRIMARY_METRIC_CATALOG.filter(m =>
    m.recommended_for.includes(intent) &&
    m.recommended_for_sub_types?.includes(subType),
  )
  if (specific.length > 0) return specific
  // Fallback: intent-level
  return PRIMARY_METRIC_CATALOG.filter(m => m.recommended_for.includes(intent))
}

// ─── Utility types for API ────────────────────────────────────────────────────

export interface CreateGoalInput {
  intent: GoalIntent
  /** Phase 32: per-intent sub-type (sales: clearance/launch/...; awareness: new_market/...) */
  sub_type?: GoalSubType
  awareness_subtype?: AwarenessSubtype  // deprecated alias kept for back-compat
  title: string
  primary_metric_key: string
  primary_metric_label: string
  primary_metric_unit?: string
  baseline_value: number
  target_value: number
  /** Phase 32: 'decrease' for clearance / churn reduction. Defaults to 'increase'. */
  target_direction?: TargetDirection
  supporting_metrics?: SupportingMetric[]
  period_start: string
  period_end: string
  budget_amount?: number
  budget_currency?: string
  fde_reasoning?: string
}

export interface CreateInitiativeInput {
  goal_id: string
  initiative_type: InitiativeType
  title: string
  posture?: InitiativePosture
  budget_percent?: number
  hypothesis?: string
  supports_initiative_id?: string
  sort_order?: number
}

/** Phase 33: marketing_plans row with optional initiative link */
export interface MarketingPlanLite {
  id: string
  title: string
  status: string
  start_date: string | null
  end_date: string | null
  initiative_id: string | null
}

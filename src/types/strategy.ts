/**
 * Phase 31 Strategy Layer — TypeScript types
 *
 * Mirrors the Supabase schema in:
 *   supabase/migrations/20260619000001_phase31_strategy_layer_foundation.sql
 *
 * Three-layer model:
 *   GOAL (1 active per client)
 *      ↓
 *   INITIATIVES (multiple, terminal/supporting)
 *      ↓
 *   ACTIONS (execution_items.initiative_id)
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type GoalIntent = 'acquisition' | 'sales' | 'awareness'

export type AwarenessSubtype =
  | 'new_market'
  | 'event_campaign'
  | 'geographic_expansion'
  | 'reputation_recovery'

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
  title: string

  primary_metric_key: string
  primary_metric_label: string
  primary_metric_unit: string | null
  baseline_value: number
  target_value: number

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
  note?: string
}

export const PRIMARY_METRIC_CATALOG: MetricCandidate[] = [
  // Acquisition
  { key: 'leads_count', label_en: 'New leads / inquiries', label_zh: '新增线索/询盘',
    unit: 'count/mo', measurement: 'hybrid',
    recommended_for: ['acquisition'],
    note: 'GA4 form + 客户自报电话/微信咨询' },
  { key: 'form_submissions', label_en: 'GA4 form submissions', label_zh: 'GA4 表单提交',
    unit: 'count/mo', measurement: 'auto',
    recommended_for: ['acquisition'] },
  { key: 'phone_calls', label_en: 'Phone calls in', label_zh: '电话呼入',
    unit: 'count/mo', measurement: 'self_report',
    recommended_for: ['acquisition'] },

  // Sales
  { key: 'monthly_revenue', label_en: 'Monthly revenue', label_zh: '月营收',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'],
    note: '客户每月填粗值，季度对账（签字流程 Phase 32 补）' },
  { key: 'orders_count', label_en: 'Order count', label_zh: '订单数',
    unit: 'count/mo', measurement: 'self_report',
    recommended_for: ['sales'] },
  { key: 'avg_order_value', label_en: 'Average order value', label_zh: '平均客单价',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'] },
  { key: 'contract_value_signed', label_en: 'Contract value signed', label_zh: '签约合同总额',
    unit: 'AUD/NZD', measurement: 'self_report',
    recommended_for: ['sales'], note: 'B2B/房产适用' },

  // Awareness
  { key: 'brand_search_volume', label_en: 'Brand keyword search volume', label_zh: '品牌词搜索量',
    unit: 'searches/mo', measurement: 'auto',
    recommended_for: ['awareness'] },
  { key: 'media_mentions', label_en: 'Media mentions', label_zh: '媒体提及次数',
    unit: 'count/mo', measurement: 'hybrid',
    recommended_for: ['awareness'], note: '车企/博览会类适用' },
  { key: 'ai_visibility_score', label_en: 'AI visibility score', label_zh: 'AI 可见度分',
    unit: 'score 0-100', measurement: 'auto',
    recommended_for: ['awareness'] },
  { key: 'social_followers_growth', label_en: 'Social followers growth', label_zh: '社媒粉丝增量',
    unit: 'count/mo', measurement: 'auto',
    recommended_for: ['awareness'] },
  { key: 'organic_traffic', label_en: 'Organic traffic', label_zh: '自然流量',
    unit: 'sessions/mo', measurement: 'auto',
    recommended_for: ['awareness', 'acquisition'] },
]

// ─── Utility types for API ────────────────────────────────────────────────────

export interface CreateGoalInput {
  intent: GoalIntent
  awareness_subtype?: AwarenessSubtype
  title: string
  primary_metric_key: string
  primary_metric_label: string
  primary_metric_unit?: string
  baseline_value: number
  target_value: number
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

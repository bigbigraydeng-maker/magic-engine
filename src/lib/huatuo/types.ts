/**
 * 华佗 Hua Tuo — Prescription Agent Types
 *
 * Reference: ROADMAP.md P8.10.S3
 *
 * 华佗是 Magic Engine 的第二代理（继张骞之后）：
 * - 张骞负责"看到现状"（Discovery）
 * - 华佗负责"开出处方"（Prescription）— FDE 团队据此执行
 *
 * 设计原则：思路清晰（多步可审计）、丰富经验（基准库+案例库）、结果导向（FDE-ready 字段）。
 */

import type { PrescriptionContent } from '@/types/diagnostic'
import type { SeasonalCalendarData } from './seasonal-calendar'
import type { GTrendsInterestSummary } from '@/lib/gtrends/client'

// ─── Industry Benchmark ────────────────────────────────────────────────────────

export type BenchmarkDimension = 'seo' | 'social' | 'reputation' | 'ai_visibility'
export type BusinessSize = 'small' | 'medium' | 'large'
export type BenchmarkMarket = 'AU' | 'NZ' | 'AU_NZ'

export interface IndustryBenchmarkRow {
  id: string
  industry_category: string
  business_size: BusinessSize
  market: BenchmarkMarket
  dimension: BenchmarkDimension

  score_p50: number | null
  score_p75: number | null
  score_p90: number | null

  realistic_3mo_growth_pct: number | null
  realistic_6mo_growth_pct: number | null
  typical_monthly_budget_aud: number | null

  source: string | null
  source_url: string | null
  confidence: number       // 0–1
  sample_size: number | null
  notes: string | null
}

// ─── Self-Grade (multi-dimensional 0–10 score) ─────────────────────────────────

export interface SelfGradeBreakdown {
  /** 现实性 — target_value 是否落在基准 P50–P90 区间 */
  realism: number
  /** 完整性 — 是否覆盖所有 critical/high 维度 */
  completeness: number
  /** FDE 可执行性 — 每个 action 是否有 hours/skills/measurement */
  fde_actionability: number
  /** ROI 合理性 — 投入产出比是否匹配预算 */
  roi_alignment: number
  /** 优先级排序 — phase 1/2/3 划分是否合理 */
  prioritization: number
  /** 资源匹配 — 是否匹配客户预算与团队能力 */
  resource_match: number
  /** 创新性 — 是否有针对性的非通用建议 */
  innovation: number
}

/** 七维度的英文键 — 用作薄弱点的 dimension 标签 */
export type SelfGradeDimension = keyof SelfGradeBreakdown

export type WeaknessSeverity = 'high' | 'medium' | 'low'

/**
 * 结构化薄弱点 — 注意：这是「处方（方案）的薄弱」，不是「企业的薄弱」。
 * 即华佗对自己开出的处方的自我质检，不是对客户的诊断。
 */
export interface SelfGradeWeakness {
  /** 归属哪个评分维度（与 SelfGradeBreakdown 的键一一对应） */
  dimension: SelfGradeDimension
  /** 严重程度 */
  severity: WeaknessSeverity
  /** 中文描述，需具体到 action id / KPI 字段 */
  text: string
}

export interface SelfGrade {
  /** 0–10 总分（七维加权平均） */
  overall: number
  dimensions: SelfGradeBreakdown
  /** 处方（方案）的待改进项 — 结构化，每条挂在某个维度下 */
  weaknesses: SelfGradeWeakness[]
  /** 如果是 refine pass，列出针对 weaknesses 做的具体调整 */
  improvements_made: string[]
}

// ─── Hua Tuo Prescription Output ───────────────────────────────────────────────

/**
 * 华佗在 PrescriptionContent 之上叠加自评 + 元数据。
 * 注意：content 内的 actions/kpi_targets 已经包含 P8.10.S3 扩展字段
 * （estimated_hours / required_skills / measurement_method / realism_confidence）。
 */
export interface HuatuoPrescriptionResult {
  content: PrescriptionContent
  self_grade: SelfGrade
  benchmarks_used: string[]      // industry_benchmarks.id 列表
  meta: HuatuoGenerationMeta
  /** P8.10.S3.2: 让前端能展示"基于真实历史"的趋势卡 */
  trend_summary: TrendSummaryLite | null
}

export interface HuatuoGenerationMeta {
  agent_version: string
  passes: number                   // 1 = 一次过；2 = 经过 refine
  total_input_tokens: number
  total_output_tokens: number
  cost_usd: number
  duration_ms: number
  industry_category_used: string | null   // 映射后的行业代码
}

// ─── Lookup payload (passed into agent) ────────────────────────────────────────

export interface HuatuoLookupContext {
  /** 行业基准（按 dimension 聚合） */
  benchmarks: Record<BenchmarkDimension, IndustryBenchmarkRow | null>
  /** 映射后的行业代码（null 表示没匹配到，会用通用基准） */
  industry_category: string | null
  /** SEMrush 历史趋势摘要（P8.10.S3.2 接入；null 表示无数据） */
  trend_summary?: TrendSummaryLite | null
  /** AU/NZ 季节营销日历（P8.12.S1.3 接入；null 表示无数据） */
  seasonal_calendar?: SeasonalCalendarData | null
  /** 行业搜索热度趋势（Google Trends，P8.12.S1.5 接入；null 表示无数据） */
  industry_interest?: GTrendsInterestSummary | null
}

/**
 * Minimal trend summary shape consumed by huatuo agent + prompts.
 * (Full implementation in src/lib/huatuo/trends.ts to avoid circular deps.)
 */
export interface TrendSummaryLite {
  has_data: boolean
  latest: { month: string; organic_traffic: number; organic_keywords: number } | null
  earliest: { month: string; organic_traffic: number; organic_keywords: number } | null
  growth_pct_3m: number | null
  growth_pct_6m: number | null
  growth_pct_12m: number | null
  trajectory: 'rising' | 'flat' | 'declining' | 'no_data'
  monthly_avg_traffic: number | null
  data_points: number
}

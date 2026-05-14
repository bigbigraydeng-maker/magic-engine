/**
 * Case Library — TypeScript types mirroring the P8.12.S2.1 schema.
 *
 * Reference: supabase/migrations/20260514000004_case_library.sql
 *
 * 三张表构成「数据飞轮」地基，让系统能从历史客户学习：
 *   - PrescriptionCase    — 可检索的「张骞→华佗」服务快照
 *   - PrescriptionOutcome — 处方 KPI 30/60/90 天实测值回流
 *   - LocalDataCache      — 本地 connector 结果缓存
 */

/** prescription_cases.market — 目标市场（AU/NZ）。 */
export type CaseMarket = 'AU' | 'NZ'

/** prescription_outcomes.data_source — KPI 实测值来源。 */
export type OutcomeDataSource = 'semrush_auto' | 'manual_fde'

/**
 * prescription_cases 行 — 一次完整「张骞发现 → 华佗处方」服务的可检索快照。
 * 三个 *_id 均为 NOT NULL FK（ON DELETE CASCADE）。
 */
export interface PrescriptionCase {
  id: string
  client_id: string
  discovery_id: string
  prescription_id: string
  industry_category: string | null
  crisis_type: string | null
  monthly_budget_aud: number | null
  market: CaseMarket | null
  business_size: string | null
  prescription_summary: string | null
  self_grade_overall: number | null
  created_at: string
}

/**
 * prescription_outcomes 行 — 处方批准后某个 KPI 的一次实测记录。
 * 效果反馈闭环：semrush_auto 由 cron 回填，manual_fde 由 FDE 录入。
 */
export interface PrescriptionOutcome {
  id: string
  prescription_id: string
  case_id: string
  client_id: string
  kpi_metric: string
  target_value: number | null
  actual_value: number | null
  unit: string | null
  dimension: string | null
  measured_at: string
  days_since_approval: number | null
  data_source: OutcomeDataSource | null
  created_at: string
}

/**
 * local_data_cache 行 — 本地 connector 结果缓存。
 * payload 形态由各 connector 自行约定（缓存层不做 schema 约束）。
 */
export interface LocalDataCache {
  id: string
  cache_key: string
  connector: string
  market: string | null
  payload: Record<string, unknown>
  fetched_at: string
  expires_at: string
}

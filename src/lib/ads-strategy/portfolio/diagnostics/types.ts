/**
 * 广告只读诊断 · 类型契约（ads IMPACT 阶段 1，设计 §3.3 + §14 M4–M9）。
 *
 * 🔴 全部只读：诊断只产出结论与证据，不产出任何对 Meta 的写入、不产出预算处方。
 * 🔴 每条结论带证据与样本量；判不了就是 not_comparable，并写明为什么判不了。
 * 🔴 平台共享：不许出现客户名、客户 ID、行业判断；数字门槛是平台默认参数（见 thresholds.ts）。
 *
 * D2（按角色的疲劳模型）、D6（行业先验）本阶段不实现，只保留代码位。
 */

import type { EntitySnapshotRow } from '../snapshot'
import type { Confidence, FunnelRole } from '../roles'
import type { OutcomeConfig } from '../outcome-ladder'

export type DiagnosisCode = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9'
export type DiagnosisStatus = 'hit' | 'not_comparable'

export type NotComparableReason =
  | 'no_hourly_data'
  | 'night_trough'
  | 'scheduled_delivery'
  | 'report_lag'
  | 'target_cost_not_configured'
  | 'outcome_not_configured'
  | 'primary_result_unknown'
  | 'primary_not_attributable'
  | 'audience_below_floor'
  | 'audience_too_new'
  | 'page_audience_unverifiable'
  | 'no_video_creatives'
  | 'missing_data'
  | 'cbo_internal'
  | 'shared_account'
  | 'below_min_sample'
  | 'single_unit'

export interface DiagnosisUnit {
  level: 'account' | 'campaign' | 'adset'
  id: string
  name: string | null
  adAccountId: string
  role?: FunnelRole
  roleConfidence?: Confidence
}

/** 样本量：数字必须跟它的样本量一起出现（「$27.83 · 基于 1 次对话」）。 */
export interface SampleSize {
  label: string
  value: number
}

/** 下发给人的任务三件套（D7 用；D 系列只读，发现授权/数据问题不自动修）。 */
export interface ManualTask {
  what: string
  how: string
  href: string | null
}

export interface Diagnosis {
  code: DiagnosisCode
  status: DiagnosisStatus
  /** 内部日报用的一句话（中文、人话） */
  title: string
  units: DiagnosisUnit[]
  evidence: Record<string, string | number | boolean | null>
  sample: SampleSize[]
  reasons: string[]
  notComparableReason?: NotComparableReason
  /** §14 C6：D1、D3 未来可给客户看（须带处理状态）；D7、D8 永不进客户版。阶段 1 只发内部。 */
  clientVisible: boolean
  manualTask?: ManualTask
}

/** ad_daily_insights 一行（诊断需要的列）。 */
export interface DailyRow {
  level: 'campaign' | 'adset' | 'ad'
  entity_id: string
  parent_id: string | null
  insight_date: string
  spend: number
  impressions: number
  reach: number | null
  clicks: number
  leads: number
  messaging_conversations: number
  video_thruplays: number | null
  actions: ReadonlyArray<{ action_type: string; value: string }> | null
}

/** 某天某小时（账户时区）某广告组的花费。不入库，只在 D1 预筛命中后按需拉。 */
export interface HourlyRow {
  adset_id: string | null
  campaign_id: string | null
  hour: number
  spend: number
}

export interface CaptureCoverage {
  level: string
  complete: boolean
  skipped_shared: boolean
  error: string | null
  captured_at: string
}

export interface AccountInput {
  adAccountId: string
  /** 同一账户登记给多个客户（§14 M9）→ 只做账户级诊断 */
  shared: boolean
  timezone: string | null
  currency: string | null
  /** 评估日结束时（账户时区）每个实体的最新设置，不含 disappeared 行 */
  snapshots: EntitySnapshotRow[]
  /** 近 28 天（含评估日）的日数据，campaign / adset 两级 */
  daily: DailyRow[]
  /** 按天（YYYY-MM-DD）给的小时花费；没拉 / 拉失败则缺该天 */
  hourly: Record<string, HourlyRow[]>
  hourlyError: string | null
  /** 最近一轮快照抓取情况（D7） */
  latestCaptures: CaptureCoverage[]
  /** 这个账户在 ad_daily_insights 里最后一天有数据的日期（D7） */
  lastInsightDate: string | null
}

export interface DiagnosisInput {
  clientId: string
  /** 评估日（账户时区的完整一天） */
  date: string
  evaluatedAt: string
  outcome: OutcomeConfig
  outcomeConfigured: boolean
  /** #1299 企业验证通过、私信 Webhook 真正收到来源之前一律 false（§14 M2） */
  messagingReferralAvailable: boolean
  /** 日报收件人（D7 查是否含客户邮箱） */
  digestRecipients: string[]
  accounts: AccountInput[]
}

export interface ExcludedEntity {
  adAccountId: string
  level: 'campaign' | 'adset' | 'account'
  id: string
  name: string | null
  reason: 'meta_experiment' | 'shared_account'
  detail: string
}

export interface DiagnosisRun {
  clientId: string
  date: string
  evaluatedAt: string
  diagnoses: Diagnosis[]
  excluded: ExcludedEntity[]
}

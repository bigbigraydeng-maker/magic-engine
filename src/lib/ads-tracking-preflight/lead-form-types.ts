/**
 * 表单留资盯盘和「只暂停」入口之间的纯数据类型。
 * 不读网络、不读库、不点名任何客户。
 */

export const STOP_FAULT_CODES = ['over_daily_cap', 'crm_leads_missing', 'ad_rejected'] as const
export type StopFaultCode = (typeof STOP_FAULT_CODES)[number]

export interface LeadFormStopFault {
  code: StopFaultCode
  /** 大白话：哪种故障、当时的数 */
  what: string
}

/** 盯盘去调只暂停入口之后记进回执的结果。paused=false 不是失败本身，要看 reason。 */
export interface PauseRequestReceipt {
  called: boolean
  paused: boolean
  reason: string
  idempotent: boolean
}

/** 只暂停入口认的请求体。字段名与 POST /api/internal/meta-ads/pause-only 一致。 */
export interface ServicePauseCall {
  client_id: string
  campaign_id: string
  campaign_name: string
  ad_account_id: string
  fault_code: string
  fault_what: string
  spend_today_cents: number | null
  spend_lifetime_cents: number | null
  currency: string
  as_of: string
  triggered_by: 'ads-tracking-launch-watch'
  idempotency_key: string
}

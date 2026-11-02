/**
 * 客户版 hourly-leads 白名单（fail-closed）。
 */

import type { HourlyLeadChart } from '@/lib/ads-strategy/hourly-meta-leads'
import type { LeadForecast } from '@/lib/ads-strategy/hourly-leads-forecast'

export interface StaffHourlyLeadsResponse {
  success: boolean
  unreadable: boolean
  message?: string
  chart?: HourlyLeadChart
  forecast?: LeadForecast | null
  lastSyncAt: string | null
  jobName?: string
}

export interface ClientHourlyLeadsView {
  viewer: 'client'
  success: boolean
  unreadable: boolean
  message?: string
  chart?: HourlyLeadChart
  forecast?: LeadForecast | null
  /** 格式化后的同步时间（不含 job 名等内部字段） */
  lastSyncLabel: string | null
}

function formatSyncLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function toClientHourlyLeadsView(raw: StaffHourlyLeadsResponse): ClientHourlyLeadsView {
  return {
    viewer: 'client',
    success: raw.success,
    unreadable: raw.unreadable,
    message: raw.message,
    chart: raw.chart,
    forecast: raw.forecast ?? null,
    lastSyncLabel: formatSyncLabel(raw.lastSyncAt),
  }
}

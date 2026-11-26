'use client'
import type { ReactNode } from 'react'

export type DistributorStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type DistributorLevel = 'standard' | 'tier1' | 'premier' | null

export interface Distributor {
  id: string
  parent_id: string | null
  display_name: string
  contact_email: string | null
  contact_phone: string | null
  status: DistributorStatus
  approved_by: string | null
  approved_at: string | null
  referral_code: string | null
  source: 'admin' | 'application'
  region: string | null
  application_note: string | null
  created_at: string
  level: DistributorLevel
  parent_name: string | null
  net_sales_cents: number
}

export interface Sale {
  id: string
  distributor_id: string
  kind: 'plan' | 'addon' | 'refund'
  order_ref: string
  plan_code: string | null
  months: number | null
  extra_avatars: number
  amount_cents: number
  currency: string
  paid_at: string
  is_self_purchase: boolean
  refund_of_sale_id: string | null
  recorded_by: string
  created_at: string
}

export interface CatalogPlan {
  code: string
  videosPerMonth: number
  monthlyCents: number
}

export interface Catalog {
  plans: CatalogPlan[]
  includedAvatars: number
  extraAvatarOneTimeCents: number
}

export interface ApiError {
  error?: string
  details?: string[]
}

export const LEVEL_LABELS: Record<NonNullable<DistributorLevel>, string> = {
  standard: '普通',
  tier1: '一级',
  premier: '特级',
}

export const STATUS_LABELS: Record<DistributorStatus, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  suspended: '已停用',
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
}

export function todayString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
}

/** New Zealand UTC offset (e.g. "+13:00" in summer, "+12:00" in winter) at noon of the given date. */
export function nzOffset(date: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Auckland', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T00:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+12:00'
  return name.replace('GMT', '') || '+00:00'
}

/** Today → the current moment (never "in the future"); a past date → noon New Zealand time that day. */
export function toPaidAt(date: string): string {
  if (date === todayString()) return new Date().toISOString()
  return `${date}T12:00:00${nzOffset(date)}`
}

export function parseDollarsToCents(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

export function errorText(err: ApiError | null): string {
  if (!err) return ''
  const parts: string[] = []
  if (err.error) parts.push(err.error)
  if (err.details && err.details.length > 0) parts.push(err.details.join('；'))
  return parts.join('；')
}

export async function postJson<T>(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data: T | null; err: ApiError | null }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json: unknown = await res.json()
    if (res.ok) {
      return { ok: true, data: json as T, err: null }
    }
    return { ok: false, data: null, err: json as ApiError }
  } catch {
    return { ok: false, data: null, err: { error: '请求失败' } }
  }
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="mb-4 rounded-2xl bg-[#C2453A]/10 px-4 py-3 text-sm font-medium text-[#C2453A]">
      {message}
    </div>
  )
}

export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <div className="h-3 w-20 animate-pulse rounded bg-me-charcoal/10" />
        </td>
      ))}
    </tr>
  )
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-8 overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="border-b border-black/[0.06] px-6 py-4">
        <h2 className="text-base font-bold text-me-charcoal/90">{title}</h2>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

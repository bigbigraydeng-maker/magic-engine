/**
 * Pure formatting helpers for the read-only "sales progress" table.
 * No IO, no hooks, no React: safe to unit-test directly and to call
 * from server components. All user-facing strings are Simplified Chinese.
 */

import type { SalesBooking, UnitProgress } from '@/lib/crm/sales-progress/types'

export function formatRemaining(row: UnitProgress): string {
  if (row.remaining === null) return '上限未设置'
  if (row.remaining < 0) return `超订 ${-row.remaining} 人`
  return `${row.remaining} 人`
}

export function formatCapacity(row: UnitProgress): string {
  if (row.unit.capacity === null) return '上限未设置'
  return `上限 ${row.unit.capacity} 人`
}

export function originLabel(kind: SalesBooking['originKind']): string {
  if (kind === 'company_confirmed') return '公司确认'
  if (kind === 'customer_stated') return '客人自述'
  if (kind === 'staff_entered') return '销售手填'
  return '来源未标'
}

export function formatGeneratedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '未知时间'
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date)
}

export function rowNotes(row: UnitProgress): string[] {
  const notes: string[] = []
  if (row.overBy > 0) {
    notes.push(`超订 ${row.overBy} 人（系统不会拦截，请销售自行把关）`)
  }
  if (row.unfilledOrders > 0) {
    notes.push(`另有 ${row.unfilledOrders} 单人数未填，剩余可能更少`)
  }
  if (row.unattributedPeople > 0) {
    notes.push(`另有 ${row.unattributedPeople} 人未归属出发日，剩余可能更少`)
  }
  if (row.unit.capacityNote) {
    notes.push(row.unit.capacityNote)
  }
  return notes
}

export function invoiceText(b: SalesBooking): string {
  if (b.evidenceRef) return `发票 ${b.evidenceRef}`
  return '无发票号'
}

export function peopleText(b: SalesBooking): string {
  if (b.partySize === null) return '人数未填'
  return `${b.partySize} 人`
}

/** A small note when the source marks the unit sold out / limited, so the number is read together with it. */
export function statusText(unit: UnitProgress['unit']): string | null {
  if (unit.unitStatus === 'sold_out') return '团目录已标售罄'
  if (unit.unitStatus === 'limited') return '团目录标注名额紧张'
  return null
}

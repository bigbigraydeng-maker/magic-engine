/**
 * Plain-Chinese wording for the 付款总览 page.
 *
 * The warning sentences repeat the ones the booking screens already show
 * (booking-view.ts), without the per-order details, so staff see one wording everywhere.
 * Nothing here formats money: the tracker stores none.
 */

import type { BookingWarningCode } from '@/lib/crm/booking-types'
import type { OverviewGroup, OverviewMilestoneCell } from '@/lib/crm/booking-overview-types'
import { shortDate } from '../../_components/bookings/booking-format'

export const PAGE_HEADING = '收款进度（按订单数统计，系统不记金额）'

export function unitLabel(n: number): string {
  return `${n}单`
}

const WARNING_TEXT: Partial<Record<BookingWarningCode, string>> = {
  tour_missing: '团目录里已找不到这个团',
  departure_missing: '目录里已找不到这个出发日期',
  departure_changed: '出发日变了，请确认',
  departure_cancelled: '这个出发日期已取消',
}

export function warningText(code: BookingWarningCode): string | null {
  return WARNING_TEXT[code] ?? null
}

const STAGE_TEXT: Record<string, string> = {
  deposit_paid: '已付定金',
  paid_full: '已付全款',
  traveling_soon: '即将出行',
}

export function stageText(stage: string): string {
  return STAGE_TEXT[stage] ?? '已付款'
}

/** The title line of a summary row: tour name and date, or the two special groups. */
export function groupTitle(group: OverviewGroup): { tour: string; date: string } {
  if (group.kind === 'undecided') return { tour: '出发日期还没定', date: '' }
  const tour = group.tourName ?? '（团目录里已找不到这个团）'
  if (group.kind === 'unknown_date') return { tour, date: '日期不明的出发' }
  return { tour, date: `${group.departOn ?? '（未定）'} 出发` }
}

/** 「未收齐」 cell: 4单（1单已过期）. */
export function unsettledText(unsettled: number, overdue: number): string {
  return overdue > 0 ? `${unitLabel(unsettled)}（${unitLabel(overdue)}已过期）` : unitLabel(unsettled)
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** One payment item in the list: paid date, overdue by N days, due date, or the reason there is none. */
export function milestoneCellText(cell: OverviewMilestoneCell | null, today: string): string {
  if (cell === null) return '—'
  const quiet = cell.quiet && cell.state === 'unpaid' ? ' · 线下已处理' : ''
  if (cell.state === 'paid') return `✅ ${shortDate(cell.paidOn)}`
  if (cell.dueOn === null) return `⬜ ${cell.dueNote ?? '到期日还没算出来'}${quiet}`
  if (cell.overdue) {
    const days = daysBetween(cell.dueOn, today)
    return `⬜ 已过期${days !== null && days > 0 ? `${days}天` : ''}${quiet}`
  }
  return `⬜ 到期 ${shortDate(cell.dueOn)}${quiet}`
}

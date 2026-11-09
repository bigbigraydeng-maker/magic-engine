import type { BookingView, MilestoneView } from '@/lib/crm/booking-types'

/** Format an ISO date as '10月08日', or '（未定）' when null or malformed. */
export function shortDate(iso: string | null): string {
  if (iso === null || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '（未定）'
  const month = Number(iso.slice(5, 7))
  const day = iso.slice(8, 10)
  return `${month}月${day}日`
}

/** Return today's date in Pacific/Auckland as YYYY-MM-DD. */
export function nzToday(now?: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now ?? new Date())
}

/** Describe a due date as a relative countdown for the booking detail view. */
export function dueRelative(dueInDays: number | null): string {
  if (dueInDays === null) return ''
  if (dueInDays > 0) return `还有 ${dueInDays} 天`
  if (dueInDays === 0) return '今天到期'
  return `已逾期 ${-dueInDays} 天`
}

/** Describe a due date as a relative countdown for the reminder list. */
export function nudgeRelative(dueInDays: number | null): string {
  if (dueInDays === null) return ''
  if (dueInDays > 0) return `${dueInDays} 天后到期`
  if (dueInDays === 0) return '今天到期'
  return `已逾期 ${-dueInDays} 天`
}

/** Summarise one payment item's state in plain Chinese. */
export function milestoneStatusText(m: MilestoneView): string {
  if (m.state === 'paid') return `✅ 已收 ${m.paidOn ?? '（未定）'}`
  if (m.dueOn !== null) return `未收到 · 到期 ${m.dueOn}（${dueRelative(m.dueInDays)}）`
  return `未收到 · ${m.dueNote ?? '到期日还没算出来'}`
}

/** Build the one-line heading for a booking card. */
export function bookingTitle(b: BookingView): string {
  const name = b.tourName ?? '（团目录里已找不到这个团）'
  return b.departOn ? `${name} · ${b.departOn} 出发` : `${name} · 出发日期未定`
}

/** True when the booking has at least one payment item and all of them are paid. */
export function isFullyPaid(b: BookingView): boolean {
  return b.milestones.length > 0 && b.milestones.every((m) => m.state === 'paid')
}

/** Format a catalog date range as '2026-10-08 出发（2026-10-15 回）'. */
export function departureLabel(departOn: string, returnOn: string | null): string {
  return returnOn ? `${departOn} 出发（${returnOn} 回）` : `${departOn} 出发`
}

/** Return a short Chinese note for a catalog date's availability status. */
export function departureStatusNote(status: string): string {
  if (status === 'sold_out') return '（已满）'
  if (status === 'limited') return '（少量名额）'
  return ''
}

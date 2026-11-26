/**
 * 读订单：把「有效 + 已付定金」的订单整理成批次计划要的事实（只读，不写；不碰邮箱，不碰订单备注）。
 *
 * 口径与 src/lib/crm/sales-progress/deposited-seats.ts 一致：订单有效（不是已取消）+ 定金已付。
 * 出发日以目录里「现在的」出发日为准（销售改过日期，信要跟着走），目录里没有才用订单上存的那份。
 * 读不出出发日、或出发日已取消的订单不进任何一封信，但会在 notices 里告诉员工有几张——
 * 不能悄悄少算收件人。
 *
 * 复用：订单 / 付款里程碑 / 联系人姓名走 booking-overview-reads（已有、已测）；团名和出发日走
 * tour-catalog/booking-facts（目录数据只许从那里读）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listBookingsForOverview,
  listContactNamesForClient,
  listMilestonesForClient,
} from '@/lib/crm/booking-overview-reads'
import type { BookingRow } from '@/lib/crm/booking-types'
import { cleanDisplayName } from '@/lib/crm/clean-display-name'
import { loadBookingDepartureFacts, loadBookingTourFacts } from '@/lib/tour-catalog/booking-facts'
import { toDayNumber } from './dates'
import type { BookingFact, NzDate } from './types'

/** 目录里找不到这个团时用的名字（不丢收件人，也不编团名）。 */
export const UNKNOWN_TOUR_NAME = '（团名未找到）'

export interface BookingFacts {
  facts: BookingFact[]
  /** 给员工看的提醒（中文人话）：哪些订单没排进信里、为什么。 */
  notices: string[]
}

type DepartureOutcome = { kind: 'ok'; departOn: NzDate } | { kind: 'cancelled' } | { kind: 'missing' }

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function departureOutcome(
  booking: BookingRow,
  departures: ReadonlyMap<string, { departOn: string; status: string }>,
): DepartureOutcome {
  const live = booking.departureId === null ? undefined : departures.get(booking.departureId)
  if (live?.status === 'cancelled') return { kind: 'cancelled' }
  const departOn = live?.departOn ?? booking.departureDepartOn
  if (departOn === null || toDayNumber(departOn) === null) return { kind: 'missing' }
  return { kind: 'ok', departOn }
}

function noticesFor(missing: number, cancelled: number): string[] {
  const notices: string[] = []
  if (missing > 0) {
    notices.push(`有 ${missing} 张已交定金的订单没有出发日（或日期不对），没排进任何一封信。请先在订单里补上出发日。`)
  }
  if (cancelled > 0) {
    notices.push(`有 ${cancelled} 张已交定金的订单，所选的出发日已经取消，没排进任何一封信。请先在订单里改成新的出发日。`)
  }
  return notices
}

async function depositPaidBookings(db: SupabaseClient, clientId: string): Promise<BookingRow[]> {
  const [bookings, milestones] = await Promise.all([
    listBookingsForOverview(db, clientId),
    listMilestonesForClient(db, clientId),
  ])
  const depositPaid = new Set(
    milestones.filter((m) => m.kind === 'deposit' && m.state === 'paid').map((m) => m.bookingId),
  )
  return bookings.filter((booking) => booking.status === 'active' && depositPaid.has(booking.id))
}

export async function loadBookingFacts(db: SupabaseClient, clientId: string): Promise<BookingFacts> {
  const paid = await depositPaidBookings(db, clientId)
  if (paid.length === 0) return { facts: [], notices: [] }

  const departureIds = paid.flatMap((booking) => (booking.departureId === null ? [] : [booking.departureId]))
  const [departures, tours, names] = await Promise.all([
    loadBookingDepartureFacts(db, clientId, departureIds),
    loadBookingTourFacts(db, clientId, unique(paid.map((booking) => booking.tourId))),
    listContactNamesForClient(db, clientId, unique(paid.map((booking) => booking.contactId))),
  ])

  const facts: BookingFact[] = []
  let missing = 0
  let cancelled = 0
  for (const booking of paid) {
    const outcome = departureOutcome(booking, departures)
    if (outcome.kind === 'missing') {
      missing += 1
    } else if (outcome.kind === 'cancelled') {
      cancelled += 1
    } else {
      facts.push({
        contactId: booking.contactId,
        displayName: cleanDisplayName(names.get(booking.contactId) ?? null),
        tourId: booking.tourId,
        tourName: tours.get(booking.tourId)?.name ?? UNKNOWN_TOUR_NAME,
        departOn: outcome.departOn,
        seats: booking.partySize,
      })
    }
  }
  return { facts, notices: noticesFor(missing, cancelled) }
}

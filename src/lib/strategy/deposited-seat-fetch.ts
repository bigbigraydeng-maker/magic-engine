/**
 * Loads deposited-seat progress for one goal.
 * Bookings and departures come from the sales-progress readers.
 * Deposit / balance state comes from crm_booking_milestones.
 * Ad source is not on the booking, so it is reported unknown.
 * Notes are not read.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { loadClientSalesBookings } from '@/lib/crm/sales-progress/load'
import { createDepartureUnitSource } from '@/lib/crm/sales-progress/units'
import {
  attachPayments,
  countDepositedSeats,
  depositCutoff,
  depositedSeatsToFetchResult,
  incrementalSeatBaseline,
  paymentsByBooking,
  type DepositedSeatCount,
  type MilestoneFact,
  type SeatDeparture,
  type SeatFetchResult,
} from '@/lib/crm/sales-progress/deposited-seats'

const MILESTONE_COLUMNS = 'booking_id, kind, state, paid_on'

export interface DepositedSeatFetchOptions {
  depositedSeatScope: readonly SeatDeparture[]
  goalPeriod?: { period_start: string; period_end: string }
  goalCreatedAt?: string | null
  baselineValue?: unknown
}

export async function fetchDepositedSeatProgress(
  db: SupabaseClient,
  clientId: string,
  options: DepositedSeatFetchOptions,
): Promise<SeatFetchResult> {
  const period = options.goalPeriod
  if (!period) {
    return { ok: false, unknown: true, reason: '统计已收定金座位需要这个目标自己的时间段' }
  }
  const baseline = incrementalSeatBaseline(options.baselineValue)
  if (!baseline.ok) return { ok: false, unknown: true, reason: baseline.reason }
  try {
    const counted = await countForClient(db, clientId, options.depositedSeatScope, period, options.goalCreatedAt)
    return depositedSeatsToFetchResult(counted, period.period_end)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, unknown: true, reason: message }
  }
}

async function countForClient(
  db: SupabaseClient,
  clientId: string,
  scope: readonly SeatDeparture[],
  period: { period_start: string; period_end: string },
  createdAt: string | null | undefined,
): Promise<DepositedSeatCount> {
  const [loaded, milestones, units] = await Promise.all([
    loadClientSalesBookings(db, clientId),
    loadMilestones(db, clientId),
    createDepartureUnitSource(db).listSalesUnits(clientId),
  ])
  const rows = attachPayments(loaded.bookings, paymentsByBooking(milestones))
  return countDepositedSeats({
    units,
    rows,
    scope,
    cutoff: depositCutoff(period.period_start, createdAt),
    periodEnd: period.period_end,
  })
}

async function loadMilestones(db: SupabaseClient, clientId: string): Promise<MilestoneFact[]> {
  const rows = await fetchAll<unknown>(
    (from, to) =>
      db
        .from('crm_booking_milestones')
        .select(MILESTONE_COLUMNS)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
  return rows.map(mapMilestone)
}

function mapMilestone(raw: unknown): MilestoneFact {
  if (typeof raw !== 'object' || raw === null) throw new Error('unmappable milestone row')
  const row = raw as Record<string, unknown>
  if (typeof row.booking_id !== 'string' || row.booking_id.length === 0) throw new Error('unmappable milestone row')
  if (typeof row.kind !== 'string' || typeof row.state !== 'string') throw new Error('unmappable milestone row')
  const paidOn = row.paid_on
  if (!(paidOn === null || paidOn === undefined || typeof paidOn === 'string')) {
    throw new Error('unmappable milestone row')
  }
  return {
    bookingId: row.booking_id,
    kind: row.kind,
    state: row.state,
    paidOn: typeof paidOn === 'string' ? paidOn : null,
  }
}

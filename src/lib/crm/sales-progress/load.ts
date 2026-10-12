/**
 * Read-only data layer for the "sales progress" page.
 * Reads bookings (crm_bookings) and sales units, then computes progress.
 * Never writes: no insert/update/delete/upsert/rpc anywhere in this file.
 * The Supabase client is always passed in, never created at module top level.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '../../supabase-paginate'
import { computeProgress } from './calc'
import type { BookingStatus, OriginKind, ProgressResult, SalesBooking } from './types'
import type { SalesUnitSource } from './units'

export interface SalesProgressData {
  result: ProgressResult
  generatedAt: string
  /** true when the database does not have the origin/evidence columns yet (migration not applied): every order is then "unverified" */
  originColumnsMissing: boolean
}

const FULL_COLUMNS =
  'id, tour_id, departure_id, departure_depart_on, booked_on, party_size, status, origin_kind, evidence_ref'
const LEGACY_COLUMNS =
  'id, tour_id, departure_id, departure_depart_on, booked_on, party_size, status'

const ORIGIN_KINDS: readonly OriginKind[] = ['company_confirmed', 'customer_stated', 'staff_entered']

function isMissingOriginColumns(message: string): boolean {
  if (message.includes('origin_kind') || message.includes('evidence_ref')) return true
  return message.includes('42703')
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readPartySize(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error('unmappable booking row')
}

function readOriginKind(value: unknown): OriginKind | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && (ORIGIN_KINDS as readonly string[]).includes(value)) {
    return value as OriginKind
  }
  return null
}

function readStatus(value: unknown): BookingStatus {
  if (value === 'active' || value === 'cancelled') return value
  throw new Error('unmappable booking row')
}

function mapBookingRow(raw: unknown): SalesBooking {
  if (typeof raw !== 'object' || raw === null) throw new Error('unmappable booking row')
  const row = raw as Record<string, unknown>
  if (!isNonEmptyString(row.id)) throw new Error('unmappable booking row')
  if (!isNonEmptyString(row.tour_id)) throw new Error('unmappable booking row')
  if (!isNonEmptyString(row.booked_on)) throw new Error('unmappable booking row')
  return {
    id: row.id,
    tourId: row.tour_id,
    departureId: readNullableString(row.departure_id),
    departureDepartOn: readNullableString(row.departure_depart_on),
    bookedOn: row.booked_on,
    partySize: readPartySize(row.party_size),
    originKind: readOriginKind(row.origin_kind),
    evidenceRef: readNullableString(row.evidence_ref),
    status: readStatus(row.status),
  }
}

async function readBookingRows(
  db: SupabaseClient,
  clientId: string,
  columns: string,
): Promise<unknown[]> {
  return fetchAll<unknown>(
    (from, to) =>
      db
        .from('crm_bookings')
        .select(columns)
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    20000,
  )
}

/** Today's date (YYYY-MM-DD) in New Zealand. */
function nzToday(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export async function loadSalesProgress(
  db: SupabaseClient,
  clientId: string,
  source: SalesUnitSource,
  now?: () => Date,
): Promise<SalesProgressData> {
  let originColumnsMissing = false
  let rawRows: unknown[]

  try {
    rawRows = await readBookingRows(db, clientId, FULL_COLUMNS)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!isMissingOriginColumns(message)) throw error
    originColumnsMissing = true
    rawRows = await readBookingRows(db, clientId, LEGACY_COLUMNS)
  }

  const bookings = rawRows.map(mapBookingRow)
  const units = await source.listSalesUnits(clientId)

  const computed = computeProgress(units, bookings)
  const clock = (now ?? (() => new Date()))()
  // Past departures with no orders are noise on this page; a past departure that still has orders stays visible.
  const today = nzToday(clock)
  const result = {
    ...computed,
    rows: computed.rows.filter((row) => row.unit.date === null || row.unit.date >= today || row.bookings.length > 0),
  }
  const generatedAt = clock.toISOString()

  return { result, generatedAt, originColumnsMissing }
}

/**
 * Query-string parsing for the 付款总览 overview route.
 *
 * Pure: takes URLSearchParams, returns a typed request or an error code. Ids are
 * checked with the shared helper; nothing here reads the database.
 */

import { isUuid } from '@/lib/http/request-helpers'
import type { OverviewRequest } from './booking-overview-load'
import type { OverviewStatusFilter } from './booking-overview-types'

const STATUS_VALUES: readonly OverviewStatusFilter[] = ['all', 'unsettled', 'settled', 'offline', 'cancelled']

/** The query value that means "orders with no departure chosen yet". */
export const NO_DEPARTURE_PARAM = 'none'

export type OverviewQueryResult =
  | { ok: true; request: OverviewRequest }
  | { ok: false; error: 'invalid_id' | 'invalid_status' | 'invalid_page' }

function isStatus(value: string): value is OverviewStatusFilter {
  return (STATUS_VALUES as readonly string[]).includes(value)
}

function parsePage(raw: string | null): number | null {
  if (raw === null || raw === '') return 1
  if (!/^\d{1,6}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 ? n : null
}

/** Parse departureId / tourId / status / page / includePastPaid. Unknown values are rejected, never guessed. */
export function parseOverviewQuery(params: URLSearchParams): OverviewQueryResult {
  const departureRaw = params.get('departureId')
  const tourId = params.get('tourId')
  const statusRaw = params.get('status') ?? 'all'
  const page = parsePage(params.get('page'))
  const includeRaw = params.get('includePastPaid')

  if (departureRaw !== null && departureRaw !== NO_DEPARTURE_PARAM && !isUuid(departureRaw)) {
    return { ok: false, error: 'invalid_id' }
  }
  if (tourId !== null && !isUuid(tourId)) return { ok: false, error: 'invalid_id' }
  if (!isStatus(statusRaw)) return { ok: false, error: 'invalid_status' }
  if (page === null) return { ok: false, error: 'invalid_page' }

  const request: OverviewRequest = {
    status: statusRaw,
    page,
    includePastPaid: includeRaw === 'true' || includeRaw === '1',
    ...(departureRaw === null ? {} : { departureId: departureRaw === NO_DEPARTURE_PARAM ? null : departureRaw }),
    ...(tourId === null ? {} : { tourId }),
  }
  return { ok: true, request }
}

/**
 * Browser-side fetch for the 付款总览 page.
 *
 * Imported by client components, so it must NOT import any server module: only
 * type-only imports from the shared CRM modules. A response that is not well formed
 * is treated as an error, never as zeros.
 */

import type { OverviewPayload } from '@/lib/crm/booking-overview-load'
import { toSearchString, type PaymentsQuery } from './payments-query'

export type OverviewFetchResult =
  | { kind: 'ok'; data: OverviewPayload }
  | { kind: 'hidden' }
  | { kind: 'error' }

export function overviewUrl(clientId: string, query: PaymentsQuery): string {
  return `/api/clients/${clientId}/crm/bookings/overview${toSearchString(query)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Shape check for the parts the page reads. Anything missing means "do not render numbers". */
export function isOverviewPayload(value: unknown): value is OverviewPayload {
  if (!isRecord(value)) return false
  const { summary, list, paidWithoutBooking, hasBookings } = value
  if (typeof hasBookings !== 'boolean' || typeof value.today !== 'string') return false
  if (!isRecord(summary) || !Array.isArray(summary.groups)) return false
  if (!isRecord(summary.totals) || !isRecord(summary.notes)) return false
  if (typeof summary.hiddenGroupCount !== 'number') return false
  if (!isRecord(list) || !Array.isArray(list.rows)) return false
  if (typeof list.pageCount !== 'number' || typeof list.page !== 'number') return false
  if (!isRecord(paidWithoutBooking) || !Array.isArray(paidWithoutBooking.rows)) return false
  return typeof paidWithoutBooking.total === 'number'
}

/** GET the overview. 403/404 = not available to this person; everything else that is not a good body = error. */
export async function fetchOverview(
  clientId: string,
  query: PaymentsQuery,
  signal?: AbortSignal,
): Promise<OverviewFetchResult> {
  let res: Response
  try {
    res = await fetch(overviewUrl(clientId, query), signal ? { signal } : undefined)
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 403 || res.status === 404) return { kind: 'hidden' }
  if (!res.ok) return { kind: 'error' }
  const body: unknown = await res.json().catch(() => null)
  return isOverviewPayload(body) ? { kind: 'ok', data: body } : { kind: 'error' }
}

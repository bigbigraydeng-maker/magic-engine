/**
 * URL query handling for the 付款总览 page.
 *
 * The page URL and the overview API use the SAME parameter names, so the query string
 * in the address bar is exactly what is sent to the server (one source of truth).
 * Pure functions, no browser or server imports.
 */

export type StatusParam = 'all' | 'unsettled' | 'settled' | 'offline' | 'cancelled'

export const STATUS_OPTIONS: ReadonlyArray<{ value: StatusParam; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unsettled', label: '未收齐' },
  { value: 'settled', label: '已收齐' },
  { value: 'offline', label: '线下已处理' },
  { value: 'cancelled', label: '已取消' },
]

/** The value the server uses for "orders with no departure chosen yet". */
export const NO_DEPARTURE = 'none'

export interface PaymentsQuery {
  /** null = no departure filter; 'none' = orders with no departure chosen; otherwise a departure id. */
  departureId: string | null
  tourId: string | null
  status: StatusParam
  page: number
  includePastPaid: boolean
}

interface ParamReader {
  get(name: string): string | null
}

function isStatus(value: string | null): value is StatusParam {
  return (
    value === 'all' || value === 'unsettled' || value === 'settled' || value === 'offline' || value === 'cancelled'
  )
}

function parsePage(raw: string | null): number {
  if (raw === null || !/^\d{1,6}$/.test(raw)) return 1
  const n = Number(raw)
  return n >= 1 ? n : 1
}

function nonEmpty(raw: string | null): string | null {
  return raw === null || raw === '' ? null : raw
}

/** Read a query from the address bar. Unknown or malformed values fall back to the defaults. */
export function parsePaymentsQuery(params: ParamReader): PaymentsQuery {
  const status = params.get('status')
  const include = params.get('includePastPaid')
  return {
    departureId: nonEmpty(params.get('departureId')),
    tourId: nonEmpty(params.get('tourId')),
    status: isStatus(status) ? status : 'all',
    page: parsePage(params.get('page')),
    includePastPaid: include === 'true' || include === '1',
  }
}

/** Serialise a query, leaving defaults out so the URL stays short. Returns '' or '?a=b'. */
export function toSearchString(query: PaymentsQuery): string {
  const out = new URLSearchParams()
  if (query.departureId !== null) out.set('departureId', query.departureId)
  if (query.tourId !== null) out.set('tourId', query.tourId)
  if (query.status !== 'all') out.set('status', query.status)
  if (query.page > 1) out.set('page', String(query.page))
  if (query.includePastPaid) out.set('includePastPaid', 'true')
  const text = out.toString()
  return text === '' ? '' : `?${text}`
}

/** Change filters: any change except a page change goes back to page 1. */
export function withChange(query: PaymentsQuery, change: Partial<PaymentsQuery>): PaymentsQuery {
  const next = { ...query, ...change }
  return 'page' in change ? next : { ...next, page: 1 }
}

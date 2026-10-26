/**
 * Reads an optional departure list off a goal's supporting_metrics.
 * No client names and no dates live here: the goal row supplies them.
 * Without the key, signup goals keep counting deal rows.
 */

import type { SeatDeparture } from '@/lib/crm/sales-progress/deposited-seats'
import { isIsoDay } from '@/lib/crm/sales-progress/deposited-seats'

export const DEPOSITED_SEAT_SCOPE_KEY = 'deposited_seat_scope'

export interface SeatFetchExtras {
  depositedSeatScope: readonly SeatDeparture[]
  goalCreatedAt: string | null
  baselineValue: unknown
}

type ScopeRead =
  | { ok: true; departures: SeatDeparture[] | null }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readDepositedSeatScope(supporting: unknown): ScopeRead {
  if (supporting == null) return { ok: true, departures: null }
  if (!Array.isArray(supporting)) {
    return { ok: false, reason: '目标的辅助指标不是列表，读不到出发日范围' }
  }
  const found = supporting.filter((item) => isRecord(item) && item.key === DEPOSITED_SEAT_SCOPE_KEY)
  if (found.length === 0) return { ok: true, departures: null }
  if (found.length > 1) return { ok: false, reason: '出发日范围写了不止一份，座位进度不出数' }
  return parseDepartures(found[0])
}

function parseDepartures(raw: unknown): ScopeRead {
  if (!isRecord(raw) || !Array.isArray(raw.departures) || raw.departures.length === 0) {
    return { ok: false, reason: '出发日范围是空的，座位进度不出数' }
  }
  const departures: SeatDeparture[] = []
  const seen = new Set<string>()
  for (const item of raw.departures) {
    const parsed = parseOne(item)
    if (!parsed) return { ok: false, reason: '出发日范围里有读不懂的日期，座位进度不出数' }
    const key = `${parsed.departOn}\t${parsed.tourId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    departures.push(parsed)
  }
  return { ok: true, departures }
}

function parseOne(item: unknown): SeatDeparture | null {
  if (!isRecord(item) || typeof item.depart_on !== 'string' || !isIsoDay(item.depart_on)) return null
  if (item.tour_id === undefined) return { departOn: item.depart_on, tourId: null }
  if (typeof item.tour_id !== 'string' || item.tour_id.trim() === '') return null
  return { departOn: item.depart_on, tourId: item.tour_id }
}

/** Visible name when this goal counts deposited seats. Null keeps the stored metric name. */
export function depositedSeatMetricLabel(
  supporting: unknown,
): { label: string; unit: string } | null {
  const scope = readDepositedSeatScope(supporting)
  if (!scope.ok || scope.departures === null) return null
  return { label: '已收定金座位', unit: '座位' }
}

/** Extras for signups_count only. Other metrics ignore the scope key. */
export function readSeatFetchExtras(input: {
  primary_metric_key: string
  supporting_metrics?: unknown
  created_at?: string | null
  baseline_value?: unknown
}): { ok: true; extras: SeatFetchExtras | null } | { ok: false; reason: string } {
  if (input.primary_metric_key !== 'signups_count') return { ok: true, extras: null }
  const scope = readDepositedSeatScope(input.supporting_metrics)
  if (!scope.ok) return scope
  if (scope.departures === null) return { ok: true, extras: null }
  return {
    ok: true,
    extras: {
      depositedSeatScope: scope.departures,
      goalCreatedAt: input.created_at ?? null,
      baselineValue: input.baseline_value,
    },
  }
}

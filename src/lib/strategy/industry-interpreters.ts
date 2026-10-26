/**
 * IMPACT Measure — maps to magic-engine-platform app/impact measure.
 *
 * Registry of optional industry interpreters. Every interpreter is off until
 * one goal's own config sets `industry_interpreter.enabled` to true and names
 * an id. Client industry (including "travel") is ignored. A filled departure
 * list is not a switch. When the decision is `original`, the caller must keep
 * its existing metric and must not read a number from this module.
 *
 * After #3078 merges, replace the signups_count branch in
 * src/lib/strategy/auto-fetch.ts (the `if (options.depositedSeatScope)` check
 * that changes the metric whenever departures are filled) with this one call:
 *
 *   return routeSignupCount(resolveIndustryInterpreter(supportingMetrics, industry), {
 *     original: () => fetchBookings(supabase, clientId, goalPeriod),
 *     depositedSeats: () => countOptedInDepositedSeats(supabase, clientId, goal),
 *     unknown: (reason) => ({ ok: false, unknown: true, reason }),
 *   })
 *
 * `countOptedInDepositedSeats` should load deposit-paid rows the way #3078
 * already loads them (window, baseline, milestones), then call
 * `countTravelDepositedSeats`. Departures are an input to that count, read
 * only after this registry says the goal opted in. Do not keep "departures
 * are filled, so switch the metric".
 */

import type { DepartureSeatTotal, DepositedSeatCount, DepositedSeatFacts } from './outcome-profiles/travel-deposited-seats'
import {
  TRAVEL_DEPOSITED_SEATS_ID,
  countTravelDepositedSeats,
  readDepartureScope,
} from './outcome-profiles/travel-deposited-seats'

export { TRAVEL_DEPOSITED_SEATS_ID } from './outcome-profiles/travel-deposited-seats'

export const INDUSTRY_INTERPRETER_KEY = 'industry_interpreter'

export interface IndustryInterpreter {
  id: typeof TRAVEL_DEPOSITED_SEATS_ID
  readDepartures: typeof readDepartureScope
  count: typeof countTravelDepositedSeats
}

export const industryInterpreters: readonly IndustryInterpreter[] = [
  {
    id: TRAVEL_DEPOSITED_SEATS_ID,
    readDepartures: readDepartureScope,
    count: countTravelDepositedSeats,
  },
]

export type InterpreterDecision =
  | { mode: 'original' }
  | { mode: 'unknown'; reason: string }
  | { mode: 'count'; interpreterId: typeof TRAVEL_DEPOSITED_SEATS_ID; departures: readonly { departOn: string; tourId: string | null }[] }

export type IndustryInterpreterResult =
  | { applied: false }
  | { applied: true; ok: false; unknown: true; reason: string }
  | {
      applied: true
      ok: true
      unknown: false
      interpreterId: typeof TRAVEL_DEPOSITED_SEATS_ID
      seats: number
      deals: number
      byDeparture: DepartureSeatTotal[]
    }

interface SwitchEntry {
  enabled: boolean
  interpreterId: string
}

type SwitchRead =
  | { ok: true; entries: SwitchEntry[] }
  | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSwitches(supporting: unknown): SwitchRead {
  if (!Array.isArray(supporting)) return { ok: true, entries: [] }
  const entries: SwitchEntry[] = []
  for (const item of supporting) {
    if (!isRecord(item) || item.key !== INDUSTRY_INTERPRETER_KEY) continue
    const parsed = parseSwitch(item)
    if (!parsed.ok) return parsed
    if (parsed.entry) entries.push(parsed.entry)
  }
  return { ok: true, entries }
}

function parseSwitch(item: Record<string, unknown>): { ok: true; entry: SwitchEntry | null } | { ok: false; reason: string } {
  if (typeof item.enabled !== 'boolean') {
    return { ok: false, reason: '目标写了行业解释器，但没有写明打开哪一个，不出数也不改回原来的笔数' }
  }
  if (!item.enabled) return { ok: true, entry: null }
  if (typeof item.interpreter_id !== 'string' || item.interpreter_id.trim() === '') {
    return { ok: false, reason: '目标写了行业解释器，但没有写明打开哪一个，不出数也不改回原来的笔数' }
  }
  return { ok: true, entry: { enabled: true, interpreterId: item.interpreter_id } }
}

/**
 * @param industry Accepted and ignored. A travel client does not opt in.
 */
export function resolveIndustryInterpreter(supportingMetrics: unknown, industry?: string | null): InterpreterDecision {
  void industry
  const switches = readSwitches(supportingMetrics)
  if (!switches.ok) return { mode: 'unknown', reason: switches.reason }
  const enabled = switches.entries.filter((entry) => entry.enabled)
  const chosen = enabled[0]
  if (!chosen) return { mode: 'original' }
  if (enabled.length > 1) {
    return { mode: 'unknown', reason: '目标同时打开了不止一个行业解释器，不出数也不改回原来的笔数' }
  }
  const selected = industryInterpreters.find((item) => item.id === chosen.interpreterId)
  if (!selected) {
    return { mode: 'unknown', reason: '目标打开的行业解释器还不认识，不出数也不改回原来的笔数' }
  }
  const scope = selected.readDepartures(supportingMetrics)
  if (!scope.ok) return { mode: 'unknown', reason: scope.reason }
  return { mode: 'count', interpreterId: selected.id, departures: scope.departures }
}

export function routeSignupCount<T>(
  decision: InterpreterDecision,
  paths: {
    original: () => T
    depositedSeats: () => T
    unknown: (reason: string) => T
  },
): T {
  if (decision.mode === 'original') return paths.original()
  if (decision.mode === 'unknown') return paths.unknown(decision.reason)
  return paths.depositedSeats()
}

function fromCount(count: DepositedSeatCount): IndustryInterpreterResult {
  if (!count.ok) return { applied: true, ok: false, unknown: true, reason: count.reason }
  return {
    applied: true,
    ok: true,
    unknown: false,
    interpreterId: TRAVEL_DEPOSITED_SEATS_ID,
    seats: count.seats,
    deals: count.deals,
    byDeparture: count.byDeparture,
  }
}

export function applyIndustryInterpreter(input: {
  supportingMetrics: unknown
  /** Ignored. Passing "travel" must not turn the counter on. */
  industry?: string | null
  deposited?: DepositedSeatFacts
}): IndustryInterpreterResult {
  const decision = resolveIndustryInterpreter(input.supportingMetrics, input.industry)
  if (decision.mode === 'original') return { applied: false }
  if (decision.mode === 'unknown') return { applied: true, ok: false, unknown: true, reason: decision.reason }
  const selected = industryInterpreters.find((item) => item.id === decision.interpreterId)
  if (!selected || !input.deposited) {
    return { applied: true, ok: false, unknown: true, reason: '已收定金座位已打开，但没有带来可数的订单，不出数' }
  }
  return fromCount(selected.count(input.deposited, decision.departures))
}

import { resolveTargetCplCents } from '@/lib/ads-strategy/client-target-cpl'

/**
 * Per-client breaker settings from existing JSON. No new column.
 * Missing keys keep the conservative defaults. A bad number is not a zero.
 * The lead-cost target is the shared client target, not a number written here.
 */

export const BREAKER_CONFIG_KEY = 'ads_circuit_breaker'
export const DEFAULT_CPL_MULTIPLE = 2
export const DEFAULT_STALE_HOURS = 12

export interface BreakerSettings {
  readonly enabled: boolean
  readonly cplMultiple: number
  readonly staleHours: number
  readonly forecastEnabled: boolean
  readonly targetCplCents: number | null
}

export function defaultBreakerSettings(): BreakerSettings {
  return {
    enabled: true,
    cplMultiple: DEFAULT_CPL_MULTIPLE,
    staleHours: DEFAULT_STALE_HOURS,
    forecastEnabled: true,
    targetCplCents: null,
  }
}

export function readBreakerSettings(
  leadsConfig: unknown,
  planRows: readonly { plan_data?: unknown }[],
  strategyRow?: { target_cost_per_primary?: unknown } | null,
): BreakerSettings {
  const block = objectOf(objectOf(leadsConfig)?.[BREAKER_CONFIG_KEY])
  const base = defaultBreakerSettings()
  return {
    enabled: block?.enabled === false ? false : base.enabled,
    cplMultiple: atLeast(block?.cpl_multiple, DEFAULT_CPL_MULTIPLE, DEFAULT_CPL_MULTIPLE),
    staleHours: atLeast(block?.stale_hours, 1, DEFAULT_STALE_HOURS),
    forecastEnabled: block?.forecast_enabled === false ? false : base.forecastEnabled,
    targetCplCents: resolveTargetCplCents({
      strategyMajor: strategyRow?.target_cost_per_primary,
      leadsConfig,
      planRows,
    }),
  }
}

function atLeast(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return fallback
  return value
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

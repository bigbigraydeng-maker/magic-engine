/**
 * Per-client breaker settings from existing JSON. No new column.
 * Missing keys keep the conservative defaults. A bad number is not a zero.
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

export function readBreakerSettings(leadsConfig: unknown, planRows: readonly { plan_data?: unknown }[]): BreakerSettings {
  const block = objectOf(objectOf(leadsConfig)?.[BREAKER_CONFIG_KEY])
  const base = defaultBreakerSettings()
  return {
    enabled: block?.enabled === false ? false : base.enabled,
    cplMultiple: atLeast(block?.cpl_multiple, DEFAULT_CPL_MULTIPLE, DEFAULT_CPL_MULTIPLE),
    staleHours: atLeast(block?.stale_hours, 1, DEFAULT_STALE_HOURS),
    forecastEnabled: block?.forecast_enabled === false ? false : base.forecastEnabled,
    targetCplCents: positiveInt(block?.target_cpl_cents) ?? agreedPlanCpl(planRows),
  }
}

function agreedPlanCpl(rows: readonly { plan_data?: unknown }[]): number | null {
  const values: Array<number | null> = []
  for (const row of rows) {
    const promo = objectOf(objectOf(row.plan_data)?.promo)
    if (!promo || !('target_cpl_cents' in promo)) continue
    values.push(positiveInt(promo.target_cpl_cents))
  }
  if (values.length === 0 || values.some((cents) => cents === null)) return null
  return new Set(values).size === 1 ? values[0] : null
}

function atLeast(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return fallback
  return value
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return value
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

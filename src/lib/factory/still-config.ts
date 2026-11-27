/**
 * Per-client switch for factory stills. Missing config is off, so a write-mode
 * weekly draft does not spend. The cap lives in the client's jsonb config.
 */

export const FACTORY_STILL_COST_ESTIMATE_USD = 0.04

/** Identity stamped on an automated still pass. Not a person, and not a publish grant. */
export const STILL_REVIEWER_ID = 'system:still-review'

/** Reserved before the image check. The ledger stores the real cost when the model returns one. */
export const STILL_VISUAL_COST_ESTIMATE_USD = 0.01

export type StillAspect = '9:16' | '4:5'
export type StillRole = 'story' | 'post'

export interface FactoryStillConfig {
  enabled: boolean
  /** Null when the number is missing or not a usable non-negative amount. */
  weeklyCapUsd: number | null
}

export function readFactoryStillConfig(config: unknown): FactoryStillConfig {
  const root = record(record(config)?.factory_stills)
  const cap = root?.weekly_cap_usd
  const weeklyCapUsd = typeof cap === 'number' && Number.isFinite(cap) && cap >= 0 && cap <= 1000
    ? roundUsd(cap)
    : null
  return { enabled: root?.enabled === true, weeklyCapUsd }
}

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

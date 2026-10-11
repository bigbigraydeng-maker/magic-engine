import { REEL_A_CLASS_CHECK_KEYS, type ContentCheckItemResult } from './content-review'

export type SocialCircuitBreakerRule = 'repeat_a_class_failure'

export type SocialCircuitBreakerVerdict =
  | { tripped: false }
  | { tripped: true; rule: SocialCircuitBreakerRule; detail: string }

export interface SocialCircuitBreakerFailure {
  sourceKey: string
  occurredAt: string
  checks: readonly ContentCheckItemResult[]
}

/**
 * Pure decision helper only. The current publishing bypass gate does not yet
 * provide a producer identity, so callers must not wire this to campaign or
 * client IDs as a substitute for sourceKey.
 */
export function detectSocialCircuitBreaker(input: {
  sourceKey: string
  failures: readonly SocialCircuitBreakerFailure[]
  windowDays: number
  now?: string
}): SocialCircuitBreakerVerdict {
  if (!input.sourceKey.trim() || !Number.isFinite(input.windowDays) || input.windowDays <= 0) return { tripped: false }
  const now = input.now ? Date.parse(input.now) : Date.now()
  if (!Number.isFinite(now)) return { tripped: false }
  const cutoff = now - input.windowDays * 24 * 60 * 60 * 1000
  const count = input.failures.filter(failure => {
    if (failure.sourceKey !== input.sourceKey) return false
    const occurredAt = Date.parse(failure.occurredAt)
    if (!Number.isFinite(occurredAt) || occurredAt < cutoff || occurredAt > now) return false
    return failure.checks.some(check =>
      (REEL_A_CLASS_CHECK_KEYS as readonly string[]).includes(check.key) &&
      check.judge === 'AUTO' &&
      check.outcome === 'FAIL',
    )
  }).length
  if (count < 2) return { tripped: false }
  return {
    tripped: true,
    rule: 'repeat_a_class_failure',
    detail: `source ${input.sourceKey} had ${count} A-class failures in ${input.windowDays} days`,
  }
}

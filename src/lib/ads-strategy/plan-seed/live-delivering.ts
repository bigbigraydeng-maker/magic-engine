import type { HeartbeatAccountRead } from '@/lib/ads-strategy/heartbeat/read'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'

/** Sum of daily budgets for currently delivering adsets, plus completeness info. */
export interface LiveDelivering {
  minor: number
  incomplete: boolean
  readAtIso: string
  currency: string | null
}

/**
 * Derives the live delivering budget from a heartbeat read.
 * Returns null when the read was aborted or the adsets read did not succeed,
 * so callers never mistake a failed read for a real zero.
 */
export function liveDeliveringFromRead(
  read: HeartbeatAccountRead,
): LiveDelivering | null {
  if (read.abortedBy !== null) return null

  const adsetsOutcome = read.outcomes.find((o) => o.kind === 'adsets')
  if (!adsetsOutcome || adsetsOutcome.verdict !== 'ok') return null

  let minor = 0
  let incomplete = false

  for (const adset of read.adsets) {
    const status = adset.effectiveStatus
    if (status === null || !DELIVERING_STATUSES.has(status)) continue

    const budget = adset.dailyBudgetMinor
    if (
      adset.budgetLevel === 'adset' &&
      budget !== null &&
      Number.isInteger(budget) &&
      budget > 0
    ) {
      minor += budget
    } else {
      incomplete = true
    }
  }

  return {
    minor,
    incomplete,
    readAtIso: read.sampledAtIso,
    currency: read.currency,
  }
}

/**
 * Turn the existing budget-fact read into the numbers this card checks.
 * Other accounts that cannot be read stay null. They are not treated as zero.
 */

import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import type { BudgetFacts, OtherAccountFact } from '@/lib/ads-tracking-preflight/types'

export interface OtherLive {
  readonly cents: number | null
  readonly lifetime: boolean
}

export function sumOtherLive(
  accounts: readonly OtherAccountFact[] | null,
  error: string | null,
): OtherLive {
  if (error || accounts === null) return { cents: null, lifetime: false }
  let sum = 0
  for (const row of accounts) {
    if (row.live_lifetime_budget_count > 0) return { cents: null, lifetime: true }
    if (!Number.isSafeInteger(row.live_daily_budget_cents) || row.live_daily_budget_cents < 0) {
      return { cents: null, lifetime: false }
    }
    sum += row.live_daily_budget_cents
    if (!Number.isSafeInteger(sum)) return { cents: null, lifetime: false }
  }
  return { cents: sum, lifetime: false }
}

export function countedInLive(effectiveStatus: string | null | undefined): boolean | null {
  if (!effectiveStatus) return null
  return DELIVERING_STATUSES.has(effectiveStatus)
}

export function capNumbers(facts: BudgetFacts, effectiveStatus: string | null | undefined): {
  accountCapCents: number | null
  accountLiveCents: number | null
  otherAccountsLiveCents: number | null
  clientCapCents: number | null
  countedInLive: boolean | null
  lifetimeBlocks: boolean
} {
  const other = sumOtherLive(facts.other_accounts, facts.other_accounts_error)
  const lifetimeBlocks = facts.live_lifetime_budget_count > 0 || other.lifetime
  if (!facts.read) {
    return {
      accountCapCents: null,
      accountLiveCents: null,
      otherAccountsLiveCents: other.cents,
      clientCapCents: null,
      countedInLive: countedInLive(effectiveStatus),
      lifetimeBlocks,
    }
  }
  return {
    accountCapCents: facts.account_cap_cents,
    accountLiveCents: facts.live_daily_budget_cents,
    otherAccountsLiveCents: other.cents,
    clientCapCents: facts.client_cap_cents,
    countedInLive: countedInLive(effectiveStatus),
    lifetimeBlocks,
  }
}

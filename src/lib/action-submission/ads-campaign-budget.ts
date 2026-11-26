/** Access helper for the Meta execute route. Direct budget submission is closed. */

import { requirePaidClientAccess, type ClientAccessResult } from '@/lib/auth/client-access'
import type { KernelDeps } from '@/lib/kernel/deps'

export type AdsCampaignBudgetAccess = Extract<ClientAccessResult, { ok: true }>

/** Pause and resume on the execute route still resolve the actor here. */
export function requireAdsCampaignBudgetAccess(clientId: string): Promise<ClientAccessResult> {
  return requirePaidClientAccess(clientId)
}

export interface SubmitAdsCampaignBudgetDecreaseInput {
  readonly clientId: string
  readonly access: AdsCampaignBudgetAccess
  readonly cycleDate: string
  readonly adAccountId: string
  readonly campaignId: string
  readonly afterCents: number
  readonly executionItemId?: string | null
}

const CLOSED = 'Direct campaign budget changes are closed. Use a confirmation card.'

/** Refuses before Kernel. A confirmation card is the only budget write. */
export function queueAdsCampaignBudgetDecrease(
  _deps: KernelDeps,
  _input: SubmitAdsCampaignBudgetDecreaseInput,
): Promise<never> {
  return Promise.reject(new Error(CLOSED))
}

/** Refuses before Kernel. A previously queued run is not resumed from this path. */
export function runQueuedAdsCampaignBudgetDecrease(
  _deps: KernelDeps,
  _clientId: string,
  _runId: string,
): Promise<never> {
  return Promise.reject(new Error(CLOSED))
}

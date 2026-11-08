/**
 * Read one ad set and the existing cap numbers.
 * The budget write stays in the kernel budget action. This file does not write.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readBudgetFacts } from '@/lib/ads-tracking-preflight/budget-reader'
import type { BudgetFacts } from '@/lib/ads-tracking-preflight/types'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getAdSetStatus, type AdSetSummary } from '@/lib/meta/adsets'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { capNumbers } from './caps'
import { readStepRatio } from './ratio'
import type { BudgetOrder, BudgetRuntime, BudgetSnapshot, StepRatio } from './types'

export async function metaBudgetRuntime(clientId: string, sb: SupabaseClient): Promise<BudgetRuntime | null> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return null
  return createBudgetRuntime({
    readSet: (adsetId) => getAdSetStatus(adsetId, token),
    accounts: () => getRegisteredAccountIds(clientId),
    caps: (accountId) => loadCaps(sb, clientId, accountId, token),
    ratio: (now) => readStepRatio(sb, clientId, now),
    now: () => new Date(),
  })
}

export function createBudgetRuntime(deps: {
  readSet: (adsetId: string) => Promise<AdSetSummary | null>
  accounts: () => Promise<{ ids: string[]; error?: string }>
  caps: (accountId: string) => Promise<BudgetFacts>
  ratio: (now: Date) => Promise<StepRatio>
  now: () => Date
}): BudgetRuntime {
  return { read: (order) => readSnapshot(deps, order) }
}

async function readSnapshot(
  deps: Parameters<typeof createBudgetRuntime>[0],
  order: BudgetOrder,
): Promise<BudgetSnapshot> {
  const [row, facts, ratio, accounts] = await Promise.all([
    deps.readSet(order.adsetId).catch(() => null),
    deps.caps(order.adAccountId).catch(() => null),
    deps.ratio(deps.now()).catch(() => 'unreadable' as const),
    deps.accounts().catch(() => ({ ids: [] as string[], error: 'unread' })),
  ])
  return assembleSnapshot(order, row, facts, ratio, accounts)
}

export function centsFromMeta(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

export function assembleSnapshot(
  order: BudgetOrder,
  row: AdSetSummary | null,
  facts: BudgetFacts | null,
  ratio: StepRatio,
  accounts: { ids: string[]; error?: string },
): BudgetSnapshot {
  const caps = facts ? capNumbers(facts, row?.effective_status) : emptyCaps()
  return {
    registeredAccountIds: accounts.error ? null : accounts.ids,
    accountId: textOrNull(row?.account_id),
    adsetId: textOrNull(row?.id) ?? (row ? order.adsetId : null),
    status: textOrNull(row?.status),
    currentCents: centsFromMeta(row?.daily_budget),
    name: textOrNull(row?.name),
    ...caps,
    stepRatio: ratio,
  }
}

function emptyCaps(): ReturnType<typeof capNumbers> {
  return {
    accountCapCents: null,
    accountLiveCents: null,
    otherAccountsLiveCents: null,
    clientCapCents: null,
    countedInLive: null,
    lifetimeBlocks: false,
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function loadCaps(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  token: string,
): Promise<BudgetFacts> {
  const result = await readBudgetFacts({
    supabase: sb,
    clientId,
    adAccountId: accountId,
    token,
    fetcher: fetch,
    now: new Date(),
  })
  return result.facts
}

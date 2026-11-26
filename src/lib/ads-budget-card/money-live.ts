/**
 * Re-read the budget facts the existing budget card already checks.
 * This file does not write. The confirmation gate calls it; it does not live
 * in the submission boundary.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { readBudgetFacts } from '@/lib/ads-tracking-preflight/budget-reader'
import { assembleSnapshot, metaBudgetRuntime } from '@/lib/ads-budget-card/meta'
import { readStepRatio } from '@/lib/ads-budget-card/ratio'
import type { BudgetOrder, BudgetSnapshot } from '@/lib/ads-budget-card/types'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/client'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import type { AdSetSummary } from '@/lib/meta/adsets'
import type { MoneyHold } from '@/lib/action-submission/money-card'

type Db = KernelDeps['supabase']

export async function loadMoneyBudgetLive(
  sb: Db,
  clientId: string,
  hold: Pick<MoneyHold, 'level' | 'entityId' | 'adAccountId' | 'name' | 'beforeCents' | 'afterCents'>,
): Promise<BudgetSnapshot> {
  const order = orderOf(hold)
  if (hold.level === 'adset') {
    const runtime = await metaBudgetRuntime(clientId, sb)
    if (!runtime) return unread()
    return runtime.read(order)
  }
  return readCampaign(sb, clientId, hold, order)
}

async function readCampaign(
  sb: Db,
  clientId: string,
  hold: Pick<MoneyHold, 'entityId' | 'adAccountId' | 'name'>,
  order: BudgetOrder,
): Promise<BudgetSnapshot> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return unread()
  const [campaign, accounts, facts, ratio] = await Promise.all([
    getCampaignDetails(hold.entityId, token).catch(() => null),
    getRegisteredAccountIds(clientId).catch(() => ({ ids: [] as string[], error: 'unread' })),
    readBudgetFacts({ supabase: sb, clientId, adAccountId: hold.adAccountId, token, fetcher: fetch, now: new Date() }).catch(() => null),
    readStepRatio(sb, clientId, new Date()).catch(() => 'unreadable' as const),
  ])
  return assembleSnapshot(order, campaign ? asSet(hold, campaign) : null, facts?.facts ?? null, ratio, accounts)
}

function asSet(
  hold: Pick<MoneyHold, 'entityId' | 'name'>,
  campaign: { name: string; status: AdSetSummary['status']; daily_budget?: string; account_id?: string },
): AdSetSummary {
  return {
    id: hold.entityId,
    name: campaign.name || hold.name || hold.entityId,
    status: campaign.status,
    effective_status: campaign.status,
    daily_budget: campaign.daily_budget,
    account_id: campaign.account_id,
  }
}

function orderOf(hold: Pick<MoneyHold, 'entityId' | 'adAccountId' | 'name' | 'beforeCents' | 'afterCents'>): BudgetOrder {
  return {
    prescriptionId: hold.entityId,
    adsetId: hold.entityId,
    adAccountId: hold.adAccountId,
    newDailyBudgetCents: hold.afterCents,
    name: hold.name,
    expectedMetric: 'ads.account.spend',
    direction: hold.afterCents > hold.beforeCents ? 'up' : 'down',
    observationWindowDays: 7,
  }
}

function unread(): BudgetSnapshot {
  return {
    registeredAccountIds: null,
    accountId: null,
    adsetId: null,
    status: null,
    currentCents: null,
    name: null,
    accountCapCents: null,
    accountLiveCents: null,
    countedInLive: null,
    otherAccountsLiveCents: null,
    clientCapCents: null,
    lifetimeBlocks: false,
    stepRatio: 'unreadable',
  }
}

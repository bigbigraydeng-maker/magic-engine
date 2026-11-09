/**
 * Live reads only. The pause write stays inside the kernel pause-unit step.
 */

import { getAdSetStatus, listAdSetsInCampaign, type AdSetSummary } from '@/lib/meta/adsets'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import type { LiveAdSet, LiveFacts } from './guard'
import type { PauseAdSetOrder } from './order'

export async function readPauseLive(clientId: string, order: PauseAdSetOrder): Promise<LiveFacts> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return unreadable()
  const accounts = await getRegisteredAccountIds(clientId).catch(() => ({ ids: [] as string[], error: 'unread' }))
  if (accounts.error) return unreadable()
  const [one, many] = await Promise.all([
    getAdSetStatus(order.adsetId, token),
    listAdSetsInCampaign(order.campaignId, token),
  ])
  return {
    registeredAccountIds: accounts.ids,
    target: one ? mapSet(one) : null,
    campaignAdSets: many ? many.map(mapSet) : null,
  }
}

export function mapSet(row: AdSetSummary): LiveAdSet {
  return {
    id: row.id,
    status: row.status ?? null,
    accountId: typeof row.account_id === 'string' ? row.account_id : null,
  }
}

function unreadable(): LiveFacts {
  return { registeredAccountIds: null, target: null, campaignAdSets: null }
}

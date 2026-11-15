/**
 * Production reads, one activate, then a read-back.
 * Issuing a card does not come through the Meta helpers below.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { bindLaunchToApprovedPlan } from '@/lib/ads-launch/plan-gate'
import { getAdSetStatus } from '@/lib/meta/adsets'
import { activateAd, readAdPlacement, type AdPlacement } from '@/lib/meta/ads-manager'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import type { ActivateDeps } from './flow'
import { sameAccount, type ActivateLive } from './guard'
import { describePausedAd } from './paused'
import { readActivateSwitch } from './switch'

export function makeActivateDeps(sb: SupabaseClient, clientId: string): ActivateDeps {
  return {
    switchState: () => readActivateSwitch(sb, clientId),
    describe: (adId) => describePausedAd(sb, clientId, adId),
    plan: () => bindLaunchToApprovedPlan(sb, clientId, { mode: 'ad_only' }),
    live: (adId) => readLive(clientId, adId),
    activate: (adId) => activateOnce(clientId, adId),
    readBack: (adId) => readStatus(clientId, adId),
  }
}

async function readLive(clientId: string, adId: string): Promise<ActivateLive | null> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return null
  const placement = await readAdPlacement(adId, token)
  if (!placement?.accountId) return null
  const registered = await getRegisteredAccountIds(clientId)
  if (registered.error) return unread(placement)
  const [adset, campaign] = await Promise.all([
    placement.adsetId ? getAdSetStatus(placement.adsetId, token) : Promise.resolve(null),
    placement.campaignId ? getCampaignDetails(placement.campaignId, token) : Promise.resolve(null),
  ])
  return {
    adStatus: placement.status,
    accountId: placement.accountId,
    adsetStatus: adset?.status ?? null,
    campaignStatus: campaign?.status ?? null,
    owned: registered.ids.some((id) => sameAccount(id, placement.accountId ?? '')),
  }
}

function unread(placement: AdPlacement): ActivateLive {
  return {
    adStatus: placement.status,
    accountId: placement.accountId,
    adsetStatus: null,
    campaignStatus: null,
    owned: null,
  }
}

async function activateOnce(clientId: string, adId: string): Promise<boolean> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return false
  return activateAd(adId, token)
}

async function readStatus(clientId: string, adId: string): Promise<string | null> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return null
  const row = await readAdPlacement(adId, token)
  return row?.status ?? null
}

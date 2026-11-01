/**
 * Meta reads and a pause-only write for this card.
 * The only status this file sends is PAUSED.
 */

import { GRAPH_BASE } from '@/lib/meta/graph-base'
import { pauseAd } from '@/lib/meta/ads-manager'
import { setAdSetStatus } from '@/lib/meta/adsets'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import type { LiveFacts } from './guard'
import type { LiveAd, PauseOrder } from './order'
import type { PauseRuntime } from './flow'

export async function metaPauseRuntime(clientId: string): Promise<PauseRuntime | null> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return null
  return createMetaPauseRuntime(token, () => getRegisteredAccountIds(clientId))
}

export function createMetaPauseRuntime(
  token: string,
  accounts: () => Promise<{ ids: string[]; error?: string }>,
): PauseRuntime {
  return {
    live: (order) => readLive(order, token, accounts),
    pause: (order) => pauseOnly(order, token),
    readback: (order) => readStatus(targetId(order), token),
  }
}

async function pauseOnly(order: PauseOrder, token: string): Promise<boolean> {
  if (order.level === 'ad') {
    if (!order.adId || !isObjectId(order.adId)) return false
    try {
      await pauseAd(order.adId, token)
      return true
    } catch {
      return false
    }
  }
  if (!isObjectId(order.adsetId)) return false
  return setAdSetStatus(order.adsetId, token, 'PAUSED')
}

async function readLive(
  order: PauseOrder,
  token: string,
  accounts: () => Promise<{ ids: string[]; error?: string }>,
): Promise<LiveFacts> {
  const registered = await accounts().catch(() => ({ ids: [] as string[], error: 'unread' }))
  const object = await readObject(order, token)
  const ads = await readCampaignAds(order.campaignId, token)
  const successor = await readSuccessor(order, token)
  return {
    registeredAccountIds: registered.error ? null : registered.ids,
    object,
    campaignAds: ads,
    successorEffectiveStatus: successor.status,
    successorReadable: successor.readable,
  }
}

async function readSuccessor(order: PauseOrder, token: string): Promise<{ readable: boolean; status: string | null }> {
  if (!order.successorAdId) return { readable: true, status: null }
  const row = await graphGet(order.successorAdId, token, 'effective_status')
  if (!row) return { readable: false, status: null }
  return { readable: true, status: typeof row.effective_status === 'string' ? row.effective_status : null }
}

async function readObject(order: PauseOrder, token: string): Promise<LiveFacts['object']> {
  const id = targetId(order)
  const fields = order.level === 'ad' ? 'account_id,campaign_id,adset_id' : 'account_id,campaign_id'
  const row = await graphGet(id, token, fields)
  if (!row || typeof row.account_id !== 'string' || typeof row.campaign_id !== 'string') return null
  const adsetId = order.level === 'ad'
    ? (typeof row.adset_id === 'string' ? row.adset_id : null)
    : order.adsetId
  if (!adsetId) return null
  return { accountId: row.account_id, campaignId: row.campaign_id, adsetId }
}

async function readCampaignAds(campaignId: string, token: string): Promise<LiveAd[] | null> {
  if (!isObjectId(campaignId)) return null
  const url = `${GRAPH_BASE}/${campaignId}/ads?fields=id,adset_id,effective_status&limit=100&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url).catch(() => null)
  if (!res?.ok) return null
  const body = await res.json().catch(() => null) as { data?: unknown; paging?: { next?: string } } | null
  if (!body || !Array.isArray(body.data) || body.paging?.next) return null
  const ads: LiveAd[] = []
  for (const item of body.data) {
    const row = item as { id?: unknown; adset_id?: unknown; effective_status?: unknown }
    if (typeof row.id !== 'string' || typeof row.adset_id !== 'string') return null
    ads.push({
      id: row.id,
      adsetId: row.adset_id,
      effectiveStatus: typeof row.effective_status === 'string' ? row.effective_status : null,
    })
  }
  return ads
}

async function readStatus(id: string, token: string): Promise<string | null> {
  const row = await graphGet(id, token, 'status')
  return row && typeof row.status === 'string' ? row.status : null
}

function isObjectId(id: string): boolean {
  return /^\d{1,32}$/.test(id)
}

async function graphGet(id: string, token: string, fields: string): Promise<Record<string, unknown> | null> {
  if (!isObjectId(id)) return null
  const url = `${GRAPH_BASE}/${id}?fields=${fields}&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url).catch(() => null)
  if (!res?.ok) return null
  const body = await res.json().catch(() => null)
  return body && typeof body === 'object' ? body as Record<string, unknown> : null
}

function targetId(order: PauseOrder): string {
  return order.level === 'ad' ? (order.adId ?? '') : order.adsetId
}

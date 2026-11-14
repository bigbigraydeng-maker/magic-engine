/**
 * Production reads and the existing image upload, then creative, then ad.
 * Nothing here changes an ad set budget or status.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { bindLaunchToApprovedPlan } from '@/lib/ads-launch/plan-gate'
import { FACTORY_BUCKET } from '@/lib/factory/worker-guard'
import { uploadImageToMeta } from '@/lib/meta/asset-upload'
import { GRAPH_BASE } from '@/lib/meta/graph-base'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import type { CreativeDeps, CreativeMeta, StepResult } from './flow'
import type { Inspect, LiveFacts } from './guard'
import { copyFromAds, factoryImagePath, type CreativeOrder } from './order'
import { readCreativeSwitch } from './switch'

const WRITE_TIMEOUT_MS = 15_000

export function makeCreativeDeps(sb: SupabaseClient, clientId: string): CreativeDeps {
  return {
    switchState: () => readCreativeSwitch(sb, clientId),
    inspect: (order) => inspectOrder(sb, clientId, order),
    meta: async () => {
      const token = await getMetaTokenForClient(clientId)
      return token ? metaCreativeClient(token) : null
    },
  }
}

export function metaCreativeClient(token: string): CreativeMeta {
  return {
    uploadImage: (input) => uploadImage(input, token),
    createCreative: (input) => graphCreate(`${input.accountId}/adcreatives`, {
      name: input.name,
      object_story_spec: JSON.stringify(input.story),
    }, token),
    createAd: (input) => graphCreate(`${input.accountId}/ads`, {
      name: input.name,
      adset_id: input.adSetId,
      creative: JSON.stringify({ creative_id: input.creativeId }),
      status: input.status,
    }, token),
  }
}

async function inspectOrder(sb: SupabaseClient, clientId: string, order: CreativeOrder): Promise<Inspect> {
  const [plan, live, imageUrl] = await Promise.all([
    bindLaunchToApprovedPlan(sb, clientId, { mode: 'ad_only' }),
    readLive(clientId, order),
    factoryImageUrl(sb, clientId, order.imagePath),
  ])
  return { plan, live, imageUrl }
}

async function readLive(clientId: string, order: CreativeOrder): Promise<LiveFacts> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return { accountKnown: null, adSetStatus: null, copy: null }
  const registered = await getRegisteredAccountIds(clientId)
  if (registered.error) return { accountKnown: null, adSetStatus: null, copy: null }
  const adSet = await graphGet(`${GRAPH_BASE}/${order.adSetId}?fields=id,status,account_id&access_token=${encodeURIComponent(token)}`)
  if (!adSet) return { accountKnown: null, adSetStatus: null, copy: null }
  const accountId = typeof adSet.account_id === 'string' ? adSet.account_id : ''
  const known = accountId.length > 0
    && registered.ids.some((id) => sameAccount(id, order.adAccountId))
    && sameAccount(accountId, order.adAccountId)
  const ads = await graphGet(`${GRAPH_BASE}/${order.adSetId}/ads?fields=id,creative{object_story_spec}&limit=25&access_token=${encodeURIComponent(token)}`)
  const data = ads && Array.isArray(ads.data) ? ads.data : []
  return {
    accountKnown: known,
    adSetStatus: typeof adSet.status === 'string' ? adSet.status : null,
    copy: copyFromAds(data),
  }
}

async function factoryImageUrl(sb: SupabaseClient, clientId: string, path: string): Promise<string | null> {
  const clean = factoryImagePath(clientId, path)
  if (!clean) return null
  const bucket = sb.storage.from(FACTORY_BUCKET)
  const downloaded = await bucket.download(clean)
  if (downloaded.error || !downloaded.data || downloaded.data.size === 0) return null
  const url = bucket.getPublicUrl(clean).data.publicUrl
  return url.startsWith('https://') ? url : null
}

async function uploadImage(
  input: { accountId: string; storageUrl: string; filename: string },
  token: string,
): Promise<StepResult> {
  const uploaded = await uploadImageToMeta(input.accountId, input.storageUrl, token, input.filename)
  if (!uploaded.ok) return { ok: false, error: uploaded.error }
  if (uploaded.asset.kind !== 'image') return { ok: false, error: '上传回执不是图片。' }
  return { ok: true, id: uploaded.asset.hash }
}

async function graphCreate(path: string, fields: Record<string, string>, token: string): Promise<StepResult> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, access_token: token }).toString(),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const id = (JSON.parse(text) as { id?: unknown }).id
    if (typeof id !== 'string' || !id) return { ok: false, error: '回执里没有编号。' }
    return { ok: true, id }
  } catch {
    return { ok: false, error: '广告平台没有给出明确结果。' }
  }
}

async function graphGet(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(WRITE_TIMEOUT_MS) })
    if (!res.ok) return null
    const json = await res.json() as unknown
    return json && typeof json === 'object' ? json as Record<string, unknown> : null
  } catch {
    return null
  }
}

function sameAccount(left: string, right: string): boolean {
  const a = left.startsWith('act_') ? left.slice(4) : left
  const b = right.startsWith('act_') ? right.slice(4) : right
  return a.length > 0 && a === b
}

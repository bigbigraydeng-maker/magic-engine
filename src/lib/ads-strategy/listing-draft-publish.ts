/**
 * Upload listing creatives and build a paused ad.
 * Callers may run this only after a confirmed, unexpired card.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchPageLeadForms } from '@/lib/meta/lead-forms'
import { uploadAssetToMeta } from '@/lib/meta/asset-upload'
import { pickUsableForListing, type AssetRow } from '@/lib/assets/listing-asset-gate'
import { createDraftForApproval } from '@/lib/ads-strategy/draft-and-gate'
import {
  buildBuyerLeadDraft,
  buildSellerThruPlayDraft,
  BannedPhraseError,
  NotGroundedError,
  type BuildOptions,
} from '@/lib/ads-strategy/listing-draft-builder'
import type { ListingIntent, ListingPerformResult } from '@/lib/ads-strategy/listing-draft-card'

interface GatedAsset {
  id: string
  storageUrl: string
  mimeType: string | null
  filename?: string
}

export async function gateListingAssets(
  sb: SupabaseClient,
  clientId: string,
  listingId: string,
  assetIds: string[],
): Promise<{ ok: true; usable: GatedAsset[] } | { ok: false; status: number; body: Record<string, unknown> }> {
  const { data, error } = await sb
    .from('client_assets')
    .select('id, client_id, listing_id, source, verified_by, verified_at, archived_at, mime_type, storage_url, original_filename')
    .eq('client_id', clientId)
    .in('id', assetIds)
  if (error) return { ok: false, status: 500, body: { error: error.message, wroteMeta: false } }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const found = rows.map((row) => toAsset(row))
  const missing = assetIds.filter((id) => !found.some((asset) => asset.id === id))
  if (missing.length > 0) {
    return { ok: false, status: 404, body: { error: `有 ${missing.length} 个素材在这个客户名下找不到。`, wroteMeta: false } }
  }
  const picked = pickUsableForListing(found, listingId, clientId)
  if (picked.rejected.length > 0) {
    return {
      ok: false,
      status: 422,
      body: {
        wroteMeta: false,
        error: `有 ${picked.rejected.length} 张素材不能用于投放，这条广告不建。`,
        summary: picked.summary,
        blocked: picked.rejected.map((item) => ({
          assetId: item.asset.id,
          why: item.verdict.why,
          reasons: item.verdict.reasons,
        })),
      },
    }
  }
  const names = new Map(rows.map((row) => [String(row.id), textOf(row.original_filename)]))
  return {
    ok: true,
    usable: picked.usable.map((asset) => ({
      id: asset.id,
      storageUrl: asset.storageUrl,
      mimeType: asset.mimeType,
      filename: names.get(asset.id),
    })),
  }
}

export async function publishListingDraft(clientId: string, intent: ListingIntent): Promise<ListingPerformResult> {
  const client = await loadClient(clientId)
  if (!client) return { wroteMeta: false, error: '这个客户还没配广告账户' }
  if (client.adAccountId !== intent.adAccountId || client.pageId !== intent.pageId) {
    return { wroteMeta: false, error: '广告账户或主页已经换过了，这张卡不能用来建。' }
  }
  const gated = await gateListingAssets(supabaseAdmin, clientId, intent.listingId, intent.assetIds)
  if (!gated.ok) return { wroteMeta: false, error: String(gated.body.error ?? '素材不能用') }
  const token = await getMetaTokenForClient(clientId)
  if (!token) return { wroteMeta: false, error: '拿不到这个客户的 Meta 授权' }
  const form = await leadFormId(intent, client.pageId, token)
  if (form.error) return { wroteMeta: false, error: form.error }
  const uploaded = await uploadFirst(client.adAccountId, gated.usable, token)
  if (uploaded.error) return { wroteMeta: uploaded.wroteMeta, error: uploaded.error }
  const draft = await buildDraft(clientId, intent, client, form.leadFormId, uploaded.imageHash, uploaded.videoId)
  if (!draft.ok) return { wroteMeta: true, error: draft.error }
  try {
    const built = await createDraftForApproval(draft.draft, {
      supabase: supabaseAdmin,
      adAccountId: client.adAccountId,
      accessToken: token,
      brandRedlines: client.banned,
      expectedGeo: client.country,
      industry: client.industry,
    })
    if (built.status === 'awaiting_approval' || built.status === 'blocked') return { wroteMeta: true }
    return { wroteMeta: true, error: built.error ?? '暂停广告没有建成。' }
  } catch {
    return { wroteMeta: true, error: '暂停广告没有建成。' }
  }
}

async function leadFormId(
  intent: ListingIntent,
  pageId: string,
  token: string,
): Promise<{ leadFormId?: string; error?: string }> {
  if (intent.kind !== 'lead_form') return {}
  const { rows, error } = await fetchPageLeadForms(pageId, token)
  if (error) return { error: `读不到这个主页的表单：${error}` }
  const picked = pickForm(rows, intent.formName)
  return 'error' in picked ? { error: picked.error } : { leadFormId: picked.formId }
}

async function uploadFirst(
  adAccountId: string,
  assets: GatedAsset[],
  token: string,
): Promise<{ wroteMeta: boolean; imageHash?: string; videoId?: string; error?: string }> {
  let imageHash: string | undefined
  let videoId: string | undefined
  let wroteMeta = false
  for (const asset of assets) {
    wroteMeta = true
    const uploaded = await uploadAssetToMeta(adAccountId, {
      storageUrl: asset.storageUrl,
      mimeType: asset.mimeType,
      filename: asset.filename,
    }, token)
    if (!uploaded.ok) return { wroteMeta, error: `素材传到 Meta 失败：${uploaded.error}` }
    if (uploaded.asset.kind === 'image') imageHash ??= uploaded.asset.hash
    else videoId ??= uploaded.asset.videoId
  }
  return { wroteMeta, imageHash, videoId }
}

async function buildDraft(
  clientId: string,
  intent: ListingIntent,
  client: ClientRow,
  leadFormId: string | undefined,
  imageHash: string | undefined,
  videoId: string | undefined,
): Promise<{ ok: true; draft: Parameters<typeof createDraftForApproval>[0] } | { ok: false; error: string }> {
  const opts: BuildOptions = {
    clientId,
    pageId: client.pageId,
    lang: intent.lang,
    dailyBudget: intent.dailyBudget,
    durationDays: intent.durationDays,
    geoCountries: intent.geoCountries,
    geoCityKeys: intent.geoCityKeys,
    ageMin: intent.ageMin,
    ageMax: intent.ageMax,
    linkUrl: intent.linkUrl,
    bannedPhrases: client.banned,
    leadFormId,
    imageHash,
    videoId,
  }
  try {
    if (intent.kind === 'lead_form' && !intent.listing) return { ok: false, error: '没给房源事实' }
    const draft = intent.kind === 'lead_form' && intent.listing
      ? buildBuyerLeadDraft(intent.listing, intent.agent, opts)
      : buildSellerThruPlayDraft(intent.agent, opts)
    return { ok: true, draft }
  } catch (error) {
    if (error instanceof BannedPhraseError || error instanceof NotGroundedError) return { ok: false, error: error.message }
    throw error
  }
}

interface ClientRow {
  adAccountId: string
  pageId: string
  country: string | null
  industry: string | null
  banned: string[]
}

async function loadClient(clientId: string): Promise<ClientRow | null> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id, country, industry, brand_redline_phrases')
    .eq('id', clientId)
    .maybeSingle()
  const row = data as {
    meta_ad_account_id?: string
    facebook_page_id?: string
    country?: string | null
    industry?: string | null
    brand_redline_phrases?: string[]
  } | null
  if (!row?.meta_ad_account_id || !row.facebook_page_id) return null
  const brief = await supabaseAdmin
    .from('master_briefs')
    .select('avoid_words, excluded_topics')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle()
  const words = brief.data as { avoid_words?: string[]; excluded_topics?: string[] } | null
  const banned = [...(row.brand_redline_phrases ?? []), ...(words?.avoid_words ?? []), ...(words?.excluded_topics ?? [])]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return {
    adAccountId: row.meta_ad_account_id,
    pageId: row.facebook_page_id,
    country: row.country ?? null,
    industry: row.industry ?? null,
    banned,
  }
}

function pickForm(
  forms: { formId: string; name: string | null; status: string | null }[],
  wanted?: string,
): { formId: string } | { error: string } {
  const active = forms.filter((form) => (form.status ?? '').toUpperCase() === 'ACTIVE')
  const pool = active.length > 0 ? active : forms
  if (wanted) {
    const hit = pool.filter((form) => (form.name ?? '').includes(wanted))
    if (hit.length === 1) return { formId: hit[0].formId }
    if (hit.length === 0) return { error: `这个主页上没有名字含「${wanted}」的表单` }
    return { error: `名字含「${wanted}」的表单有 ${hit.length} 个，说清楚是哪一个` }
  }
  if (pool.length === 1) return { formId: pool[0].formId }
  if (pool.length === 0) return { error: '这个主页上一个即时表单都没有' }
  return { error: `这个主页上有 ${pool.length} 个表单，没说用哪个。` }
}

function toAsset(row: Record<string, unknown>): AssetRow {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    listingId: textOf(row.listing_id) ?? null,
    source: textOf(row.source) ?? null,
    verifiedBy: textOf(row.verified_by) ?? null,
    verifiedAt: textOf(row.verified_at) ?? null,
    archivedAt: textOf(row.archived_at) ?? null,
    mimeType: textOf(row.mime_type) ?? null,
    storageUrl: String(row.storage_url),
  }
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

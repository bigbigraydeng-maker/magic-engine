/**
 * POST /api/clients/[id]/meta-ads/draft-listing
 *
 * Checks the listing assets, then asks for the paused-draft card.
 * The upload and the paused ad are built only after that card is confirmed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { publicError } from '@/lib/confirmation-card/http'
import { askerFromAccess } from '@/lib/ads-strategy/card-asker'
import { issueListingDraftCard, listingCardDeps, type ListingIntent } from '@/lib/ads-strategy/listing-draft-card'
import { gateListingAssets } from '@/lib/ads-strategy/listing-draft-publish'
import { loadPausedDraftContext } from '@/lib/ads-strategy/paused-draft-context'
import type { AdLang, AgentFacts, ListingFacts } from '@/lib/ads-strategy/listing-draft-builder'

export const maxDuration = 30

interface Body {
  kind?: 'lead_form' | 'video_thruplay'
  lang?: AdLang
  listing?: ListingFacts
  agent?: AgentFacts
  dailyBudget?: number
  durationDays?: number
  geoCountries?: string[]
  geoCityKeys?: string[]
  ageMin?: number
  ageMax?: number
  listingId?: string
  assetIds?: string[]
  linkUrl?: string
  formName?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params
  const denied = await rejectAgentAdsBearer(req, { clientId, action: 'write_meta' })
  if (denied) return denied
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.agent) return NextResponse.json({ error: '没给中介事实（agent）', wroteMeta: false }, { status: 400 })
  const assetIds = (body.assetIds ?? []).filter((id) => typeof id === 'string' && id)
  if (assetIds.length === 0) {
    return NextResponse.json({ error: '没说用哪几张素材（assetIds）。', wroteMeta: false }, { status: 400 })
  }
  if (!body.listingId) {
    return NextResponse.json({ error: '没说这条广告是给哪套房的（listingId）。', wroteMeta: false }, { status: 400 })
  }
  const client = await loadClient(clientId)
  if (!client) return NextResponse.json({ error: '这个客户还没配广告账户或主页', wroteMeta: false }, { status: 424 })
  const gated = await gateListingAssets(supabaseAdmin, clientId, body.listingId, assetIds)
  if (!gated.ok) return NextResponse.json(gated.body, { status: gated.status })

  try {
    const intent = intentFrom(body, client, assetIds)
    const context = await loadPausedDraftContext(supabaseAdmin, clientId, client.adAccountId)
    const card = await issueListingDraftCard({
      sb: supabaseAdmin,
      clientId,
      clicker: askerFromAccess(access, clientId, req.headers.get('x-me-actor') === 'agent'),
      intent,
      accountLabel: context.accountLabel,
      deps: listingCardDeps(createKernel(supabaseAdmin)),
    })
    return NextResponse.json({ wroteMeta: false, status: 'awaiting_confirmation', card })
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message, wroteMeta: false }, { status: mapped.status })
  }
}

function intentFrom(
  body: Body,
  client: { adAccountId: string; pageId: string; country: string | null; industry: string | null },
  assetIds: string[],
): ListingIntent {
  return {
    kind: body.kind ?? 'lead_form',
    lang: body.lang ?? 'en',
    listingId: body.listingId ?? '',
    assetIds,
    listing: body.listing ?? null,
    agent: body.agent as AgentFacts,
    dailyBudget: body.dailyBudget ?? 25,
    durationDays: body.durationDays ?? 7,
    geoCountries: body.geoCountries ?? (client.country ? [client.country] : []),
    geoCityKeys: body.geoCityKeys,
    ageMin: body.ageMin,
    ageMax: body.ageMax,
    linkUrl: body.linkUrl,
    formName: body.formName,
    pageId: client.pageId,
    adAccountId: client.adAccountId,
    country: client.country,
    industry: client.industry,
  }
}

async function loadClient(clientId: string): Promise<{
  adAccountId: string
  pageId: string
  country: string | null
  industry: string | null
} | null> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id, country, industry')
    .eq('id', clientId)
    .maybeSingle()
  const row = data as {
    meta_ad_account_id?: string
    facebook_page_id?: string
    country?: string | null
    industry?: string | null
  } | null
  if (!row?.meta_ad_account_id || !row.facebook_page_id) return null
  return {
    adAccountId: row.meta_ad_account_id,
    pageId: row.facebook_page_id,
    country: row.country ?? null,
    industry: row.industry ?? null,
  }
}

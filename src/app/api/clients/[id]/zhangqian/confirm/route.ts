/**
 * PATCH /api/clients/[id]/zhangqian/confirm
 *
 * Fires when a user approves the Zhangqian discovery report. Writes discovered
 * data back into operational tables (clients + keywords) and stamps the
 * discovery row as confirmed.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'
import { syncAiTrackerQuestions } from '@/lib/zhangqian/sync-ai-visibility'
import { getActiveBrief } from '@/lib/content/brief-injector'
import type { DiscoveredCompetitor, DiscoveryReport, KeywordType } from '@/lib/zhangqian/types'

// ─── Request body types ───────────────────────────────────────────────────────

interface BusinessPatch {
  name?: string
  description?: string
  instagram_handle?: string
  facebook_page_url?: string
  tiktok_handle?: string
}

interface KeywordInput {
  keyword: string
  type: KeywordType
  estimated_volume?: number | null
}

interface ConfirmBody {
  confirmed_by: string
  business?: BusinessPatch
  keywords?: KeywordInput[]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const body = (await req.json()) as ConfirmBody

    const discovery = await getLatestDiscovery(supabaseAdmin, clientId)
    if (!discovery) {
      return NextResponse.json({ error: 'No discovery found for this client' }, { status: 404 })
    }
    if (discovery.confirmed_at !== null) {
      return NextResponse.json({ success: true, already_confirmed: true })
    }

    const clientUpdated = await applyBusinessPatch(clientId, body.business)
    const keywordsAdded = await upsertKeywords(clientId, body.keywords)
    await stampConfirmed(discovery.id, body.confirmed_by)

    // Bridge to AI Visibility — sync Zhangqian's ai_tracker_questions into
    // the AI Visibility queries table. Non-fatal: a sync failure must not
    // block the user's discovery confirmation.
    let aiVisibilityQueriesAdded = 0
    try {
      aiVisibilityQueriesAdded = await syncAiTrackerQuestions(
        supabaseAdmin,
        clientId,
        discovery.payload,
      )
    } catch (syncErr) {
      console.error('[zhangqian/confirm] AI Visibility sync failed (non-fatal)', syncErr)
    }

    // Merge discovered competitors into the active master brief. Non-fatal.
    let competitorsMerged = 0
    try {
      competitorsMerged = await mergeCompetitorsIntoBrief(clientId, discovery.payload as DiscoveryReport)
    } catch (mergeErr) {
      console.error('[zhangqian/confirm] competitor merge failed (non-fatal)', mergeErr)
    }

    return NextResponse.json({
      success: true,
      keywords_added: keywordsAdded,
      client_updated: clientUpdated,
      ai_visibility_queries_added: aiVisibilityQueriesAdded,
      competitors_merged: competitorsMerged,
    })
  } catch (err: unknown) {
    console.error('[zhangqian/confirm] error', err)
    return NextResponse.json({ success: false, error: 'Failed to confirm discovery' }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function applyBusinessPatch(
  clientId: string,
  business: BusinessPatch | undefined,
): Promise<boolean> {
  if (!business) return false

  const patch: Record<string, string> = {}
  if (business.name !== undefined) patch.name = business.name
  if (business.description !== undefined) patch.description = business.description
  if (business.instagram_handle !== undefined) patch.instagram_handle = business.instagram_handle
  if (business.facebook_page_url !== undefined) patch.facebook_page_url = business.facebook_page_url
  if (business.tiktok_handle !== undefined) patch.tiktok_handle = business.tiktok_handle

  if (Object.keys(patch).length === 0) return false

  const { error } = await supabaseAdmin.from('clients').update(patch).eq('id', clientId)
  if (error) throw new Error(`Failed to update client: ${error.message}`)
  return true
}

async function upsertKeywords(
  clientId: string,
  keywords: KeywordInput[] | undefined,
): Promise<number> {
  if (!keywords || keywords.length === 0) return 0

  const rows = keywords.map((kw) => ({
    client_id: clientId,
    keyword: kw.keyword,
    status: 'pending' as const,
    source: 'zhangqian' as const,
    volume: kw.estimated_volume ?? 0,
    intent: kw.type === 'transactional' ? ('transactional' as const) : ('informational' as const),
    kd: 0,
    cpc: 0,
    opportunity_score: 50,
  }))

  const { error } = await supabaseAdmin
    .from('keywords')
    .upsert(rows, { onConflict: 'client_id,keyword' })

  if (error) throw new Error(`Failed to upsert keywords: ${error.message}`)
  return rows.length
}

async function stampConfirmed(discoveryId: string, confirmedBy: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('client_discovery')
    .update({ confirmed_at: new Date().toISOString(), confirmed_by: confirmedBy })
    .eq('id', discoveryId)

  if (error) throw new Error(`Failed to stamp confirmation: ${error.message}`)
}

// Generic high-traffic domains that are not real business competitors
const COMPETITOR_BLOCKLIST = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com',
  'reddit.com', 'linkedin.com', 'pinterest.com', 'tiktok.com',
  'google.com', 'google.com.au', 'google.co.nz',
  'wikipedia.org', 'amazon.com', 'amazon.com.au', 'ebay.com', 'ebay.com.au',
  'tripadvisor.com', 'tripadvisor.com.au', 'tripadvisor.co.nz',
  'booking.com', 'expedia.com', 'expedia.com.au', 'airbnb.com',
])

/**
 * Merges Zhangqian-discovered competitors (direct + adjacent) into the active
 * master brief's competitor_domains. Preserves any manually entered domains.
 * Returns the number of new domains added.
 */
async function mergeCompetitorsIntoBrief(
  clientId: string,
  payload: DiscoveryReport,
): Promise<number> {
  const activeBrief = await getActiveBrief(clientId)
  if (!activeBrief) return 0

  const discovered = (payload.competitors ?? [])
    .filter((c: DiscoveredCompetitor) => c.relevance === 'direct' || c.relevance === 'adjacent')
    .map((c: DiscoveredCompetitor) => c.domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase())
    .filter((d: string) => !COMPETITOR_BLOCKLIST.has(d))

  if (discovered.length === 0) return 0

  const existing: string[] = ((activeBrief.competitor_domains as string[] | null) ?? [])
    .map((d: string) => d.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase())

  const existingSet = new Set(existing)
  const toAdd = discovered.filter(d => !existingSet.has(d))
  if (toAdd.length === 0) return 0

  const merged = [...existing, ...toAdd]

  const { error } = await supabaseAdmin
    .from('master_briefs')
    .update({ competitor_domains: merged })
    .eq('id', activeBrief.id)

  if (error) throw new Error(`Failed to update brief competitor_domains: ${error.message}`)
  return toAdd.length
}

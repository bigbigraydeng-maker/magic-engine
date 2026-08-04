/**
 * PATCH /api/clients/[id]/zhangqian/confirm
 *
 * Fires when a user approves the Zhangqian discovery report. Writes discovered
 * data back into operational tables (clients + master_briefs) and stamps the
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
import { newSeedKeywords, mergedSeedKeywords, shouldBackfillSeeds } from '@/lib/zhangqian/seed-keywords'
import type { DiscoveredCompetitor, DiscoveryReport } from '@/lib/zhangqian/types'

// ─── Request body types ───────────────────────────────────────────────────────

interface BusinessPatch {
  name?: string
  description?: string
  instagram_handle?: string
  facebook_page_url?: string
  tiktok_handle?: string
}

interface ConfirmBody {
  confirmed_by: string
  business?: BusinessPatch
  // No `keywords` field: seed keywords are read from the stored discovery
  // payload, not resent by the caller. The old field was never populated by
  // any caller and wrote to a table that no longer exists.
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
    // Seed keywords are merged on EVERY confirm, repeats included — deliberately
    // above the already_confirmed short-circuit. The merge is idempotent by
    // construction (newSeedKeywords dedupes against what is stored), and this is
    // the only route by which a client that had no brief at first confirm can
    // ever receive its seeds: running discovery before the brief exists is a
    // normal onboarding order, and 3 of 13 confirmed discoveries in production
    // are in exactly that state. Below the short-circuit, one failure would be
    // permanent — the button can never be pressed a second time.
    let keywordsAdded = 0
    let seedKeywordsPending = false
    try {
      const merged = await mergeSeedKeywordsIntoBrief(
        clientId,
        discovery.payload as DiscoveryReport,
        discovery.confirmed_at,
      )
      keywordsAdded = merged.added
      seedKeywordsPending = merged.noActiveBrief
    } catch (seedErr) {
      console.error('[zhangqian/confirm] seed keyword merge failed (non-fatal)', seedErr)
      seedKeywordsPending = true
    }

    if (discovery.confirmed_at !== null) {
      return NextResponse.json({
        success: true,
        already_confirmed: true,
        keywords_added: keywordsAdded,
        seed_keywords_pending: seedKeywordsPending,
      })
    }

    const clientUpdated = await applyBusinessPatch(clientId, body.business)
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
      seed_keywords_pending: seedKeywordsPending,
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

/**
 * Merges Zhangqian's discovered seed keywords into the active master brief's
 * keyword_seeds. Preserves anything already there. Returns how many are new.
 *
 * 🔴 Why the brief and not clients.primary_keywords — src/lib/keywords/resolver.ts
 *    defines two layers: clients.primary_keywords is the FDE's hand-picked
 *    authoritative list, master_briefs.keyword_seeds is the discovery-inferred
 *    one, and the FDE layer always wins on read. Writing discovery output into
 *    the FDE layer would silently overwrite hand-picked keywords, and the
 *    resolver explicitly prohibits direct writes to it outside
 *    PATCH /api/clients/[id]/primary-keywords.
 *
 * Only the keyword strings move across. The volume / kd numbers on these rows
 * are the agent's own guesses — some payload rationales say so in as many words
 * ("DataForSEO returned empty, values are inferred") — and persisting a guess
 * as if it were measured is what the client-data rule forbids. Real volumes
 * arrive later from the weekly keyword_snapshots run.
 *
 * (This replaces an `upsertKeywords` that wrote to the `keywords` table,
 * archived on 2026-05-30. It was unreachable dead code — the UI has only ever
 * sent `confirmed_by` — so Zhangqian's keywords went nowhere at all.)
 */
async function mergeSeedKeywordsIntoBrief(
  clientId: string,
  payload: DiscoveryReport,
  confirmedAt: string | null,
): Promise<{ added: number; noActiveBrief: boolean }> {
  const activeBrief = await getActiveBrief(clientId)
  // "No brief yet" is reported, not swallowed: it looks identical to "no new
  // keywords" from the outside, and a discovery result that only shows up in a
  // server log is a discovery that nobody will ever act on. The seeds are not
  // lost either way — they stay in client_discovery.payload, the brief-creation
  // form reads them straight from there, and confirming again backfills.
  if (!activeBrief) return { added: 0, noActiveBrief: true }

  // On a repeat confirm, write only when the brief is newer than the
  // confirmation — see shouldBackfillSeeds. Otherwise a second click would
  // resurrect keywords the FDE removed on purpose.
  if (!shouldBackfillSeeds({ confirmedAt, briefCreatedAt: activeBrief.created_at as string | null })) {
    return { added: 0, noActiveBrief: false }
  }

  const existing = (activeBrief.keyword_seeds as string[] | null) ?? []
  const toAdd = newSeedKeywords(payload.seed_keywords, existing)
  if (toAdd.length === 0) return { added: 0, noActiveBrief: false }

  const { error } = await supabaseAdmin
    .from('master_briefs')
    .update({ keyword_seeds: mergedSeedKeywords(payload.seed_keywords, existing) })
    .eq('id', activeBrief.id)

  if (error) throw new Error(`Failed to update brief keyword_seeds: ${error.message}`)
  return { added: toAdd.length, noActiveBrief: false }
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

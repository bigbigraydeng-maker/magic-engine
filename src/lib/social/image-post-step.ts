/**
 * Self-contained Inngest step that drafts image posts for one client on one date.
 *
 * Called from the weekly-draft handleDue as a single step.  Loads its own data
 * (tours, assets, recent slugs, campaign, settings) so the caller only passes
 * clientId + date + a small deps bag.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import { loadRankableClientAssets } from '@/lib/factory/client-asset-pool'
import { getActiveCampaigns } from '@/lib/content/campaign-injector'
import { readSocialAgentSettings } from '@/lib/social/recipe/tier-defaults'
import { checkFacts } from '@/lib/social/weekly-loop/fact-check'
import { scanOutboundClaims } from '@/lib/social/outbound-claims'
import { draftImagePost } from './image-post-drafter'
import { writeImagePostPlan } from './image-post-plan-writer'
import { generateImagePostCopy } from './image-post-generate-copy'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImagePostStepDeps {
  supabase: SupabaseClient
  callLLM: (prompt: string) => Promise<string>
}

export interface ImagePostStepReceipt {
  attempted: number
  drafted: number
  planIds: string[]
  skipped: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Recent-slugs loader
// ---------------------------------------------------------------------------

async function loadRecentImagePostSlugs(
  supabase: SupabaseClient,
  clientId: string,
  sinceDays: number,
): Promise<string[]> {
  const since = new Date()
  since.setDate(since.getDate() - sinceDays)

  const { data } = await supabase
    .from('social_plans')
    .select('plan_data')
    .eq('client_id', clientId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(30)

  if (!data) return []

  const slugs: string[] = []
  for (const row of data) {
    const pd = row.plan_data as Record<string, unknown> | null
    if (!pd) continue
    const meta = pd.command_meta as Record<string, unknown> | undefined
    if (meta?.source !== 'auto_image_post') continue
    const summary = typeof meta.raw_summary === 'string' ? meta.raw_summary : ''
    const match = summary.match(/tour "([^"]+)"/)
    if (match) slugs.push(match[1])
  }
  return slugs
}

// ---------------------------------------------------------------------------
// Step entry point
// ---------------------------------------------------------------------------

export async function runImagePostStep(
  clientId: string,
  date: string,
  clientConfig: unknown,
  planTier: unknown,
  deps: ImagePostStepDeps,
): Promise<ImagePostStepReceipt> {
  const settings = readSocialAgentSettings(clientConfig, planTier)
  if (settings.imagePostPerDay <= 0) {
    return { attempted: 0, drafted: 0, planIds: [], skipped: 'imagePostPerDay=0', error: null }
  }

  // Load published tour catalog
  const tourRead = await loadPublishedTourFacts(deps.supabase, clientId, date)
  if (!tourRead.published || tourRead.tours.length === 0) {
    return { attempted: 0, drafted: 0, planIds: [], skipped: 'no_published_tours', error: null }
  }

  // Load client assets
  const assets = await loadRankableClientAssets(clientId, deps.supabase)
  if (assets.length === 0) {
    return { attempted: 0, drafted: 0, planIds: [], skipped: 'no_client_assets', error: null }
  }

  // Find active campaign
  const campaigns = await getActiveCampaigns(clientId)
  if (campaigns.length === 0) {
    return { attempted: 0, drafted: 0, planIds: [], skipped: 'no_active_campaign', error: null }
  }
  const campaignId = campaigns[0].id

  // Load recent slugs to avoid repetition
  const recentSlugs = await loadRecentImagePostSlugs(deps.supabase, clientId, 7)

  // Draft
  const ctaBaseUrl = `https://www.ctstours.co.nz/tours`
  const drafterDeps = {
    generateCopy: (tour: Parameters<typeof generateImagePostCopy>[0], asset: Parameters<typeof generateImagePostCopy>[1]) =>
      generateImagePostCopy(tour, asset, { callLLM: deps.callLLM }),
    checkFacts,
    scanOutboundClaims,
  }

  const planIds: string[] = []
  const count = settings.imagePostPerDay

  for (let i = 0; i < count; i++) {
    const result = await draftImagePost(
      {
        clientId,
        date,
        tours: tourRead.tours,
        assets,
        recentTourSlugs: [...recentSlugs, ...planIds.map(() => '')],
        ctaBaseUrl,
      },
      drafterDeps,
    )

    if (!result.ok) {
      return { attempted: i + 1, drafted: planIds.length, planIds, skipped: null, error: result.reason }
    }

    const writeResult = await writeImagePostPlan(
      { clientId, campaignId, date, draft: result.draft, tourSlug: result.tourSlug },
      {
        insertPlan: async (row) => {
          const { data, error } = await deps.supabase
            .from('social_plans')
            .insert({
              client_id: row.client_id,
              campaign_id: row.campaign_id,
              platform: row.platform,
              wave_number: row.wave_number,
              plan_data: row.plan_data,
            })
            .select('id')
            .single()
          if (error) throw new Error(error.message)
          return { id: data.id }
        },
      },
    )

    if (!writeResult.ok) {
      return { attempted: i + 1, drafted: planIds.length, planIds, skipped: null, error: writeResult.error }
    }

    planIds.push(writeResult.planId)
    recentSlugs.push(result.tourSlug)
  }

  return { attempted: count, drafted: planIds.length, planIds, skipped: null, error: null }
}

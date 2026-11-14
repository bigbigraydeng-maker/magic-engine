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
import { getActiveBrief } from '@/lib/content/brief-injector'
import { uploadFromUrl } from '@/lib/visual/storage'
import { runImageEdit } from '@/lib/visual/image-edit'
import { readPosterText } from '@/lib/visual/poster-text-reader'
import { readPosterLineage } from '@/lib/assets/provenance'
import { readPosterBrand, resolvePosterRecipe } from '@/lib/visual/poster-recipe'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'
import {
  composeTourPoster,
  type ComposeTourPosterDeps,
  type ComposeTourPosterResult,
  type PosterReceipt,
} from './image-post-poster'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImagePostStepDeps {
  supabase: SupabaseClient
  callLLM: (prompt: string) => Promise<string>
  /** Test seam for the poster recipe. Production leaves it unset and real deps are built. */
  poster?: {
    loadBrief?: (clientId: string) => Promise<{ vi_colors?: unknown; website?: unknown } | null>
    compose?: Partial<ComposeTourPosterDeps>
  }
}

export interface ImagePostStepReceipt {
  attempted: number
  drafted: number
  planIds: string[]
  skipped: string | null
  error: string | null
  /** Only when a poster recipe is on: one entry per poster attempt (composed or fallback + reason). */
  posters?: PosterReceipt[]
  /** Only when a poster recipe is on: summed provider cost of every attempt, failed ones included. */
  posterCostUsd?: number
}

// ---------------------------------------------------------------------------
// Poster recipe wiring (opt-in via social_agent.image_post_recipe)
// ---------------------------------------------------------------------------

type ComposePoster = (tour: PublishedTourFact, image: RankableAssetRow) => Promise<ComposeTourPosterResult>

async function buildPosterComposer(
  recipeId: unknown,
  clientId: string,
  date: string,
  deps: ImagePostStepDeps,
): Promise<ComposePoster | null> {
  const recipe = resolvePosterRecipe(recipeId)
  if (!recipe) return null

  // Brief loaded once per step. A read failure = no brand colour = every attempt falls back.
  const loadBrief = deps.poster?.loadBrief ?? getActiveBrief
  const brief = await loadBrief(clientId).catch(() => null)
  const brand = readPosterBrand(brief?.vi_colors ?? null)
  const website = typeof brief?.website === 'string' ? brief.website : null

  const composeDeps: ComposeTourPosterDeps = {
    runImageEdit: (req) => runImageEdit(req),
    uploadFromUrl: (params) => uploadFromUrl(params),
    readPosterText: (url) => readPosterText(url),
    findExistingPoster: (q) => findExistingPoster(deps.supabase, q),
    insertPosterAsset: async (row) => {
      // client_id pinned to this step's client, whatever the row says.
      const { data, error } = await deps.supabase
        .from('client_assets')
        .insert({ ...row, client_id: clientId })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return { id: (data as { id: string }).id }
    },
    ...deps.poster?.compose,
  }
  return (tour, asset) => composeTourPoster({ clientId, date, tour, asset, recipe, brand, website }, composeDeps)
}

/** Same client + same generated filename (recipe/tour/date) + same source photo + same recipe version. */
async function findExistingPoster(
  supabase: SupabaseClient,
  q: { clientId: string; originalFilename: string; sourceAssetId: string; recipeId: string; recipeVersion: number },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('client_assets')
    .select('id, vision_metadata')
    .eq('client_id', q.clientId)
    .eq('original_filename', q.originalFilename)
    .is('archived_at', null)
    .limit(10)
  if (error) throw new Error(error.message)
  const hit = ((data ?? []) as Array<{ id: string; vision_metadata: unknown }>).find((row) => {
    const lineage = readPosterLineage(row.vision_metadata)
    return lineage !== null &&
      lineage.source_asset_id === q.sourceAssetId &&
      lineage.recipe_id === q.recipeId &&
      lineage.recipe_version === q.recipeVersion
  })
  return hit ? { id: hit.id } : null
}

function withPosters(
  receipt: ImagePostStepReceipt,
  posters: PosterReceipt[] | null,
): ImagePostStepReceipt {
  if (!posters) return receipt
  // Image-edit spend plus text read-back spend, failed attempts included.
  const posterCostUsd = posters.reduce((sum, p) => sum + (p.cost_usd ?? 0) + (p.text_check?.cost_usd ?? 0), 0)
  return { ...receipt, posters, posterCostUsd: Math.round(posterCostUsd * 1e6) / 1e6 }
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

  // Load client assets (the shared pool already leaves AI posters out — no poster-of-a-poster).
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
  const composePoster = settings.imagePostRecipe
    ? await buildPosterComposer(settings.imagePostRecipe, clientId, date, deps)
    : null
  const drafterDeps = {
    generateCopy: (tour: Parameters<typeof generateImagePostCopy>[0], asset: Parameters<typeof generateImagePostCopy>[1]) =>
      generateImagePostCopy(tour, asset, { callLLM: deps.callLLM }),
    checkFacts,
    scanOutboundClaims,
    ...(composePoster ? { composePoster } : {}),
  }

  const planIds: string[] = []
  const posters: PosterReceipt[] | null = composePoster ? [] : null
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
      return withPosters({ attempted: i + 1, drafted: planIds.length, planIds, skipped: null, error: result.reason }, posters)
    }
    if (result.poster) posters?.push(result.poster)

    const writeResult = await writeImagePostPlan(
      { clientId, campaignId, date, draft: result.draft, tourSlug: result.tourSlug, poster: result.poster },
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
      return withPosters({ attempted: i + 1, drafted: planIds.length, planIds, skipped: null, error: writeResult.error }, posters)
    }

    planIds.push(writeResult.planId)
    recentSlugs.push(result.tourSlug)
  }

  return withPosters({ attempted: count, drafted: planIds.length, planIds, skipped: null, error: null }, posters)
}

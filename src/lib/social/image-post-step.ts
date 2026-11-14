/**
 * Drafts image posts for one client.
 * With a weekly count and a target week, spreads that many drafts across the week.
 * Otherwise keeps the existing one-day path.
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
import {
  autoImagePostDate,
  datesStillNeeded,
  decideImagePostBatch,
  type ImagePostBatch,
  type WeekWindow,
} from './image-post-week'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImagePostStepDeps {
  supabase: SupabaseClient
  callLLM: (prompt: string) => Promise<string>
  /** Target week. When set together with a weekly count, drafts are spread across that week. */
  week?: WeekWindow | null
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
  /** Dates of the drafts written in this call, same order as planIds. */
  dates: string[]
  /** Weekly count this call was aiming at. Absent on the per-day path. */
  requested?: number
  /** Every auto image post on the target week after this call. Week mode only. */
  weekLines?: Array<{ date: string; ref: string }>
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
  const batch = decideImagePostBatch({ config: clientConfig, week: deps.week ?? null })
  const weekDates = await weekDatesToDraft(deps, clientId, batch)
  if (weekDates.receipt) return weekDates.receipt

  const settings = readSocialAgentSettings(clientConfig, planTier)
  const dates = weekDates.dates ?? (settings.imagePostPerDay > 0 ? Array.from({ length: settings.imagePostPerDay }, () => date) : [])
  if (dates.length === 0) {
    return { attempted: 0, drafted: 0, planIds: [], dates: [], skipped: 'imagePostPerDay=0', error: null }
  }

  const requested = batch.action === 'week' ? batch.requested : undefined
  const catalogDate = weekDates.dates ? weekDates.catalogDate : date
  const written = await writeImageDrafts(clientId, dates, catalogDate, settings.imagePostRecipe, requested, deps)
  if (!weekDates.existing) return written
  return {
    ...written,
    weekLines: [...weekDates.existing.lines, ...written.dates.map((date, i) => ({ date, ref: written.planIds[i] ?? '' }))],
  }
}

async function weekDatesToDraft(
  deps: ImagePostStepDeps,
  clientId: string,
  batch: ImagePostBatch,
): Promise<{ dates?: string[]; catalogDate: string; existing?: ExistingPosts; receipt?: ImagePostStepReceipt }> {
  if (batch.action === 'day') return { catalogDate: '' }
  if (batch.action === 'week-skip') {
    return { catalogDate: '', receipt: emptyImageReceipt(batch.skipped, null, batch.requested ?? undefined) }
  }
  const existing = await loadAutoImagePosts(deps.supabase, clientId, batch)
  if (existing === 'unreadable') {
    return { catalogDate: batch.weekStart, receipt: emptyImageReceipt(null, 'existing_posts_unreadable', batch.requested) }
  }
  const dates = datesStillNeeded(batch.dates, existing.counts)
  if (dates.length === 0) {
    return {
      catalogDate: batch.weekStart,
      receipt: { ...emptyImageReceipt('already_drafted', null, batch.requested), weekLines: existing.lines },
    }
  }
  return { dates, catalogDate: batch.weekStart, existing }
}

function emptyImageReceipt(skipped: string | null, error: string | null, requested?: number): ImagePostStepReceipt {
  const receipt: ImagePostStepReceipt = { attempted: 0, drafted: 0, planIds: [], dates: [], skipped, error }
  if (requested !== undefined) receipt.requested = requested
  return receipt
}

interface ExistingPosts {
  counts: Map<string, number>
  lines: Array<{ date: string; ref: string }>
}

async function loadAutoImagePosts(
  supabase: SupabaseClient,
  clientId: string,
  week: WeekWindow,
): Promise<ExistingPosts | 'unreadable'> {
  const { data, error } = await supabase
    .from('social_plans')
    .select('id, plan_data')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return 'unreadable'
  const counts = new Map<string, number>()
  const lines: Array<{ date: string; ref: string }> = []
  for (const row of data ?? []) {
    const rec = recordOf(row)
    const date = autoImagePostDate(rec?.plan_data, week)
    if (!date) continue
    counts.set(date, (counts.get(date) ?? 0) + 1)
    lines.push({ date, ref: typeof rec?.id === 'string' ? rec.id : '' })
  }
  return { counts, lines }
}

function recordOf(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

async function writeImageDrafts(
  clientId: string,
  dates: string[],
  catalogDate: string,
  recipeId: ReturnType<typeof readSocialAgentSettings>['imagePostRecipe'],
  requested: number | undefined,
  deps: ImagePostStepDeps,
): Promise<ImagePostStepReceipt> {
  const tourRead = await loadPublishedTourFacts(deps.supabase, clientId, catalogDate)
  if (!tourRead.published || tourRead.tours.length === 0) return emptyImageReceipt('no_published_tours', null, requested)
  const assets = await loadRankableClientAssets(clientId, deps.supabase)
  if (assets.length === 0) return emptyImageReceipt('no_client_assets', null, requested)
  const campaigns = await getActiveCampaigns(clientId)
  if (campaigns.length === 0) return emptyImageReceipt('no_active_campaign', null, requested)
  return draftEachDate(clientId, dates, tourRead.tours, assets, campaigns[0].id, recipeId, requested, deps)
}

async function draftEachDate(
  clientId: string,
  dates: string[],
  tours: PublishedTourFact[],
  assets: Awaited<ReturnType<typeof loadRankableClientAssets>>,
  campaignId: string,
  recipeId: ReturnType<typeof readSocialAgentSettings>['imagePostRecipe'],
  requested: number | undefined,
  deps: ImagePostStepDeps,
): Promise<ImagePostStepReceipt> {
  const recentSlugs = await loadRecentImagePostSlugs(deps.supabase, clientId, 7)
  const planIds: string[] = []
  const draftedDates: string[] = []
  let posters: PosterReceipt[] | null = null
  const copyDeps = {
    generateCopy: (tour: Parameters<typeof generateImagePostCopy>[0], asset: Parameters<typeof generateImagePostCopy>[1]) =>
      generateImagePostCopy(tour, asset, { callLLM: deps.callLLM }),
    checkFacts,
    scanOutboundClaims,
  }
  for (let i = 0; i < dates.length; i++) {
    const slotDate = dates[i]
    const composePoster = recipeId ? await buildPosterComposer(recipeId, clientId, slotDate, deps) : null
    if (composePoster && posters === null) posters = []
    const result = await draftImagePost(
      { clientId, date: slotDate, tours, assets, recentTourSlugs: [...recentSlugs], ctaBaseUrl: 'https://www.ctstours.co.nz/tours' },
      { ...copyDeps, ...(composePoster ? { composePoster } : {}) },
    )
    if (!result.ok) return finishDraft(i + 1, planIds, draftedDates, null, result.reason, posters, requested)
    if (result.poster) posters?.push(result.poster)
    const writeResult = await writeImagePostPlan(
      { clientId, campaignId, date: slotDate, draft: result.draft, tourSlug: result.tourSlug, poster: result.poster },
      { insertPlan: (row) => insertSocialPlan(deps.supabase, row) },
    )
    if (!writeResult.ok) return finishDraft(i + 1, planIds, draftedDates, null, writeResult.error, posters, requested)
    planIds.push(writeResult.planId)
    draftedDates.push(slotDate)
    recentSlugs.push(result.tourSlug)
  }
  return finishDraft(dates.length, planIds, draftedDates, null, null, posters, requested)
}

function finishDraft(
  attempted: number,
  planIds: string[],
  dates: string[],
  skipped: string | null,
  error: string | null,
  posters: PosterReceipt[] | null,
  requested: number | undefined,
): ImagePostStepReceipt {
  const receipt: ImagePostStepReceipt = { attempted, drafted: planIds.length, planIds, dates, skipped, error }
  if (requested !== undefined) receipt.requested = requested
  return withPosters(receipt, posters)
}

async function insertSocialPlan(
  supabase: SupabaseClient,
  row: { client_id: string; campaign_id: string; platform: string; wave_number: number; plan_data: unknown },
): Promise<{ id: string }> {
  const { data, error } = await supabase
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
  return { id: (data as { id: string }).id }
}

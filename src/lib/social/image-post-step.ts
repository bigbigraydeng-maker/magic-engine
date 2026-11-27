/**
 * Drafts image posts for one client.
 * With a weekly count and a target week, spreads that many drafts across the week.
 * Otherwise keeps the existing one-day path.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import { loadFactoryStills, type FactoryStill } from '@/lib/factory/still-library'
import { gateReusedStillText, loadStillRedlines } from '@/lib/factory/still-review'
import { getActiveCampaigns } from '@/lib/content/campaign-injector'
import { readSocialAgentSettings } from '@/lib/social/recipe/tier-defaults'
import { checkFacts } from '@/lib/social/weekly-loop/fact-check'
import { scanOutboundClaims } from '@/lib/social/outbound-claims'
import { draftImagePost } from './image-post-drafter'
import { writeImagePostPlan } from './image-post-plan-writer'
import { generateImagePostCopy } from './image-post-generate-copy'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'
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
  const written = await writeImageDrafts(clientId, dates, catalogDate, requested, deps)
  if (!weekDates.existing) return written
  return {
    ...written,
    weekLines: [...weekDates.existing.lines, ...written.dates.map((slot, i) => ({ date: slot, ref: written.planIds[i] ?? '' }))],
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
  requested: number | undefined,
  deps: ImagePostStepDeps,
): Promise<ImagePostStepReceipt> {
  const stills = await loadFactoryStills(deps.supabase, clientId)
  if (stills === 'unreadable') return emptyImageReceipt('factory_stills_unreadable', null, requested)
  const chosen = postStillsFor(dates, stills)
  if (chosen.size === 0) return emptyImageReceipt('no_factory_still', null, requested)
  const redlines = await loadStillRedlines(deps.supabase, clientId)
  if (!redlines) return emptyImageReceipt(null, 'redline_unreadable', requested)
  const tourRead = await loadPublishedTourFacts(deps.supabase, clientId, catalogDate)
  if (!tourRead.published || tourRead.tours.length === 0) return emptyImageReceipt('no_published_tours', null, requested)
  const campaigns = await getActiveCampaigns(clientId)
  if (campaigns.length === 0) return emptyImageReceipt('no_active_campaign', null, requested)
  const campaign = campaigns[0]
  if (!campaign) return emptyImageReceipt('no_active_campaign', null, requested)
  return draftEachDate(clientId, dates, tourRead.tours, chosen, campaign.id, redlines, requested, deps)
}

function postStillsFor(dates: string[], stills: FactoryStill[]): Map<string, FactoryStill> {
  const chosen = new Map<string, FactoryStill>()
  for (const date of dates) {
    const hit = stills.find((still) => still.role === 'post' && still.aspect === '4:5' && still.slotDate === date && still.reviewVerdict === 'pass')
    if (hit) chosen.set(date, hit)
  }
  return chosen
}

async function draftEachDate(
  clientId: string,
  dates: string[],
  tours: PublishedTourFact[],
  stills: Map<string, FactoryStill>,
  campaignId: string,
  redlines: { phrases: string[]; topics: string[] },
  requested: number | undefined,
  deps: ImagePostStepDeps,
): Promise<ImagePostStepReceipt> {
  const recentSlugs = await loadRecentImagePostSlugs(deps.supabase, clientId, 7)
  const planIds: string[] = []
  const draftedDates: string[] = []
  const copyDeps = {
    generateCopy: (tour: Parameters<typeof generateImagePostCopy>[0], asset: Parameters<typeof generateImagePostCopy>[1]) =>
      generateImagePostCopy(tour, asset, { callLLM: deps.callLLM }),
    checkFacts,
    scanOutboundClaims,
  }
  for (const slotDate of dates) {
    const still = stills.get(slotDate)
    if (!still) continue
    const printed = blockReusedText(still, [], redlines)
    if (printed) return finishDraft(planIds.length + 1, planIds, draftedDates, null, printed, requested)
    const result = await draftLockedStill(clientId, slotDate, tours, still, recentSlugs, copyDeps)
    if (result === 'still_tour_unreadable') {
      return finishDraft(planIds.length + 1, planIds, draftedDates, null, 'still_tour_unreadable', requested)
    }
    if (!result.ok) return finishDraft(planIds.length + 1, planIds, draftedDates, null, result.reason, requested)
    const captionHit = blockReusedText(still, [result.draft.hook, result.draft.body, result.draft.cta], redlines)
    if (captionHit) return finishDraft(planIds.length + 1, planIds, draftedDates, null, captionHit, requested)
    const writeResult = await writeImagePostPlan(
      { clientId, campaignId, date: slotDate, draft: result.draft, tourSlug: result.tourSlug, poster: result.poster },
      { insertPlan: (row) => insertSocialPlan(deps.supabase, row) },
    )
    if (!writeResult.ok) return finishDraft(planIds.length + 1, planIds, draftedDates, null, writeResult.error, requested)
    planIds.push(writeResult.planId)
    draftedDates.push(slotDate)
    recentSlugs.push(result.tourSlug)
  }
  if (planIds.length === 0) return emptyImageReceipt('no_factory_still', null, requested)
  return finishDraft(dates.length, planIds, draftedDates, null, null, requested)
}

function draftLockedStill(
  clientId: string,
  date: string,
  tours: PublishedTourFact[],
  still: FactoryStill,
  recentSlugs: string[],
  deps: Parameters<typeof draftImagePost>[1],
) {
  const tour = tours.find((item) => item.id === still.tourId)
  if (!tour) return 'still_tour_unreadable' as const
  return draftImagePost({
    clientId,
    date,
    tours,
    assets: [stillAsset(still, tour)],
    recentTourSlugs: recentSlugs,
    ctaBaseUrl: 'https://www.ctstours.co.nz/tours',
    lockedTourId: tour.id,
  }, deps)
}

function blockReusedText(
  still: FactoryStill,
  extra: string[],
  redlines: { phrases: string[]; topics: string[] },
): 'overlay_unreadable' | 'brand_redline_hit' | null {
  const gate = gateReusedStillText(still.overlayLines, extra, redlines.phrases, redlines.topics)
  return gate === 'ok' ? null : gate
}

function stillAsset(still: FactoryStill, tour: PublishedTourFact): RankableAssetRow {
  return {
    id: still.id,
    storage_url: still.storageUrl,
    original_filename: `${still.slotDate}.jpg`,
    vision_metadata: {
      destination: tour.destination,
      highlights: tour.highlights,
      factory_still: { tour_id: tour.id },
    },
    source: 'ai_generated',
  }
}

function finishDraft(
  attempted: number,
  planIds: string[],
  dates: string[],
  skipped: string | null,
  error: string | null,
  requested: number | undefined,
): ImagePostStepReceipt {
  const receipt: ImagePostStepReceipt = { attempted, drafted: planIds.length, planIds, dates, skipped, error }
  if (requested !== undefined) receipt.requested = requested
  return receipt
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

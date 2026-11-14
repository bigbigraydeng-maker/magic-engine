/**
 * Compose a tour poster from a real photo for an auto image post.
 *
 * photo + published tour facts + brand colours → image-edit model → read the text back
 * and check it → stored as a new `client_assets` row (source ai_generated, with
 * `vision_metadata.poster` lineage). Any failure returns `{ ok: false }` with a receipt;
 * the caller keeps the original photo. Never re-submits a failed edit (each submit is
 * billed), and reuses an identical poster that already exists instead of paying again.
 *
 * All side effects are injected; this module only orchestrates.
 */
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'
import { canBackRealPrice, type PosterLineage } from '@/lib/assets/provenance'
import type { CampaignDailyPosterMeta } from '@/lib/campaign/daily-plan'
import {
  buildTourPosterLines,
  buildTourPosterPrompt,
  posterTextMatches,
  type PosterBrand,
  type PosterRecipe,
  type TourPosterLines,
} from '@/lib/visual/poster-recipe'
import type { ImageEditRequest, ImageEditResult } from '@/lib/visual/image-edit'
import type { PosterTextRead } from '@/lib/visual/poster-text-reader'

export interface ComposeTourPosterInput {
  clientId: string
  date: string // YYYY-MM-DD
  tour: PublishedTourFact
  asset: RankableAssetRow
  recipe: Readonly<PosterRecipe>
  brand: PosterBrand | null
  website: string | null
}

export interface PosterAssetRow {
  client_id: string
  storage_url: string
  original_filename: string
  file_size_bytes: number
  mime_type: 'image/jpeg'
  status: 'analyzed'
  source: 'ai_generated'
  ownership: 'client_exclusive'
  vision_metadata: { poster: PosterLineage }
  verified_by: null
  verified_at: null
}

export interface ExistingPosterQuery {
  clientId: string
  originalFilename: string
  sourceAssetId: string
  recipeId: string
  recipeVersion: number
}

export interface ComposeTourPosterDeps {
  runImageEdit: (req: ImageEditRequest) => Promise<ImageEditResult>
  /** Transcribe the text on the generated image (copy only — matching is done here). */
  readPosterText: (imageUrl: string) => Promise<PosterTextRead>
  uploadFromUrl: (params: {
    sourceUrl: string
    clientId: string
    assetType: 'image'
    folder: string
  }) => Promise<{ storage_url: string; file_size_kb: number }>
  insertPosterAsset: (row: PosterAssetRow) => Promise<{ id: string }>
  /** An identical poster already stored for this client (same recipe, tour, date, photo). */
  findExistingPoster: (q: ExistingPosterQuery) => Promise<{ id: string } | null>
  now?: () => Date
}

/** Machine-readable receipt for one poster attempt (success, reuse or fallback). */
export type PosterReceipt = CampaignDailyPosterMeta

export type ComposeTourPosterResult =
  | { ok: true; assetId: string; receipt: PosterReceipt }
  | { ok: false; reason: string; receipt: PosterReceipt }

type Fail = (reason: string, extra?: Partial<PosterReceipt>) => ComposeTourPosterResult

const TRANSCRIPT_MAX = 500

function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

/** Stable per (recipe, tour, date) — also the dedupe key together with the source photo. */
export function posterFilename(recipe: Pick<PosterRecipe, 'id'>, tourSlug: string, date: string): string {
  return `poster-${recipe.id}-${tourSlug}-${date}.jpg`
}

export async function composeTourPoster(
  input: ComposeTourPosterInput,
  deps: ComposeTourPosterDeps,
): Promise<ComposeTourPosterResult> {
  const createdAt = (deps.now ?? (() => new Date()))().toISOString()
  // A photo that cannot back a real price still gets a poster — just without the price line.
  const posterLines = buildTourPosterLines(input.tour, input.date, input.website, {
    includePrice: canBackRealPrice(input.asset.source as string | null | undefined),
  })
  const base: PosterReceipt = {
    recipe_id: input.recipe.id,
    recipe_version: input.recipe.version,
    source_asset_id: input.asset.id,
    status: 'fallback',
    reason: null,
    poster_asset_id: null,
    has_price: posterLines.hasPrice,
    cost_usd: null,
    provider_request_id: null,
    created_at: createdAt,
    text_check: null,
  }
  const fail: Fail = (reason, extra = {}) => ({ ok: false, reason, receipt: { ...base, ...extra, reason } })

  if (!input.brand) return fail('no_brand_primary_colour')
  if (!input.asset.storage_url) return fail('source_image_missing')

  const filename = posterFilename(input.recipe, input.tour.slug, input.date)
  const reused = await findReusable(input, deps, filename)
  if (reused) return reused === 'lookup_failed' ? fail('existing_poster_lookup_failed') : reusedResult(base, reused.id)

  const edit = await deps.runImageEdit({
    model: input.recipe.model,
    imageUrl: input.asset.storage_url,
    prompt: buildTourPosterPrompt(posterLines, input.brand),
    resolution: input.recipe.resolution,
  })
  const spend = { cost_usd: edit.costUsd, provider_request_id: edit.requestId }
  if (!edit.ok) return fail(`image_edit_failed: ${edit.reason}`, spend)

  const checked = await checkPosterText(deps, edit.outputUrl, posterLines.lines)
  if (checked.status !== 'match') {
    const reason = checked.status === 'mismatch' ? 'text_mismatch' : `text_check_failed: ${checked.reason}`
    return fail(reason, { ...spend, text_check: checked.receipt })
  }

  return storePoster(input, deps, {
    lines: posterLines,
    createdAt,
    outputUrl: edit.outputUrl,
    filename,
  }, { ...base, ...spend, text_check: checked.receipt }, fail)
}

async function findReusable(
  input: ComposeTourPosterInput,
  deps: ComposeTourPosterDeps,
  filename: string,
): Promise<{ id: string } | 'lookup_failed' | null> {
  try {
    return await deps.findExistingPoster({
      clientId: input.clientId,
      originalFilename: filename,
      sourceAssetId: input.asset.id,
      recipeId: input.recipe.id,
      recipeVersion: input.recipe.version,
    })
  } catch {
    // Unknown whether one exists: do not spend (a duplicate charge is the thing we guard).
    return 'lookup_failed'
  }
}

function reusedResult(base: PosterReceipt, id: string): ComposeTourPosterResult {
  return { ok: true, assetId: id, receipt: { ...base, status: 'reused', poster_asset_id: id, cost_usd: 0 } }
}

type TextCheck =
  | { status: 'match'; receipt: NonNullable<PosterReceipt['text_check']> }
  | { status: 'mismatch' | 'failed'; reason: string; receipt: NonNullable<PosterReceipt['text_check']> }

async function checkPosterText(
  deps: ComposeTourPosterDeps,
  imageUrl: string,
  expected: string[],
): Promise<TextCheck> {
  let read: PosterTextRead
  try {
    read = await deps.readPosterText(imageUrl)
  } catch (e) {
    read = { ok: false, reason: short(e), costUsd: null }
  }
  if (!read.ok) {
    return { status: 'failed', reason: read.reason, receipt: { status: 'failed', transcribed: null, cost_usd: read.costUsd } }
  }
  const transcribed = read.text.slice(0, TRANSCRIPT_MAX)
  const verdict = posterTextMatches(expected, read.text)
  if (verdict.match) return { status: 'match', receipt: { status: 'match', transcribed, cost_usd: read.costUsd } }
  return { status: 'mismatch', reason: 'text_mismatch', receipt: { status: 'mismatch', transcribed, cost_usd: read.costUsd } }
}

async function storePoster(
  input: ComposeTourPosterInput,
  deps: ComposeTourPosterDeps,
  made: { lines: TourPosterLines; createdAt: string; outputUrl: string; filename: string },
  receipt: PosterReceipt,
  fail: Fail,
): Promise<ComposeTourPosterResult> {
  const carry = { cost_usd: receipt.cost_usd, provider_request_id: receipt.provider_request_id, text_check: receipt.text_check }
  let stored: { storage_url: string; file_size_kb: number }
  try {
    stored = await deps.uploadFromUrl({
      sourceUrl: made.outputUrl,
      clientId: input.clientId,
      assetType: 'image',
      folder: 'posters',
    })
  } catch (e) {
    return fail(`poster_upload_failed: ${short(e)}`, carry)
  }

  const lineage: PosterLineage = {
    recipe_id: input.recipe.id,
    recipe_version: input.recipe.version,
    source_asset_id: input.asset.id,
    has_price: made.lines.hasPrice,
    text_lines: made.lines.lines,
    cost_usd: receipt.cost_usd,
    provider_request_id: receipt.provider_request_id,
    created_at: made.createdAt,
    next_depart_on: made.lines.nextDepartOn,
  }
  try {
    const { id } = await deps.insertPosterAsset({
      client_id: input.clientId,
      storage_url: stored.storage_url,
      original_filename: made.filename,
      file_size_bytes: stored.file_size_kb * 1024,
      mime_type: 'image/jpeg',
      status: 'analyzed',
      source: 'ai_generated',
      ownership: 'client_exclusive',
      vision_metadata: { poster: lineage },
      verified_by: null,
      verified_at: null,
    })
    return { ok: true, assetId: id, receipt: { ...receipt, status: 'composed', poster_asset_id: id } }
  } catch (e) {
    return fail(`poster_insert_failed: ${short(e)}`, carry)
  }
}

/**
 * One factory still: the same poster composer the image step used to call inline,
 * framed for Story (9:16) or a feed post (4:5), then stored as a client asset.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RankableAssetRow } from '@/lib/factory/client-asset-pool'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import { readPosterLineage } from '@/lib/assets/provenance'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { composeTourPoster, type ComposeTourPosterResult } from '@/lib/social/image-post-poster'
import { readPosterBrand, resolvePosterRecipe } from '@/lib/visual/poster-recipe'
import { readPosterText } from '@/lib/visual/poster-text-reader'
import { runImageEdit } from '@/lib/visual/image-edit'

import type { StillAspect } from './still-config'

export async function composeFactoryStill(
  supabase: SupabaseClient,
  input: {
    clientId: string
    date: string
    tour: PublishedTourFact
    asset: RankableAssetRow
    website: string | null
    aspect: StillAspect
  },
): Promise<ComposeTourPosterResult> {
  const recipe = resolvePosterRecipe('tour_poster_v1')
  if (!recipe) return { ok: false, reason: 'no_recipe', receipt: blankReceipt(input.asset.id) }
  const brief = await getActiveBrief(input.clientId).catch(() => null)
  return composeTourPoster({
    ...input,
    recipe,
    brand: readPosterBrand(brief?.vi_colors ?? null),
    website: input.website ?? (typeof brief?.website === 'string' ? brief.website : null),
  }, {
    runImageEdit: (req) => runImageEdit(req),
    readPosterText: (url) => readPosterText(url),
    findExistingPoster: (q) => findPoster(supabase, q),
    insertPosterAsset: async (row) => insertAsset(supabase, input.clientId, row),
  })
}

async function findPoster(
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
    return lineage?.source_asset_id === q.sourceAssetId && lineage.recipe_id === q.recipeId && lineage.recipe_version === q.recipeVersion
  })
  return hit ? { id: hit.id } : null
}

async function insertAsset(
  supabase: SupabaseClient,
  clientId: string,
  row: { client_id: string; storage_url: string; original_filename: string; file_size_bytes: number; mime_type: 'image/jpeg'; status: 'analyzed'; source: 'ai_generated'; ownership: 'client_exclusive'; vision_metadata: { poster: unknown }; verified_by: null; verified_at: null },
): Promise<{ id: string }> {
  const { data, error } = await supabase.from('client_assets').insert({ ...row, client_id: clientId }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: (data as { id: string }).id }
}

function blankReceipt(sourceAssetId: string): ComposeTourPosterResult extends { receipt: infer R } ? R : never {
  return {
    recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: sourceAssetId, status: 'fallback',
    reason: 'no_recipe', poster_asset_id: null, has_price: false, cost_usd: null,
    provider_request_id: null, created_at: new Date().toISOString(), text_check: null,
  }
}

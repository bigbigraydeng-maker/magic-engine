/**
 * Daily Plan publish — the "real price only on real imagery" gate, with the AI-poster rule.
 *
 * A post image that is an AI poster (`vision_metadata.poster`) is judged by
 * `canAssetBackRealPrice` against its parent photo's CURRENT source, re-read here
 * (same client only) at publish time — never from the plan's own receipt.
 * A poster with a price on it counts as a price claim even if the copy has none.
 * Non-poster images keep the original source-only judgement, unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { canAssetBackRealPrice, isPosterSigned, readPosterLineage } from '@/lib/assets/provenance'
import { NEXT_DEPARTURE_LABEL } from '@/lib/visual/poster-recipe'
import { judgePriceClaimWithSource, posterPriceGateMessage, priceGateMessage } from '@/lib/content/price-claim-gate'

/** The `client_assets` columns the gate needs. */
export interface GateAssetRow {
  id: string
  source: string | null
  verified_by: string | null
  verified_at: string | null
  vision_metadata: unknown
}

/** What the gate knows about one post's image, beyond its source. Only set for posters. */
export interface PosterImageFacts {
  imageIsPoster: true
  imageBacksRealPrice: boolean
  imagePriceClaim: boolean
  /** Team sign-off present — required for every poster, priced or not. */
  imageSigned: boolean
  /** Text printed on the poster: judged by the price-fact check together with the copy. */
  posterTextLines: string[]
  /** Departure printed on the poster (YYYY-MM-DD) and whether a departure line exists at all. */
  posterNextDepartOn: string | null
  posterHasDepartureLine: boolean
}

/** Parent photo ids of the poster assets in `assets` (deduplicated). */
export function posterParentIds(assets: ReadonlyArray<Pick<GateAssetRow, 'vision_metadata'>>): string[] {
  const ids = new Set<string>()
  for (const asset of assets) {
    const lineage = readPosterLineage(asset.vision_metadata)
    if (lineage) ids.add(lineage.source_asset_id)
  }
  return Array.from(ids)
}

/**
 * Current source of each parent photo — one batched query, always scoped to `clientId`.
 * An archived parent counts as missing (no backing). A read error throws: a failed read
 * must never look like "the parent is fine".
 */
export async function loadPosterParentSources(
  supabase: SupabaseClient,
  clientId: string,
  parentIds: string[],
): Promise<Map<string, string | null>> {
  const sources = new Map<string, string | null>()
  if (parentIds.length === 0) return sources
  const { data, error } = await supabase
    .from('client_assets')
    .select('id, source, archived_at')
    .eq('client_id', clientId)
    .in('id', parentIds)
  if (error) throw error
  for (const row of (data ?? []) as Array<{ id: string; source: string | null; archived_at: string | null }>) {
    if (row.archived_at == null) sources.set(row.id, row.source)
  }
  return sources
}

/** Poster facts for one image row; null when it is not a poster (old rules apply). */
export function posterImageFacts(
  asset: GateAssetRow,
  parentSources: ReadonlyMap<string, string | null>,
): PosterImageFacts | null {
  const lineage = readPosterLineage(asset.vision_metadata)
  if (!lineage) return null
  const parentSource = parentSources.get(lineage.source_asset_id) ?? null
  return {
    imageIsPoster: true,
    imageBacksRealPrice: canAssetBackRealPrice(asset, parentSource),
    imagePriceClaim: lineage.has_price,
    imageSigned: isPosterSigned(asset),
    posterTextLines: lineage.text_lines,
    posterNextDepartOn: lineage.next_depart_on,
    posterHasDepartureLine: lineage.text_lines.some((l) => l.startsWith(NEXT_DEPARTURE_LABEL)),
  }
}

export interface GateCandidate {
  date: string
  judgedText: string
  imageSource: string | null
  imageIsPoster?: boolean
  imageBacksRealPrice?: boolean
  imagePriceClaim?: boolean
  imageSigned?: boolean
  posterTextLines?: string[]
  posterNextDepartOn?: string | null
  posterHasDepartureLine?: boolean
}

/** Text the price-fact check judges: the copy, plus whatever is printed on a poster. */
export function priceFactText(post: Pick<GateCandidate, 'judgedText' | 'posterTextLines'>): string {
  return post.posterTextLines && post.posterTextLines.length > 0
    ? [post.judgedText, post.posterTextLines.join('\n')].join('\n\n')
    : post.judgedText
}

/** Posters nobody has signed off (compared against the original photo). Every poster needs it. */
export function findUnsignedPosterBlocks(posts: GateCandidate[]): Array<{ date: string; message: string }> {
  return posts
    .filter((p) => p.imageIsPoster && p.imageSigned !== true)
    .map((p) => ({
      date: p.date,
      message: '配的是 AI 海报，还没有团队成员对过原图签字。去素材库打开原图对一遍，点「已对原图，确认」后再发。',
    }))
}

/**
 * Posters whose printed departure is already past (on the post date or today).
 * A departure line without a recorded date cannot be checked → blocked too.
 */
export function findStalePosterBlocks(
  posts: GateCandidate[],
  todayIso: string,
): Array<{ date: string; message: string }> {
  return posts
    .filter((p) => {
      if (!p.imageIsPoster || !p.posterHasDepartureLine) return false
      const departs = p.posterNextDepartOn ?? null
      return departs === null || departs < p.date || departs < todayIso
    })
    .map((p) => ({
      date: p.date,
      message: '海报上写的「Next departure」那一天已经过了（或核对不了），这张海报不能再发。换回原图或重新出海报。',
    }))
}

/** Every post whose copy or image claims a price that its image cannot back. */
export function findPriceGateBlocks(posts: GateCandidate[]): Array<{ date: string; message: string }> {
  const blocks: Array<{ date: string; message: string }> = []
  for (const post of posts) {
    const verdict = post.imageIsPoster
      ? judgePriceClaimWithSource({
          caption: post.judgedText,
          source: post.imageSource,
          imagePriceClaim: post.imagePriceClaim === true,
          backsRealPrice: post.imageBacksRealPrice === true,
        })
      : judgePriceClaimWithSource({ caption: post.judgedText, source: post.imageSource })
    if (!verdict.blocked) continue
    blocks.push({
      date: post.date,
      message: post.imageIsPoster ? posterPriceGateMessage() : priceGateMessage(verdict.source),
    })
  }
  return blocks
}

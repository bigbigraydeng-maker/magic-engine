import { z } from 'zod'

export const assetIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
export const videoHandoffSchema = z.object({
  campaign_id: assetIdSchema,
  plan_id: assetIdSchema,
  expected_plan_revision: z.string().datetime(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  asset_id: assetIdSchema,
  platform: z.enum(['youtube', 'tiktok', 'facebook_reels']),
  title: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(5000),
}).strict()

export type VideoHandoff = z.infer<typeof videoHandoffSchema>
export interface VideoAsset {
  id: string
  storage_url: string
  original_filename: string | null
  mime_type: string
  status: string
  archived_at: string | null
}

/** A usable file is not a factual, rights, publishing or advertising approval. */
export function usableVideo(asset: VideoAsset | null | undefined): asset is VideoAsset {
  if (!asset || asset.archived_at || asset.status !== 'analyzed' || asset.mime_type !== 'video/mp4') return false
  try { return new URL(asset.storage_url).protocol === 'https:' } catch { return false }
}

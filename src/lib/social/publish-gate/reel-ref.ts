/**
 * Read the post id and time stored after a Reel went public.
 * Drafts and missing rows return null. A database error is thrown.
 * This does not call a platform API and does not emit an ad event.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function loadReelPublishedRef(
  supabase: SupabaseClient,
  orderId: string,
): Promise<{ postId: string; publishedAt: string } | null> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('published_ref')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw new Error(`loadReelPublishedRef: ${error.message}`)
  return refOf((data as { published_ref?: unknown } | null)?.published_ref)
}

function refOf(value: unknown): { postId: string; publishedAt: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.video_state !== 'PUBLISHED') return null
  const postId = typeof row.post_id === 'string' ? row.post_id : typeof row.video_id === 'string' ? row.video_id : null
  const publishedAt = typeof row.published_at === 'string' ? row.published_at : null
  if (!postId || !publishedAt) return null
  return { postId, publishedAt }
}

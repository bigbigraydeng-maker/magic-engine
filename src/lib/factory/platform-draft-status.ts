/**
 * Facebook Reel draft read-compatibility.
 *
 * Legacy rows stay status='published' with published_ref.video_state='DRAFT'.
 * New rows use status='platform_draft' (uploaded to the platform, not public).
 * Readers accept both. Nothing here writes the new status or widens the database check.
 */

export const PLATFORM_DRAFT_STATUS = 'platform_draft' as const

/** Statuses that mean the order has reached the platform (public post or draft). */
export const ON_PLATFORM_ORDER_STATUSES = ['published', PLATFORM_DRAFT_STATUS] as const

export function isOnPlatformOrderStatus(status: string): boolean {
  return (ON_PLATFORM_ORDER_STATUSES as readonly string[]).includes(status)
}

/**
 * Uploaded but not public.
 * A legacy published row counts only when video_state is DRAFT.
 * platform_draft counts unless the platform already reports PUBLISHED.
 */
export function isUploadedUnpublishedDraft(
  status: string,
  videoState: string | null | undefined,
): boolean {
  if (videoState === 'PUBLISHED') return false
  if (status === PLATFORM_DRAFT_STATUS) return true
  return status === 'published' && videoState === 'DRAFT'
}

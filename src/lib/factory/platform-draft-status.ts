/**
 * Facebook Reel draft status.
 *
 * Legacy rows stay status='published' with published_ref.video_state='DRAFT'.
 * New rows may use status='platform_draft' (uploaded, not public) and must
 * still keep video_state='DRAFT'. Convert-to-public writeback requires that
 * stamp; without it the order is rejected after the platform is already public.
 *
 * Writing platform_draft is gated. FACTORY_WRITE_PLATFORM_DRAFT defaults off.
 * When it is exactly "true" and the status check rejects the value, the writer
 * falls back to the legacy combo. This file does not change the database check.
 */

export const PLATFORM_DRAFT_STATUS = 'platform_draft' as const

/** Exact "true" only. Unset, "1", and "TRUE" keep the legacy published+DRAFT write. */
export const FACTORY_WRITE_PLATFORM_DRAFT_ENV = 'FACTORY_WRITE_PLATFORM_DRAFT'

/** Statuses that mean the order has reached the platform (public post or draft). */
export const ON_PLATFORM_ORDER_STATUSES = ['published', PLATFORM_DRAFT_STATUS] as const

export function platformDraftWriteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[FACTORY_WRITE_PLATFORM_DRAFT_ENV] === 'true'
}

/**
 * Status stored after Meta confirms the upload.
 * A public reel is always `published`. A draft uses `platform_draft` only when the gate is on.
 * The caller still stores video_state='DRAFT' on the receipt either way.
 */
export function statusForConfirmedUpload(
  videoState: 'DRAFT' | 'PUBLISHED',
  writePlatformDraft: boolean,
): 'published' | typeof PLATFORM_DRAFT_STATUS {
  if (videoState === 'DRAFT' && writePlatformDraft) return PLATFORM_DRAFT_STATUS
  return 'published'
}

type StatusCheckError = {
  code?: string | null
  message?: string | null
  details?: string | null
}

/** True when Postgres rejected status `platform_draft` on content_work_orders. */
export function isWorkOrderStatusCheckViolation(error: StatusCheckError | null | undefined): boolean {
  if (!error) return false
  const text = `${error.message ?? ''}\n${error.details ?? ''}`
  if (text.includes('content_work_orders_status_check')) return true
  return error.code === '23514' && text.includes(PLATFORM_DRAFT_STATUS)
}

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

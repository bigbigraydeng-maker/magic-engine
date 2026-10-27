/** A plain object: not null, not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True only when the brief explicitly marks the work order as material-only
 * (`brief.remotion.deliverable === 'asset_only'`). Anything else — missing,
 * misspelled, wrong type — is a normal deliverable. Never throws.
 */
export function isAssetOnly(brief: unknown): boolean {
  if (!isPlainObject(brief)) return false
  const remotion = brief.remotion
  if (!isPlainObject(remotion)) return false
  return remotion.deliverable === 'asset_only'
}

/** Mark a work-order brief as material only. Existing remotion fields stay. */
export function withAssetOnlyDeliverable<T extends { remotion?: Record<string, unknown> }>(brief: T): T {
  const remotion = brief.remotion
  const base = isPlainObject(remotion) ? remotion : {}
  return { ...brief, remotion: { ...base, deliverable: 'asset_only' } }
}

export const ASSET_ONLY_NOT_PUBLISHABLE = 'asset_only work orders are material only and cannot be approved or published'

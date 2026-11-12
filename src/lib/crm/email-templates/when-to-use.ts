/**
 * Optional note shown to colleagues: when this template should be used.
 * It is not part of the mail, and it never affects sending.
 */

export const WHEN_TO_USE_MAX_LENGTH = 200

/** Shown in the editor only while the field is empty. */
export const WHEN_TO_USE_EMPTY_HINT = '例如：什么情况下用这份模板，写给同事看'

export type WhenToUseResult = { ok: true; value: string | null } | { ok: false }

/** Missing or blank becomes null. Anything else that is not a short string is refused. */
export function normalizeWhenToUse(value: unknown): WhenToUseResult {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (trimmed.length > WHEN_TO_USE_MAX_LENGTH) return { ok: false }
  return { ok: true, value: trimmed }
}

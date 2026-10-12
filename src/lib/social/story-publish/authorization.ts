import type { StoryAuthorization, StoryItemSpec } from './types'

/**
 * Outcome of judging whether a story item may be published right now.
 * Every non-ACTIVE value is a fail-closed reason; the first matching check wins.
 */
export type StoryAuthState =
  | 'ACTIVE'
  | 'NONE'
  | 'WRONG_PACK'
  | 'WRONG_CLIENT'
  | 'NOT_ACTIVATED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'AUTHORIZER_NOT_ADMIN'
  | 'NO_AUTHORIZED_FINGERPRINT'
  | 'FINGERPRINT_MISMATCH'

/** Returns true only when the string parses to a real instant. */
function isValidDate(value: string | null): boolean {
  if (value === null) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * Judge a single (item, authorization) pair. Checks run in a fixed order and
 * the first hit wins, so the result is deterministic and fail-closed: anything
 * short of a fully valid, activated, unrevoked, unexpired, admin-authorised,
 * fingerprint-matching record yields a non-ACTIVE state.
 */
export function judgeStoryAuthorization(input: {
  authorization: StoryAuthorization | null
  item: StoryItemSpec
  /** fingerprint stored on the item row when the PM authorised it (null = none) */
  authorizedFingerprint: string | null
  /** fingerprint recomputed right now from the current item */
  currentFingerprint: string
  /** lowercase admin emails */
  adminEmails: ReadonlySet<string>
  now: Date
}): StoryAuthState {
  const {
    authorization,
    item,
    authorizedFingerprint,
    currentFingerprint,
    adminEmails,
    now,
  } = input

  if (authorization === null) return 'NONE'

  if (authorization.pack_id !== item.pack_id) return 'WRONG_PACK'

  if (authorization.client_id !== item.client_id) return 'WRONG_CLIENT'

  if (!isValidDate(authorization.activated_at)) return 'NOT_ACTIVATED'

  if (authorization.revoked_at !== null) return 'REVOKED'

  if (!isValidDate(authorization.expires_at)) return 'EXPIRED'
  if (Date.parse(authorization.expires_at) <= now.getTime()) return 'EXPIRED'

  const authorizer = authorization.authorized_by_email.trim().toLowerCase()
  if (!adminEmails.has(authorizer)) return 'AUTHORIZER_NOT_ADMIN'

  if (authorizedFingerprint === null || authorizedFingerprint === '') {
    return 'NO_AUTHORIZED_FINGERPRINT'
  }

  if (authorizedFingerprint !== currentFingerprint) return 'FINGERPRINT_MISMATCH'

  return 'ACTIVE'
}

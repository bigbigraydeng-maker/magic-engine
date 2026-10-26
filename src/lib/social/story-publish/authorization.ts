import { computeItemFingerprint, computeManifestHash } from './fingerprint'
import { storyItemKey, type AdminEmailSet, type StoryAuthorization, type StoryItemSpec } from './types'

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
  | 'AUTHORIZATION_ID_MISMATCH'
  | 'NO_AUTHORIZED_FINGERPRINT'
  | 'FINGERPRINT_MISMATCH'
  | 'MANIFEST_MISMATCH'

/** Returns true only when the string parses to a real instant. */
function isValidDate(value: string | null): boolean {
  if (value === null) return false
  return !Number.isNaN(Date.parse(value))
}

/**
 * Judge a single (item, authorization) pair. Checks run in a fixed order and
 * the first hit wins, so the result is deterministic and fail-closed: anything
 * short of a fully valid, activated, unrevoked, unexpired, admin-authorised,
 * fingerprint- and manifest-matching record yields a non-ACTIVE state.
 *
 * The judge never trusts fingerprints supplied by the caller: it recomputes
 * the item fingerprint and the pack manifest hash from the raw item data and
 * the authorization's own `expires_at`, then compares them against the frozen
 * snapshot taken at authorisation time.
 */
export function judgeStoryAuthorization(input: {
  authorization: StoryAuthorization | null
  item: StoryItemSpec
  /** the authorization id stored on the item row (null = item never authorised) */
  itemAuthorizationId: string | null
  /** every item of the pack as it is stored right now (all channels), used to recompute the manifest hash */
  packItems: StoryItemSpec[]
  /** lowercase admin emails */
  adminEmails: AdminEmailSet
  now: Date
}): StoryAuthState {
  const { authorization, item, itemAuthorizationId, packItems, adminEmails, now } =
    input

  if (authorization === null) return 'NONE'

  if (authorization.pack_id !== item.pack_id) return 'WRONG_PACK'

  if (authorization.client_id !== item.client_id) return 'WRONG_CLIENT'

  if (!isValidDate(authorization.activated_at)) return 'NOT_ACTIVATED'

  if (authorization.revoked_at !== null) return 'REVOKED'

  if (!isValidDate(authorization.expires_at)) return 'EXPIRED'
  if (Date.parse(authorization.expires_at) <= now.getTime()) return 'EXPIRED'

  const authorizer = authorization.authorized_by_email.trim().toLowerCase()
  if (!adminEmails.has(authorizer)) return 'AUTHORIZER_NOT_ADMIN'

  if (itemAuthorizationId !== authorization.id) return 'AUTHORIZATION_ID_MISMATCH'

  const key = storyItemKey(item)
  const snapshot = authorization.approved_item_fingerprints
  if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
    return 'NO_AUTHORIZED_FINGERPRINT'
  }
  const approved = snapshot[key]
  if (approved === undefined || approved === '') {
    return 'NO_AUTHORIZED_FINGERPRINT'
  }

  const currentFingerprint = computeItemFingerprint(item, authorization.expires_at)
  if (currentFingerprint !== approved) return 'FINGERPRINT_MISMATCH'

  const itemInPack = packItems.some((candidate) => storyItemKey(candidate) === key)
  if (!itemInPack) return 'MANIFEST_MISMATCH'

  let currentManifestHash: string
  try {
    currentManifestHash = computeManifestHash(packItems, authorization.expires_at)
  } catch {
    return 'MANIFEST_MISMATCH'
  }
  if (currentManifestHash !== authorization.manifest_hash) return 'MANIFEST_MISMATCH'

  return 'ACTIVE'
}

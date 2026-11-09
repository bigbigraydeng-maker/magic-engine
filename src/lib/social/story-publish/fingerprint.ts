import { createHash } from 'node:crypto'
import { storyItemKey, type StoryItemSpec } from './types'

/**
 * Builds the canonical string that is hashed to fingerprint a story item.
 *
 * The object literal is written out field by field in a fixed order so that
 * the serialisation is stable regardless of how the caller built the input
 * object. `source_record_ids` is copied and sorted so that the order of the
 * ids in the input never changes the fingerprint, and the caller's array is
 * never mutated.
 */
/**
 * Normalise an instant to the canonical ISO form so `…Z`, `….000Z` and `+00:00`
 * spellings of the same moment fingerprint identically (a database may return a
 * different spelling than the one used at authorisation). An unreadable value is
 * kept distinguishable so it can never equal a real instant.
 */
function canonicalInstant(value: string): string {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? `INVALID:${value}` : new Date(ms).toISOString()
}

export function canonicalFingerprintInput(item: StoryItemSpec, expiresAt: string): string {
  const sortedSourceRecordIds = [...item.source_record_ids].sort()

  return JSON.stringify({
    item_id: item.item_id,
    pack_id: item.pack_id,
    client_id: item.client_id,
    channel: item.channel,
    slot_at: canonicalInstant(item.slot_at),
    media_kind: item.media_kind,
    media_url: item.media_url,
    media_sha256: item.media_sha256,
    text_line: item.text_line,
    account_id: item.account_id,
    source_record_ids: sortedSourceRecordIds,
    website_ref: item.website_ref,
    website_checked_on: item.website_checked_on,
    has_reply_cta: item.has_reply_cta,
    contains_price: item.contains_price,
    names_place: item.names_place,
    expires_at: canonicalInstant(expiresAt),
  })
}

/**
 * Returns the lowercase hex sha256 of the canonical fingerprint input.
 * Always 64 characters long.
 */
export function computeItemFingerprint(item: StoryItemSpec, expiresAt: string): string {
  return createHash('sha256').update(canonicalFingerprintInput(item, expiresAt)).digest('hex')
}

/**
 * Returns the lowercase hex sha256 of the manifest over every item's
 * `[storyItemKey(item), computeItemFingerprint(item, expiresAt)]` pair.
 *
 * The pairs are sorted by key (plain ascending string comparison) so the hash
 * is independent of the order the items were supplied in. An empty list is
 * allowed and yields a stable hash. Throws when two items share the same key,
 * because a manifest must describe each (item, channel) exactly once.
 */
export function computeManifestHash(items: StoryItemSpec[], expiresAt: string): string {
  const pairs: Array<[string, string]> = items.map((item) => [
    storyItemKey(item),
    computeItemFingerprint(item, expiresAt),
  ])

  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i][0] === pairs[i - 1][0]) {
      throw new Error('computeManifestHash: duplicate item key')
    }
  }

  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex')
}

/**
 * Fingerprint of what the PM sees when opening an item: every content field but
 * not the authorisation expiry (which does not exist yet at that moment). Open
 * records are bound to this value, so they go stale the moment the item changes.
 */
export function computeContentFingerprint(item: StoryItemSpec): string {
  const parsed = JSON.parse(canonicalFingerprintInput(item, '1970-01-01T00:00:00.000Z')) as Record<string, unknown>
  delete parsed.expires_at
  return createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
}

/**
 * Hash over what the person sees in a preview: every item's content fingerprint, ordered by item key.
 * It carries no expiry date (only, when given, the lifetime in days the person previewed), so a preview taken now and a confirmation sent a minute later agree as long as
 * no item changed in between.
 */
export function computeContentManifestHash(
  items: StoryItemSpec[],
  options: { lifetimeDays?: number } = {},
): string {
  const pairs = items.map((item) => [storyItemKey(item), computeContentFingerprint(item)] as const)
  const keys = new Set(pairs.map(([key]) => key))
  if (keys.size !== pairs.length) throw new Error('computeContentManifestHash: duplicate item key')
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  // the lifetime the person previews is part of what they confirm
  const payload = options.lifetimeDays === undefined ? pairs : { items: pairs, lifetime_days: options.lifetimeDays }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

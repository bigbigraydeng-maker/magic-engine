import { createHash } from 'node:crypto'
import type { StoryItemSpec } from './types'

/**
 * Builds the canonical string that is hashed to fingerprint a story item.
 *
 * The object literal is written out field by field in a fixed order so that
 * the serialisation is stable regardless of how the caller built the input
 * object. `source_record_ids` is copied and sorted so that the order of the
 * ids in the input never changes the fingerprint, and the caller's array is
 * never mutated.
 */
export function canonicalFingerprintInput(item: StoryItemSpec, expiresAt: string): string {
  const sortedSourceRecordIds = [...item.source_record_ids].sort()

  return JSON.stringify({
    item_id: item.item_id,
    pack_id: item.pack_id,
    client_id: item.client_id,
    channel: item.channel,
    slot_at: item.slot_at,
    media_kind: item.media_kind,
    media_url: item.media_url,
    media_sha256: item.media_sha256,
    text_line: item.text_line,
    account_id: item.account_id,
    source_record_ids: sortedSourceRecordIds,
    website_ref: item.website_ref,
    website_checked_on: item.website_checked_on,
    has_reply_cta: item.has_reply_cta,
    expires_at: expiresAt,
  })
}

/**
 * Returns the lowercase hex sha256 of the canonical fingerprint input.
 * Always 64 characters long.
 */
export function computeItemFingerprint(item: StoryItemSpec, expiresAt: string): string {
  return createHash('sha256').update(canonicalFingerprintInput(item, expiresAt)).digest('hex')
}

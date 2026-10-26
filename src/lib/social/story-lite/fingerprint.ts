/**
 * Story "lite" — fingerprints. A fingerprint covers everything that decides what goes out; it is
 * stored at authorisation time and recomputed from the stored row right before sending.
 */
import { createHash } from 'node:crypto'

import type { LiteItem } from './types'

type Fingerprinted = Pick<
  LiteItem,
  'item_id' | 'channel' | 'slot_at' | 'media_kind' | 'media_url' | 'media_sha256' | 'text_line' | 'account_id' | 'source_ref'
>

/** An instant in one canonical spelling, so `…Z` and `+00:00` agree; unreadable values stay distinguishable. */
function canonicalInstant(value: string): string {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? `INVALID:${value}` : new Date(ms).toISOString()
}

/** sha256 hex of one item's decisive fields (fixed order). */
export function computeItemFingerprint(item: Fingerprinted): string {
  const canonical = JSON.stringify({
    item_id: item.item_id,
    channel: item.channel,
    slot_at: canonicalInstant(item.slot_at),
    media_kind: item.media_kind,
    media_url: item.media_url,
    media_sha256: item.media_sha256,
    text_line: item.text_line,
    account_id: item.account_id,
    source_ref: item.source_ref,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Hash of what a preview shows: every item's fingerprint ordered by item id, plus the lifetime in
 * days the person previewed. Confirming must send it back: a different value means the pack (or
 * the lifetime) changed after the person looked.
 */
export function computePackContentHash(items: Fingerprinted[], lifetimeDays: number): string {
  const ids = new Set(items.map((item) => item.item_id))
  if (ids.size !== items.length) throw new Error('computePackContentHash: duplicate item id')
  const pairs = items
    .map((item) => [item.item_id, computeItemFingerprint(item)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256').update(JSON.stringify({ items: pairs, lifetime_days: lifetimeDays })).digest('hex')
}

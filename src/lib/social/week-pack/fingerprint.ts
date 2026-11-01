/**
 * Manifest digest. Sort is part of the contract so row order cannot change the card.
 * Assembled time is not included. Image posts are not included (they are not wired).
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

import type { WeekPackManifest } from './types'

interface Entry {
  kind: 'story' | 'reel'
  stable_id: string
  per_item_fingerprint: string
  scheduled_at_iso: string
}

function compareEntry(a: Entry, b: Entry): number {
  return a.scheduled_at_iso.localeCompare(b.scheduled_at_iso)
    || a.kind.localeCompare(b.kind)
    || a.stable_id.localeCompare(b.stable_id)
}

function storyEntries(manifest: WeekPackManifest): Entry[] {
  if (manifest.story.read_state !== 'ok') {
    return [{ kind: 'story', stable_id: 'unread', per_item_fingerprint: 'unread', scheduled_at_iso: 'unread' }]
  }
  return manifest.story.items.map((item) => ({
    kind: 'story' as const,
    stable_id: item.item_id,
    per_item_fingerprint: item.fingerprint,
    scheduled_at_iso: item.slot_at,
  }))
}

function reelEntries(manifest: WeekPackManifest): Entry[] {
  if (manifest.reels.read_state !== 'ok') {
    return [{ kind: 'reel', stable_id: 'unread', per_item_fingerprint: 'unread', scheduled_at_iso: 'unread' }]
  }
  return manifest.reels.items.map((item) => ({
    kind: 'reel' as const,
    stable_id: item.work_order_id,
    per_item_fingerprint: item.fingerprint ?? 'unread',
    scheduled_at_iso: item.scheduled_at_iso ?? 'unread',
  }))
}

/** Stable hash of every story and reel row. Unreadable is its own row, not zero rows. */
export function manifestDigest(manifest: WeekPackManifest): string {
  const entries = [...storyEntries(manifest), ...reelEntries(manifest)].sort(compareEntry)
  return canonicalHashOfInput(entries)
}

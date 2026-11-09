/**
 * Story auto-publish — service contracts (slice 2b).
 *
 * Shapes shared by the evaluate / preview / authorize services. Pure types and
 * two tiny helpers; no I/O.
 */
import type { StoryGateInput } from './gates'
import type { StoryStore } from './store'
import type { AdminEmailSet, StoryAttemptStatus, StoryChannel, StoryItemSpec } from './types'

/** The side effects the services need, injected so every rule is testable offline. */
export interface StoryServicePorts {
  store: StoryStore
  /** Lowercase emails of global administrators. */
  adminEmails: AdminEmailSet
  /** Re-download the media behind the item and compare its sha256 with the recorded one. */
  checkFile(item: StoryItemSpec): Promise<'OK' | 'CHANGED' | 'UNREACHABLE'>
  /** Live price check against the official website (only asked for items that show a price). */
  checkPrice(item: StoryItemSpec): Promise<'OK' | 'BLOCKED' | 'ERROR'>
  /** Send a workflow event (Inngest). Throws when the event could not be sent. */
  sendEvent(event: { id: string; name: string; data: Record<string, unknown> }): Promise<void>
  /** A fresh UUID. */
  newId(): string
  config: StoryGateInput['config']
}

/** The person acting. */
export interface StoryActor {
  id: string
  email: string
  /** Non-null when the account is limited to one client (such an account can never authorise). */
  allowedClientId: string | null
}

/** An open record counts for 24 hours; after that the person must open the item again. */
export const STORY_OPEN_VALIDITY_MS = 24 * 60 * 60 * 1000

/** An item needs a person to have opened it before the pack can be authorised. */
export function itemRequiresOpen(item: Pick<StoryItemSpec, 'contains_price' | 'names_place' | 'media_kind'>): boolean {
  return item.contains_price || item.names_place || item.media_kind === 'video'
}

/** Calendar date (YYYY-MM-DD) of an instant in New Zealand; null when the instant is unreadable. */
export function nzDateOf(instantIso: string): string | null {
  const ms = Date.parse(instantIso)
  if (Number.isNaN(ms)) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(ms))
}

/** One line of the preview: what the person will see and what is wrong with it. */
export interface StoryPreviewItem {
  item_id: string
  channel: StoryChannel
  slot_at: string
  media_kind: StoryItemSpec['media_kind']
  media_url: string
  text_line: string
  website_ref: string
  website_checked_on: string
  contains_price: boolean
  names_place: boolean
  has_reply_cta: boolean
  /** The person must open this item before authorising. */
  requires_open: boolean
  /** The acting person has opened this exact version of the item. */
  opened_by_me: boolean
  /** Stable reason codes from the dry-run gate; empty = fine. */
  problems: string[]
  /** An attempt already on file for this item (a sent or in-flight story). */
  already_attempted: StoryAttemptStatus | null
}

export interface StoryPackPreview {
  pack_id: string
  client_id: string
  items: StoryPreviewItem[]
  /**
   * Hash of everything this preview shows (`computeContentManifestHash`). Confirming an authorisation
   * must send it back; a different value means the pack changed after it was previewed.
   */
  content_hash: string
  counts: { total: number; requires_open: number; opened: number; with_problems: number }
  /** True only when no item has a problem and every item that must be opened has been. */
  can_authorize: boolean
  /** Plain list of what blocks authorisation (codes), empty when can_authorize. */
  blocking: string[]
}

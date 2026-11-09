/**
 * Story "lite" auto-publish — shared contract.
 *
 * The minimal version PM chose on 2026-10-12 after the over-engineering review: two tables
 * (a weekly pack + its items), one authorisation per pack, one sweep every ten minutes.
 * Pure types and constants; no I/O. Design: docs/specs/2026-10-12-story-lite-design.md.
 * Nothing here is client- or industry-specific.
 */

/** Only Facebook is built; the column allows Instagram later without a migration. */
export type LiteChannel = 'facebook_story' | 'instagram_story'
export type LiteMediaKind = 'image' | 'video'

/** What a Story is for in the day (the calendar spreads the three roles over the three time slots). */
export type LiteRole = 'inspiration' | 'fact' | 'invite' | 'itinerary' | 'price_inclusions' | 'reason' | 'acquisition'
export const LITE_ROLES: readonly LiteRole[] = ['inspiration', 'fact', 'invite', 'itinerary', 'price_inclusions', 'reason', 'acquisition']

export const LITE_ITEM_STATUSES = [
  'PENDING', // waiting for its time (or for the next sweep after a harmless retry)
  'CLAIMED', // a sweep took it and is about to send
  'SENT', // Facebook returned a story id
  'UNKNOWN_OUTCOME', // we cannot tell whether it went out: a person must look; never retried
  'FAILED', // Facebook clearly refused it
  'BLOCKED', // a pre-send check failed (file changed, content changed, account mismatch ...)
  'MISSED', // its time window passed; never sent late
] as const
export type LiteItemStatus = (typeof LITE_ITEM_STATUSES)[number]

/** Statuses a sweep never touches again. */
export const LITE_FINAL_STATUSES: ReadonlySet<LiteItemStatus> = new Set([
  'SENT',
  'UNKNOWN_OUTCOME',
  'FAILED',
  'BLOCKED',
  'MISSED',
])

export interface LitePack {
  id: string
  client_id: string
  title: string
  created_at: string
  /** Set once, by a global administrator. Null = not authorised. */
  authorized_at: string | null
  authorized_by_email: string | null
  authorized_by_user_id: string | null
  expires_at: string | null
  /** Hash of the preview the person confirmed (see `computePackContentHash`). */
  authorized_content_hash: string | null
  /** Set once. A revoked pack is finished: create a new pack to start again. */
  revoked_at: string | null
  revoked_by_email: string | null
  revoked_reason: string | null
}

export interface LiteItem {
  item_id: string
  pack_id: string
  client_id: string
  channel: LiteChannel
  /** Planned send instant, ISO-8601 UTC. */
  slot_at: string
  media_kind: LiteMediaKind
  /** Public https URL of the file. */
  media_url: string
  /** Lowercase hex sha256 of the file bytes (re-checked right before sending). */
  media_sha256: string
  /** The one line of text in the picture. */
  text_line: string
  /** Facebook Page id the story goes to. */
  account_id: string
  /** The official-website page the claim was checked against (https). */
  source_ref: string
  status: LiteItemStatus
  /** Fingerprint of this item at the moment the PM authorised the pack. */
  authorized_fingerprint: string | null
  attempt_count: number
  claimed_at: string | null
  sent_at: string | null
  /** The Facebook story id; never invented, null until Facebook returned one. */
  provider_receipt: string | null
  reason_code: string | null
  /** What the latest dry run / pre-send check saw (for the preview and the watchdog). */
  last_check_at: string | null
  last_check_result: string | null
  /** Optional: only present once the role column exists and is filled. Not part of the fingerprint. */
  role?: LiteRole
}

/** What a caller supplies to create a pack with its items. */
export type NewLiteItem = Pick<
  LiteItem,
  'item_id' | 'channel' | 'slot_at' | 'media_kind' | 'media_url' | 'media_sha256' | 'text_line' | 'account_id' | 'source_ref'
>

/** The person acting. */
export interface LiteActor {
  id: string
  email: string
  /** Non-null for an account limited to one client: such an account can never authorise. */
  allowedClientId: string | null
}

/** Business-readable event names (Inngest). */
export const LITE_EVENTS = {
  packAuthorized: 'story.pack.authorized',
  packRevoked: 'story.pack.revoked',
  itemAttempted: 'story.item.attempted',
} as const

/** Environment switches, passed in as plain data: default is rehearsal only. */
export interface LiteSwitches {
  /** True only when STORY_AUTO_PUBLISH_LIVE is exactly 'true'. */
  live: boolean
  /** Lowercased client ids allowed to publish for real. */
  clientIds: string[]
}

/** Real publishing needs BOTH switches: the global one on, and this client on the list. One definition for the publisher and the page banner. */
export function isLiveFor(switches: LiteSwitches, clientId: string): boolean {
  return switches.live && switches.clientIds.includes(clientId.trim().toLowerCase())
}

/** Result of the pre-send check of a story file. BAD_VIDEO: a video that is not the right length / shape / size. */
export type LiteFileCheck = 'OK' | 'CHANGED' | 'UNREACHABLE' | 'BAD_VIDEO'

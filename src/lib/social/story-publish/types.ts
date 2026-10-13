/**
 * Story auto-publish — shared contract (slice 2a).
 *
 * Pure types and constants only: no database, no network, no process.env.
 * Design: docs/specs/2026-10-12-story-auto-publish-design.md (§4.2–§4.4, §5).
 * Nothing here is client- or industry-specific; client ids, account ids and
 * slot times arrive as data.
 */

export const STORY_CHANNELS = ['facebook_story', 'instagram_story'] as const
export type StoryChannel = (typeof STORY_CHANNELS)[number]

export type StoryMediaKind = 'image' | 'video'

/**
 * One story for one channel at one planned instant — the unit the PM
 * authorises and the unit a publisher claims. Every field below is covered by
 * the content fingerprint (see fingerprint.ts), so changing any of them after
 * authorisation invalidates that item's authorisation.
 */
export interface StoryItemSpec {
  item_id: string
  pack_id: string
  client_id: string
  channel: StoryChannel
  /** Planned send instant, ISO-8601 UTC. */
  slot_at: string
  media_kind: StoryMediaKind
  /** Public https URL of an immutable, content-addressed file. */
  media_url: string
  /** Lowercase hex sha256 of the file bytes behind `media_url`. */
  media_sha256: string
  /** The single line of text burned into the picture (recorded, not sent separately). */
  text_line: string
  /** Facebook Page id (facebook_story) or Instagram user id (instagram_story). */
  account_id: string
  /** Fact-library entries this item rests on; must be non-empty. */
  source_record_ids: string[]
  /** Official-website page the claims were checked against (https). */
  website_ref: string
  /** Calendar date (YYYY-MM-DD) the website was checked. */
  website_checked_on: string
  /** True when the picture invites the viewer to reply (needs a reply owner on duty). */
  has_reply_cta: boolean
  /** True when the picture shows a price (the PM must have opened the item before authorising). */
  contains_price: boolean
  /** True when the picture names a place (the PM must have opened the item before authorising). */
  names_place: boolean
}

/** Pack-level authorisation record (item fingerprints live on the item rows). */
export interface StoryAuthorization {
  id: string
  pack_id: string
  client_id: string
  authorized_by_email: string
  authorized_by_user_id: string
  authorized_at: string
  /** Set only after the authorisation event was sent; null = not usable. */
  activated_at: string | null
  expires_at: string
  revoked_at: string | null
  /**
   * Hash over every authorised item's fingerprint, frozen at authorisation time
   * (see `computeManifestHash`). Never changes after it is written.
   */
  manifest_hash: string
  /**
   * Read-only snapshot of each authorised item's fingerprint, keyed by
   * `storyItemKey(item)` (`${item_id}:${channel}`). Frozen at authorisation time,
   * so rewriting an item row and its stored fingerprint cannot widen what the PM approved.
   */
  approved_item_fingerprints: Record<string, string>
}

/** Anything that can say whether an email belongs to a global administrator (a Set works). */
export interface AdminEmailSet {
  has(email: string): boolean
}

/** Stable key for one (item, channel). */
export function storyItemKey(item: { item_id: string; channel: StoryChannel }): string {
  return `${item.item_id}:${item.channel}`
}

export const STORY_ATTEMPT_STATUSES = [
  'DRY_RUN',
  'CLAIMED',
  'RETRYABLE',
  'CONTAINER_CREATED',
  'PUBLISHING',
  'PUBLISHED_UNVERIFIED',
  'PUBLISHED',
  'BLOCKED',
  'FAILED_FINAL',
  'UNKNOWN_OUTCOME',
  'MISSED_WINDOW',
  'SKIPPED_NOT_AUTHORIZED',
] as const
export type StoryAttemptStatus = (typeof STORY_ATTEMPT_STATUSES)[number]

/** Statuses after which nothing may ever be published for that (item, channel) again. */
export const STORY_TERMINAL_STATUSES: ReadonlySet<StoryAttemptStatus> = new Set([
  'PUBLISHED_UNVERIFIED',
  'PUBLISHED',
  'FAILED_FINAL',
  'UNKNOWN_OUTCOME',
  'MISSED_WINDOW',
])

/** Business-readable Inngest event names (CLAUDE.md §3). */
export const STORY_EVENTS = {
  packDrafted: 'story.pack.drafted',
  itemReviewed: 'story.item.reviewed',
  packAuthorized: 'story.pack.authorized',
  packRevoked: 'story.pack.revoked',
  igContainerCreated: 'story.ig_container.created',
  publishAttempted: 'story.publish.attempted',
  publishConfirmed: 'story.publish.confirmed',
  insightsCaptured: 'story.insights.captured',
  circuitTripped: 'story.circuit.tripped',
} as const

/** Machine-readable receipt written for every attempt / event (design §4.3). */
export interface StoryReceipt {
  request_id: string
  client_id: string
  pack_id: string
  item_id: string
  channel: StoryChannel
  status: StoryAttemptStatus
  /** Why the status was reached (stable code, never free text from a provider). */
  reason_code: string | null
  /** Facebook post_id / Instagram media id. null until a provider returned one — never invented. */
  provider_receipt: string | null
  authorization_id: string | null
  /** e.g. ACTIVE / EXPIRED / REVOKED / NOT_ACTIVATED / FINGERPRINT_MISMATCH / NONE */
  authorization_state: string
  content_hash: string
  mode: 'DRY_RUN' | 'LIVE'
  provider_impact: 'NONE' | 'STORY_PUBLISHED'
  cost_usd: number
  created_at: string
}

/** Environment-derived switches, passed in as plain data. */
export interface StorySwitches {
  /** True only when STORY_AUTO_PUBLISH_LIVE is exactly the string 'true'. */
  live: boolean
  /** Lowercased client ids allowed to publish for real. */
  clientIds: string[]
  /** Channels allowed to publish for real. */
  channels: StoryChannel[]
}

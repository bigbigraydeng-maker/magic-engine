/**
 * Story auto-publish — storage port (slice 2b).
 *
 * The service layer (authorize / revoke / preview / open records) talks only to
 * this interface. Two implementations exist: an in-memory one (tests and the
 * dry-run rehearsal) and a Supabase one. Neither is allowed to be "clever":
 * every write below is a single, explicit operation, and database errors are
 * thrown, never swallowed (a caller that cannot tell "write failed" from "write
 * succeeded" could double-publish).
 */
import type { StoryAuthorization, StoryAttemptStatus, StoryChannel, StoryItemSpec } from './types'

/** An item as stored: the authorised spec plus the fields the database owns. */
export interface StoredStoryItem extends StoryItemSpec {
  /** The grant covering this item (null = never authorised). */
  authorization_id: string | null
  /** Set when a person or the circuit breaker paused just this item. */
  paused_at: string | null
}

/** What a caller supplies when granting; the database assigns `id` and leaves the revocation columns empty. */
export type NewStoryAuthorization = Omit<
  StoryAuthorization,
  'id' | 'activated_at' | 'revoked_at'
> & {
  request_id: string
}

export type InsertStoryAuthorizationResult =
  | { ok: true; authorization: StoryAuthorization }
  | { ok: false; error: 'ALREADY_AUTHORIZED' }

/** Evidence that a person opened one item (the server computes the fingerprint, never the browser). */
export interface StoryOpenRecord {
  item_id: string
  channel: StoryChannel
  opened_by_user_id: string
  /** Content fingerprint of the item at the moment it was opened. */
  opened_fingerprint: string
  opened_at: string
}

/** The attempt row fields the service layer reads (the publisher owns writing them). */
export interface StoryAttemptView {
  item_id: string
  channel: StoryChannel
  status: StoryAttemptStatus
}

/** A circuit-breaker mark. `channel` null = the whole pack; `item_id` set = one item. */
export interface StoryPauseMark {
  channel: StoryChannel | null
  item_id: string | null
}

/** The accounts a client is registered against, read from the client record. */
export interface RegisteredStoryAccounts {
  facebook_page_id: string | null
  instagram_user_id: string | null
  client_status: string | null
}

export interface StoryStore {
  /** Every item of a pack, in a stable order (by slot, then item id, then channel). */
  getPackItems(packId: string, clientId: string): Promise<StoredStoryItem[]>

  /** The live (not revoked) grant of a pack, or null. Expiry is NOT filtered here. */
  getLiveAuthorization(packId: string, clientId: string): Promise<StoryAuthorization | null>

  /** Insert an inactive grant carrying its frozen manifest hash and approved fingerprints. */
  insertAuthorization(
    row: NewStoryAuthorization,
  ): Promise<InsertStoryAuthorizationResult>

  /** Arm a grant (stamp activated_at). Null when it was revoked in the meantime. */
  activateAuthorization(authId: string, clientId: string): Promise<StoryAuthorization | null>

  /** Revoke exactly this grant. Null when nothing live matched (a repeat revoke is a no-op). */
  revokeAuthorization(input: {
    authId: string
    packId: string
    clientId: string
    byEmail: string
    reason: string
    now: Date
  }): Promise<StoryAuthorization | null>

  /**
   * Point items at the grant that covers them. Scoped to the pack and client: an item id that belongs
   * to another pack or client is "unknown" and throws.
   */
  linkItemsToAuthorization(input: {
    authId: string
    packId: string
    clientId: string
    items: Array<{ item_id: string; channel: StoryChannel }>
  }): Promise<void>

  /** Record that a person opened an item (idempotent per user + fingerprint). */
  recordOpen(record: StoryOpenRecord): Promise<void>

  /** All open records of a pack. */
  listOpens(packId: string): Promise<StoryOpenRecord[]>

  /** Attempts already on file for a pack (so a preview can say what is already sent). */
  listAttempts(packId: string): Promise<StoryAttemptView[]>

  /** Active (not lifted) circuit-breaker marks of a pack: whole pack / one channel / one item. */
  getActivePauses(packId: string, clientId: string): Promise<StoryPauseMark[]>

  /** The registered accounts and status of a client; null when the client does not exist. */
  getRegisteredAccounts(clientId: string): Promise<RegisteredStoryAccounts | null>

  /** Whether somebody is on reply duty for that client on that calendar date (YYYY-MM-DD). */
  hasReplyOwner(clientId: string, dutyDate: string): Promise<boolean>

  /** Whether this media file (sha256) was already published as a post / reel / story. */
  getAssetUsage(mediaSha256: string): Promise<'UNUSED' | 'USED' | 'UNKNOWN'>
}

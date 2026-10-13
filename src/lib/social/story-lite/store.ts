/**
 * Story "lite" — storage port. Two implementations: in-memory (tests, rehearsal) and Supabase.
 * Database errors are thrown, never swallowed; the only meaningful non-throw outcomes are the
 * explicit `ok:false` / null results documented per method.
 */
import type { LiteItem, LiteItemStatus, LitePack, NewLiteItem } from './types'

export interface ClientRegistration {
  facebook_page_id: string | null
  client_status: string | null
}

export interface LiteStore {
  /** Create a pack with its items (status PENDING). Throws when an item id already exists. */
  insertPack(pack: { id: string; client_id: string; title: string; now: Date }, items: NewLiteItem[]): Promise<void>

  getPack(packId: string, clientId: string): Promise<LitePack | null>

  /** The client's newest packs (created_at desc), at most `limit`, each with its item count — for the preview page list. */
  listPacksForClient(clientId: string, limit: number): Promise<Array<{ pack: LitePack; item_count: number }>>

  /** Every item of a pack ordered by slot, then item id. */
  getItems(packId: string, clientId: string): Promise<LiteItem[]>

  /**
   * Authorise once: succeeds only for a pack that is neither authorised nor revoked.
   * Also stamps each item's `authorized_fingerprint`. All-or-nothing.
   */
  authorizePack(input: {
    packId: string
    clientId: string
    byEmail: string
    byUserId: string
    now: Date
    expiresAt: Date
    contentHash: string
    fingerprints: Record<string, string>
  }): Promise<{ ok: true; pack: LitePack } | { ok: false; error: 'ALREADY_AUTHORIZED' | 'REVOKED' | 'NOT_FOUND' }>

  /** Stop a pack. Null when it does not exist or was already revoked (a repeat is a no-op). */
  revokePack(input: { packId: string; clientId: string; byEmail: string; reason: string; now: Date }): Promise<LitePack | null>

  /** Packs that are authorised, not revoked and not expired at `now` — what a sweep works on. */
  listLivePacks(now: Date): Promise<LitePack[]>

  /** PENDING -> CLAIMED, atomically, and attempt_count + 1. Null when somebody else got it. */
  claimItem(itemId: string, now: Date): Promise<LiteItem | null>

  /** CLAIMED -> a final status (or back to PENDING). False when the item was no longer CLAIMED. */
  settleItem(input: {
    itemId: string
    to: LiteItemStatus
    reasonCode: string | null
    providerReceipt?: string | null
    now: Date
  }): Promise<boolean>

  /** Record what a dry run / pre-send check saw, without changing the status. */
  recordCheck(itemId: string, result: string, now: Date): Promise<void>

  /** CLAIMED rows older than `olderThanMs` become UNKNOWN_OUTCOME (a sweep died mid-send). Returns the ids. */
  expireStaleClaims(now: Date, olderThanMs: number): Promise<string[]>

  /** The registered Page and status of a client; null when the client does not exist. */
  getClientRegistration(clientId: string): Promise<ClientRegistration | null>
}

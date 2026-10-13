/**
 * Story "lite" — in-memory implementation of `LiteStore`.
 *
 * A faithful model of the two tables in lite.sql: a pack plus its items, one authorisation per
 * pack, one claim per item. Used by tests and rehearsal; no I/O. Every read returns a deep copy
 * so a caller can never mutate stored state by accident.
 */
import type { ClientRegistration, LiteStore } from './store'
import type { LiteItem, LiteItemStatus, LitePack, NewLiteItem } from './types'

function copyPack(pack: LitePack): LitePack {
  return { ...pack }
}

function copyItem(item: LiteItem): LiteItem {
  return { ...item }
}

export class InMemoryLiteStore implements LiteStore {
  private readonly packs = new Map<string, LitePack>()
  private readonly items = new Map<string, LiteItem>()
  private readonly clients = new Map<string, ClientRegistration>()

  /** Seed the registered Page and status of a client (stands in for the clients table). */
  seedClient(clientId: string, registration: ClientRegistration): void {
    this.clients.set(clientId, { ...registration })
  }

  /** Every pack, as copies. */
  allPacks(): LitePack[] {
    return [...this.packs.values()].map(copyPack)
  }

  /** Every item, as copies. */
  allItems(): LiteItem[] {
    return [...this.items.values()].map(copyItem)
  }

  async insertPack(
    pack: { id: string; client_id: string; title: string; now: Date },
    items: NewLiteItem[],
  ): Promise<void> {
    if (this.packs.has(pack.id)) throw new Error('duplicate pack')
    for (const item of items) {
      if (this.items.has(item.item_id)) throw new Error('duplicate item')
    }

    const createdAt = pack.now.toISOString()
    const stored: LitePack = {
      id: pack.id,
      client_id: pack.client_id,
      title: pack.title,
      created_at: createdAt,
      authorized_at: null,
      authorized_by_email: null,
      authorized_by_user_id: null,
      expires_at: null,
      authorized_content_hash: null,
      revoked_at: null,
      revoked_by_email: null,
      revoked_reason: null,
    }
    this.packs.set(stored.id, stored)

    for (const item of items) {
      const row: LiteItem = {
        item_id: item.item_id,
        pack_id: pack.id,
        client_id: pack.client_id,
        channel: item.channel,
        slot_at: item.slot_at,
        media_kind: item.media_kind,
        media_url: item.media_url,
        media_sha256: item.media_sha256,
        text_line: item.text_line,
        account_id: item.account_id,
        source_ref: item.source_ref,
        status: 'PENDING',
        authorized_fingerprint: null,
        attempt_count: 0,
        claimed_at: null,
        sent_at: null,
        provider_receipt: null,
        reason_code: null,
        last_check_at: null,
        last_check_result: null,
      }
      this.items.set(row.item_id, row)
    }
  }

  async getPack(packId: string, clientId: string): Promise<LitePack | null> {
    const pack = this.packs.get(packId)
    if (!pack || pack.client_id !== clientId) return null
    return copyPack(pack)
  }

  async listPacksForClient(clientId: string, limit: number): Promise<Array<{ pack: LitePack; item_count: number }>> {
    return Array.from(this.packs.values())
      .filter((pack) => pack.client_id === clientId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .slice(0, limit)
      .map((pack) => ({
        pack: copyPack(pack),
        item_count: Array.from(this.items.values()).filter((item) => item.pack_id === pack.id).length,
      }))
  }

  async getItems(packId: string, clientId: string): Promise<LiteItem[]> {
    const pack = this.packs.get(packId)
    if (!pack || pack.client_id !== clientId) return []
    return [...this.items.values()]
      .filter((item) => item.pack_id === packId)
      .sort((a, b) => {
        if (a.slot_at < b.slot_at) return -1
        if (a.slot_at > b.slot_at) return 1
        if (a.item_id < b.item_id) return -1
        if (a.item_id > b.item_id) return 1
        return 0
      })
      .map(copyItem)
  }

  async authorizePack(input: {
    packId: string
    clientId: string
    byEmail: string
    byUserId: string
    now: Date
    expiresAt: Date
    contentHash: string
    fingerprints: Record<string, string>
  }): Promise<{ ok: true; pack: LitePack } | { ok: false; error: 'ALREADY_AUTHORIZED' | 'REVOKED' | 'NOT_FOUND' }> {
    const pack = this.packs.get(input.packId)
    if (!pack || pack.client_id !== input.clientId) return { ok: false, error: 'NOT_FOUND' }
    if (pack.revoked_at !== null) return { ok: false, error: 'REVOKED' }
    if (pack.authorized_at !== null) return { ok: false, error: 'ALREADY_AUTHORIZED' }

    const packItems = [...this.items.values()].filter((item) => item.pack_id === input.packId)
    for (const item of packItems) {
      if (input.fingerprints[item.item_id] === undefined) throw new Error('missing fingerprint')
    }

    pack.authorized_at = input.now.toISOString()
    pack.authorized_by_email = input.byEmail
    pack.authorized_by_user_id = input.byUserId
    pack.expires_at = input.expiresAt.toISOString()
    pack.authorized_content_hash = input.contentHash

    for (const item of packItems) {
      item.authorized_fingerprint = input.fingerprints[item.item_id]
    }

    return { ok: true, pack: copyPack(pack) }
  }

  async revokePack(input: {
    packId: string
    clientId: string
    byEmail: string
    reason: string
    now: Date
  }): Promise<LitePack | null> {
    const pack = this.packs.get(input.packId)
    if (!pack || pack.client_id !== input.clientId) return null
    if (pack.revoked_at !== null) return null

    pack.revoked_at = input.now.toISOString()
    pack.revoked_by_email = input.byEmail
    pack.revoked_reason = input.reason
    return copyPack(pack)
  }

  async listLivePacks(now: Date): Promise<LitePack[]> {
    const nowIso = now.toISOString()
    return [...this.packs.values()]
      .filter(
        (pack) =>
          pack.authorized_at !== null && pack.revoked_at === null && pack.expires_at !== null && pack.expires_at > nowIso,
      )
      .map(copyPack)
  }

  async claimItem(itemId: string, now: Date): Promise<LiteItem | null> {
    const item = this.items.get(itemId)
    if (!item || item.status !== 'PENDING') return null
    item.status = 'CLAIMED'
    item.claimed_at = now.toISOString()
    item.attempt_count += 1
    return copyItem(item)
  }

  async settleItem(input: {
    itemId: string
    to: LiteItemStatus
    reasonCode: string | null
    providerReceipt?: string | null
    now: Date
  }): Promise<boolean> {
    const item = this.items.get(input.itemId)
    if (!item || item.status !== 'CLAIMED') return false

    const receipt = input.providerReceipt ?? null
    if (input.to === 'SENT') {
      if (receipt === null || receipt.trim().length === 0) throw new Error('SENT needs a receipt')
    } else if (receipt !== null) {
      throw new Error('receipt only when SENT')
    }

    item.status = input.to
    item.reason_code = input.reasonCode
    if (input.to === 'PENDING') {
      item.claimed_at = null
    }
    if (input.to === 'SENT') {
      item.provider_receipt = receipt
      item.sent_at = input.now.toISOString()
    }
    return true
  }

  async recordCheck(itemId: string, result: string, now: Date): Promise<void> {
    const item = this.items.get(itemId)
    if (!item) throw new Error('unknown item')
    item.last_check_at = now.toISOString()
    item.last_check_result = result
  }

  async expireStaleClaims(now: Date, olderThanMs: number): Promise<string[]> {
    const cutoff = now.getTime() - olderThanMs
    const expired: string[] = []
    for (const item of this.items.values()) {
      if (item.status !== 'CLAIMED' || item.claimed_at === null) continue
      if (Date.parse(item.claimed_at) < cutoff) {
        item.status = 'UNKNOWN_OUTCOME'
        item.reason_code = 'STALE_CLAIM'
        expired.push(item.item_id)
      }
    }
    return expired
  }

  async getClientRegistration(clientId: string): Promise<ClientRegistration | null> {
    const registration = this.clients.get(clientId)
    return registration ? { ...registration } : null
  }
}

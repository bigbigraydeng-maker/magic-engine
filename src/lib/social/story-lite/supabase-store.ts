/**
 * Story "lite" — Supabase implementation of `LiteStore`.
 *
 * Mirrors the behaviour of `InMemoryLiteStore` exactly, against the two tables in lite.sql
 * (story_packs + story_items) and the existing `clients` table. Every database error is thrown;
 * the only meaningful non-throw outcomes are the explicit `ok:false` / null results documented
 * on the port. Timestamps are normalised to ISO-8601 UTC on the way out.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRegistration, LiteStore } from './store'
import { LITE_ROLES, type LiteItem, type LiteItemStatus, type LitePack, type LiteRole, type NewLiteItem } from './types'

function isLiteRole(value: unknown): value is LiteRole {
  return typeof value === 'string' && (LITE_ROLES as readonly string[]).includes(value)
}

interface PackRow {
  id: string
  client_id: string
  title: string
  created_at: string
  authorized_at: string | null
  authorized_by_email: string | null
  authorized_by_user_id: string | null
  expires_at: string | null
  authorized_content_hash: string | null
  revoked_at: string | null
  revoked_by_email: string | null
  revoked_reason: string | null
}

interface ItemRow {
  /** Only present once the optional role column exists. */
  role?: string | null
  item_id: string
  pack_id: string
  client_id: string
  channel: LiteItem['channel']
  slot_at: string
  media_kind: LiteItem['media_kind']
  media_url: string
  media_sha256: string
  text_line: string
  account_id: string
  source_ref: string
  status: LiteItemStatus
  authorized_fingerprint: string | null
  attempt_count: number
  claimed_at: string | null
  sent_at: string | null
  provider_receipt: string | null
  reason_code: string | null
  last_check_at: string | null
  last_check_result: string | null
}

interface ClientRow {
  facebook_page_id: string | null
  client_status: string | null
}

/** Normalise a timestamptz to ISO-8601 UTC; null stays null. */
function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function mapPack(row: PackRow): LitePack {
  return {
    id: row.id,
    client_id: row.client_id,
    title: row.title,
    created_at: new Date(row.created_at).toISOString(),
    authorized_at: iso(row.authorized_at),
    authorized_by_email: row.authorized_by_email,
    authorized_by_user_id: row.authorized_by_user_id,
    expires_at: iso(row.expires_at),
    authorized_content_hash: row.authorized_content_hash,
    revoked_at: iso(row.revoked_at),
    revoked_by_email: row.revoked_by_email,
    revoked_reason: row.revoked_reason,
  }
}

function mapItem(row: ItemRow): LiteItem {
  return {
    item_id: row.item_id,
    pack_id: row.pack_id,
    client_id: row.client_id,
    channel: row.channel,
    slot_at: new Date(row.slot_at).toISOString(),
    media_kind: row.media_kind,
    media_url: row.media_url,
    media_sha256: row.media_sha256,
    text_line: row.text_line,
    account_id: row.account_id,
    source_ref: row.source_ref,
    status: row.status,
    authorized_fingerprint: row.authorized_fingerprint,
    attempt_count: row.attempt_count,
    claimed_at: iso(row.claimed_at),
    sent_at: iso(row.sent_at),
    provider_receipt: row.provider_receipt,
    reason_code: row.reason_code,
    last_check_at: iso(row.last_check_at),
    last_check_result: row.last_check_result,
    ...(isLiteRole(row.role) ? { role: row.role } : {}),
  }
}

export class SupabaseLiteStore implements LiteStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertPack(
    pack: { id: string; client_id: string; title: string; now: Date },
    items: NewLiteItem[],
  ): Promise<void> {
    const { error: packError } = await this.db.from('story_packs').insert({
      id: pack.id,
      client_id: pack.client_id,
      title: pack.title,
      created_at: pack.now.toISOString(),
    })
    if (packError) throw packError

    if (items.length === 0) return

    const rows = items.map((item) => ({
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
    }))
    const { error: itemsError } = await this.db.from('story_items').insert(rows)
    if (itemsError) throw itemsError
  }

  async getPack(packId: string, clientId: string): Promise<LitePack | null> {
    const { data, error } = await this.db
      .from('story_packs')
      .select('*')
      .eq('id', packId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) throw error
    return data === null ? null : mapPack(data as PackRow)
  }

  async getItems(packId: string, clientId: string): Promise<LiteItem[]> {
    const { data, error } = await this.db
      .from('story_items')
      .select('*')
      .eq('pack_id', packId)
      .eq('client_id', clientId)
      .order('slot_at', { ascending: true })
      .order('item_id', { ascending: true })
    if (error) throw error
    return ((data as ItemRow[] | null) ?? []).map(mapItem)
  }

  /** Store each item's fingerprint. Harmless while the pack is not authorised (the sweep only reads live packs). */
  private async writeFingerprints(items: LiteItem[], fingerprints: Record<string, string>): Promise<void> {
    for (const item of items) {
      const { error } = await this.db
        .from('story_items')
        .update({ authorized_fingerprint: fingerprints[item.item_id] })
        .eq('item_id', item.item_id)
      if (error) throw error
    }
  }

  /** Why a conditional authorisation update matched nothing. */
  private async whyNotAuthorized(
    packId: string,
    clientId: string,
  ): Promise<{ ok: false; error: 'ALREADY_AUTHORIZED' | 'REVOKED' | 'NOT_FOUND' }> {
    const current = await this.getPack(packId, clientId)
    if (current === null) return { ok: false, error: 'NOT_FOUND' }
    if (current.revoked_at !== null) return { ok: false, error: 'REVOKED' }
    return { ok: false, error: 'ALREADY_AUTHORIZED' }
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
    const existing = await this.getPack(input.packId, input.clientId)
    if (existing === null) return { ok: false, error: 'NOT_FOUND' }
    if (existing.revoked_at !== null) return { ok: false, error: 'REVOKED' }
    if (existing.authorized_at !== null) return { ok: false, error: 'ALREADY_AUTHORIZED' }

    const items = await this.getItems(input.packId, input.clientId)
    for (const item of items) {
      if (input.fingerprints[item.item_id] === undefined) throw new Error('missing fingerprint')
    }

    // Order matters: fingerprints FIRST, the authorisation stamp LAST. A sweep that runs in between sees
    // a pack that is not authorised yet and ignores it; stamping first would let it meet an item with
    // no fingerprint and block it for good.
    await this.writeFingerprints(items, input.fingerprints)

    const { data, error } = await this.db
      .from('story_packs')
      .update({
        authorized_at: input.now.toISOString(),
        authorized_by_email: input.byEmail,
        authorized_by_user_id: input.byUserId,
        expires_at: input.expiresAt.toISOString(),
        authorized_content_hash: input.contentHash,
      })
      .eq('id', input.packId)
      .eq('client_id', input.clientId)
      .is('authorized_at', null)
      .is('revoked_at', null)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (data === null) return this.whyNotAuthorized(input.packId, input.clientId)

    return { ok: true, pack: mapPack(data as PackRow) }
  }

  async revokePack(input: {
    packId: string
    clientId: string
    byEmail: string
    reason: string
    now: Date
  }): Promise<LitePack | null> {
    const { data, error } = await this.db
      .from('story_packs')
      .update({
        revoked_at: input.now.toISOString(),
        revoked_by_email: input.byEmail,
        revoked_reason: input.reason,
      })
      .eq('id', input.packId)
      .eq('client_id', input.clientId)
      .is('revoked_at', null)
      .select('*')
      .maybeSingle()
    if (error) throw error
    return data === null ? null : mapPack(data as PackRow)
  }

  async listPacksForClient(clientId: string, limit: number): Promise<Array<{ pack: LitePack; item_count: number }>> {
    const { data, error } = await this.db
      .from('story_packs')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
    if (error) throw error
    const packs = ((data as PackRow[] | null) ?? []).map(mapPack)
    const result: Array<{ pack: LitePack; item_count: number }> = []
    for (const pack of packs) {
      const { count, error: countError } = await this.db
        .from('story_items')
        .select('item_id', { count: 'exact', head: true })
        .eq('pack_id', pack.id)
      if (countError) throw countError
      result.push({ pack, item_count: count ?? 0 })
    }
    return result
  }

  async listLivePacks(now: Date): Promise<LitePack[]> {
    const { data, error } = await this.db
      .from('story_packs')
      .select('*')
      .not('authorized_at', 'is', null)
      .is('revoked_at', null)
      .gt('expires_at', now.toISOString())
    if (error) throw error
    return ((data as PackRow[] | null) ?? []).map(mapPack)
  }

  async claimItem(itemId: string, now: Date): Promise<LiteItem | null> {
    const { data: current, error: readError } = await this.db
      .from('story_items')
      .select('*')
      .eq('item_id', itemId)
      .maybeSingle()
    if (readError) throw readError
    if (current === null) return null

    const row = current as ItemRow
    if (row.status !== 'PENDING') return null

    const { data, error } = await this.db
      .from('story_items')
      .update({
        status: 'CLAIMED',
        claimed_at: now.toISOString(),
        attempt_count: row.attempt_count + 1,
      })
      .eq('item_id', itemId)
      .eq('status', 'PENDING')
      .eq('attempt_count', row.attempt_count)
      .select('*')
      .maybeSingle()
    if (error) throw error
    return data === null ? null : mapItem(data as ItemRow)
  }

  async settleItem(input: {
    itemId: string
    to: LiteItemStatus
    reasonCode: string | null
    providerReceipt?: string | null
    now: Date
  }): Promise<boolean> {
    const receipt = input.providerReceipt ?? null
    if (input.to === 'SENT') {
      if (receipt === null || receipt.trim().length === 0) throw new Error('SENT needs a receipt')
    } else if (receipt !== null) {
      throw new Error('receipt only when SENT')
    }

    const patch: Record<string, unknown> = {
      status: input.to,
      reason_code: input.reasonCode,
    }
    if (input.to === 'PENDING') patch.claimed_at = null
    if (input.to === 'SENT') {
      patch.provider_receipt = receipt
      patch.sent_at = input.now.toISOString()
    }

    const { data, error } = await this.db
      .from('story_items')
      .update(patch)
      .eq('item_id', input.itemId)
      .eq('status', 'CLAIMED')
      .select('item_id')
    if (error) throw error
    return ((data as { item_id: string }[] | null) ?? []).length > 0
  }

  async recordCheck(itemId: string, result: string, now: Date): Promise<void> {
    const { data, error } = await this.db
      .from('story_items')
      .update({ last_check_at: now.toISOString(), last_check_result: result })
      .eq('item_id', itemId)
      .select('item_id')
    if (error) throw error
    if (((data as { item_id: string }[] | null) ?? []).length === 0) throw new Error('unknown item')
  }

  async expireStaleClaims(now: Date, olderThanMs: number): Promise<string[]> {
    const cutoff = new Date(now.getTime() - olderThanMs).toISOString()
    const { data, error } = await this.db
      .from('story_items')
      .update({ status: 'UNKNOWN_OUTCOME', reason_code: 'STALE_CLAIM' })
      .eq('status', 'CLAIMED')
      .lt('claimed_at', cutoff)
      .select('item_id')
    if (error) throw error
    return ((data as { item_id: string }[] | null) ?? []).map((row) => row.item_id)
  }

  async getClientRegistration(clientId: string): Promise<ClientRegistration | null> {
    const { data, error } = await this.db
      .from('clients')
      .select('facebook_page_id, client_status')
      .eq('id', clientId)
      .maybeSingle()
    if (error) throw error
    if (data === null) return null
    const row = data as ClientRow
    return { facebook_page_id: row.facebook_page_id, client_status: row.client_status }
  }
}

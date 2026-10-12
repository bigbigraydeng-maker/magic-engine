/**
 * Story auto-publish — Supabase storage implementation (slice 2b).
 *
 * Implements `StoryStore` against the tables in story-sql.sql. Behaviour must
 * match `InMemoryStoryStore` exactly: every database error is thrown (never
 * swallowed), the only meaningful non-throw error is a unique violation on
 * insertAuthorization (=> ALREADY_AUTHORIZED), and every timestamptz read back
 * from Postgres is normalised to an ISO-8601 UTC string.
 *
 * No `any`, no `as unknown as`: rows are read through small interfaces and
 * mapped explicitly.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  InsertStoryAuthorizationResult,
  NewStoryAuthorization,
  RegisteredStoryAccounts,
  StoryAttemptView,
  StoryOpenRecord,
  StoryPauseMark,
  StoryStore,
  StoredStoryItem,
} from './store'
import type {
  StoryAuthorization,
  StoryAttemptStatus,
  StoryChannel,
  StoryMediaKind,
} from './types'

// ---- row shapes -----------------------------------------------------------

interface ItemRow {
  item_id: string
  pack_id: string
  client_id: string
  channel: string
  slot_at: string
  media_kind: string
  media_url: string
  media_sha256: string
  text_line: string
  account_id: string
  source_record_ids: string[]
  website_ref: string
  website_checked_on: string
  has_reply_cta: boolean
  contains_price: boolean
  names_place: boolean
  authorization_id: string | null
  paused_at: string | null
}

interface AuthRow {
  id: string
  pack_id: string
  client_id: string
  authorized_by_email: string
  authorized_by_user_id: string
  authorized_at: string
  activated_at: string | null
  expires_at: string
  revoked_at: string | null
  manifest_hash: string
  approved_item_fingerprints: Record<string, string>
}

interface OpenRow {
  item_id: string
  channel: string
  opened_by_user_id: string
  opened_fingerprint: string
  opened_at: string
}

interface AttemptRow {
  item_id: string
  channel: string
  status: string
}

interface ClientRow {
  facebook_page_id: string | null
  client_status: string | null
}

interface ItemIdRow {
  item_id: string
}

interface IdRow {
  id: string
}

interface UsedInRow {
  used_in: string
}

interface PauseRow {
  channel: string | null
  item_id: string | null
}

// ---- helpers --------------------------------------------------------------

/** Normalise a Postgres timestamptz string to ISO-8601 UTC; null stays null. */
function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function mapItem(row: ItemRow): StoredStoryItem {
  return {
    item_id: row.item_id,
    pack_id: row.pack_id,
    client_id: row.client_id,
    channel: row.channel as StoryChannel,
    slot_at: new Date(row.slot_at).toISOString(),
    media_kind: row.media_kind as StoryMediaKind,
    media_url: row.media_url,
    media_sha256: row.media_sha256,
    text_line: row.text_line,
    account_id: row.account_id,
    source_record_ids: [...row.source_record_ids],
    website_ref: row.website_ref,
    website_checked_on: row.website_checked_on,
    has_reply_cta: row.has_reply_cta,
    contains_price: row.contains_price,
    names_place: row.names_place,
    authorization_id: row.authorization_id,
    paused_at: iso(row.paused_at),
  }
}

function mapAuth(row: AuthRow): StoryAuthorization {
  return {
    id: row.id,
    pack_id: row.pack_id,
    client_id: row.client_id,
    authorized_by_email: row.authorized_by_email,
    authorized_by_user_id: row.authorized_by_user_id,
    authorized_at: new Date(row.authorized_at).toISOString(),
    activated_at: iso(row.activated_at),
    expires_at: new Date(row.expires_at).toISOString(),
    revoked_at: iso(row.revoked_at),
    manifest_hash: row.manifest_hash,
    approved_item_fingerprints: { ...row.approved_item_fingerprints },
  }
}

// ---- store ----------------------------------------------------------------

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505'

export class SupabaseStoryStore implements StoryStore {
  constructor(private readonly db: SupabaseClient) {}

  async getPackItems(packId: string, clientId: string): Promise<StoredStoryItem[]> {
    const { data, error } = await this.db
      .from('story_pack_items')
      .select('*')
      .eq('pack_id', packId)
      .eq('client_id', clientId)
      .order('slot_at', { ascending: true })
      .order('item_id', { ascending: true })
      .order('channel', { ascending: true })
    if (error) throw error
    const rows = data as ItemRow[] | null
    return (rows ?? []).map(mapItem)
  }

  async getLiveAuthorization(
    packId: string,
    clientId: string,
  ): Promise<StoryAuthorization | null> {
    const { data, error } = await this.db
      .from('story_pack_auth')
      .select('*')
      .eq('pack_id', packId)
      .eq('client_id', clientId)
      .is('revoked_at', null)
      .maybeSingle()
    if (error) throw error
    const row = data as AuthRow | null
    return row ? mapAuth(row) : null
  }

  async insertAuthorization(
    row: NewStoryAuthorization,
  ): Promise<InsertStoryAuthorizationResult> {
    const { data, error } = await this.db
      .from('story_pack_auth')
      .insert({
        request_id: row.request_id,
        client_id: row.client_id,
        pack_id: row.pack_id,
        authorized_by_email: row.authorized_by_email,
        authorized_by_user_id: row.authorized_by_user_id,
        authorized_at: row.authorized_at,
        expires_at: row.expires_at,
        manifest_hash: row.manifest_hash,
        approved_item_fingerprints: row.approved_item_fingerprints,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'ALREADY_AUTHORIZED' }
      throw error
    }
    return { ok: true, authorization: mapAuth(data as AuthRow) }
  }

  async activateAuthorization(
    authId: string,
    clientId: string,
  ): Promise<StoryAuthorization | null> {
    const { data, error } = await this.db
      .from('story_pack_auth')
      .update({ activated_at: new Date().toISOString() })
      .eq('id', authId)
      .eq('client_id', clientId)
      .is('revoked_at', null)
      .is('activated_at', null)
      .select('*')
      .maybeSingle()
    if (error) throw error
    const updated = data as AuthRow | null
    if (updated) return mapAuth(updated)

    // Nothing was updated: either the grant is already activated (idempotent
    // success) or it is revoked / missing (null).
    const { data: existing, error: readError } = await this.db
      .from('story_pack_auth')
      .select('*')
      .eq('id', authId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (readError) throw readError
    const row = existing as AuthRow | null
    if (row && row.revoked_at === null && row.activated_at !== null) {
      return mapAuth(row)
    }
    return null
  }

  async revokeAuthorization(input: {
    authId: string
    packId: string
    clientId: string
    byEmail: string
    reason: string
    now: Date
  }): Promise<StoryAuthorization | null> {
    const { data, error } = await this.db
      .from('story_pack_auth')
      .update({
        revoked_at: input.now.toISOString(),
        revoked_by_email: input.byEmail,
        revoked_reason: input.reason,
      })
      .eq('id', input.authId)
      .eq('pack_id', input.packId)
      .eq('client_id', input.clientId)
      .is('revoked_at', null)
      .select('*')
      .maybeSingle()
    if (error) throw error
    const row = data as AuthRow | null
    return row ? mapAuth(row) : null
  }

  async linkItemsToAuthorization(input: {
    authId: string
    packId: string
    clientId: string
    items: Array<{ item_id: string; channel: StoryChannel }>
  }): Promise<void> {
    for (const ref of input.items) {
      const { data, error } = await this.db
        .from('story_pack_items')
        .update({ authorization_id: input.authId })
        .eq('item_id', ref.item_id)
        .eq('channel', ref.channel)
        .eq('pack_id', input.packId)
        .eq('client_id', input.clientId)
        .select('item_id')
      if (error) throw error
      const rows = data as ItemIdRow[] | null
      if (!rows || rows.length === 0) throw new Error('unknown item')
    }
  }

  async recordOpen(record: StoryOpenRecord): Promise<void> {
    const { error } = await this.db.from('story_pack_item_opens').insert({
      item_id: record.item_id,
      channel: record.channel,
      opened_by_user_id: record.opened_by_user_id,
      opened_fingerprint: record.opened_fingerprint,
      opened_at: record.opened_at,
    })
    // The same person opening the same version twice on the same UTC day is one record, not an error.
    // An unknown item surfaces as the foreign-key error and is thrown.
    if (error && error.code !== UNIQUE_VIOLATION) throw error
  }

  async listOpens(packId: string): Promise<StoryOpenRecord[]> {
    const { data: itemData, error: itemError } = await this.db
      .from('story_pack_items')
      .select('item_id')
      .eq('pack_id', packId)
    if (itemError) throw itemError
    const itemRows = itemData as ItemIdRow[] | null
    const ids = (itemRows ?? []).map((r) => r.item_id)
    if (ids.length === 0) return []

    const { data, error } = await this.db
      .from('story_pack_item_opens')
      .select('item_id, channel, opened_by_user_id, opened_fingerprint, opened_at')
      .in('item_id', ids)
    if (error) throw error
    const rows = data as OpenRow[] | null
    return (rows ?? []).map((row) => ({
      item_id: row.item_id,
      channel: row.channel as StoryChannel,
      opened_by_user_id: row.opened_by_user_id,
      opened_fingerprint: row.opened_fingerprint,
      opened_at: new Date(row.opened_at).toISOString(),
    }))
  }

  async listAttempts(packId: string): Promise<StoryAttemptView[]> {
    const { data, error } = await this.db
      .from('story_publish_attempts')
      .select('item_id, channel, status')
      .eq('pack_id', packId)
    if (error) throw error
    const rows = data as AttemptRow[] | null
    return (rows ?? []).map((row) => ({
      item_id: row.item_id,
      channel: row.channel as StoryChannel,
      status: row.status as StoryAttemptStatus,
    }))
  }

  async getActivePauses(
    packId: string,
    clientId: string,
  ): Promise<StoryPauseMark[]> {
    const { data, error } = await this.db
      .from('story_pack_pauses')
      .select('channel, item_id')
      .eq('pack_id', packId)
      .eq('client_id', clientId)
      .is('lifted_at', null)
    if (error) throw error
    const rows = data as PauseRow[] | null
    return (rows ?? []).map((row) => ({
      channel: row.channel === null ? null : (row.channel as StoryChannel),
      item_id: row.item_id,
    }))
  }

  async getRegisteredAccounts(
    clientId: string,
  ): Promise<RegisteredStoryAccounts | null> {
    const { data, error } = await this.db
      .from('clients')
      .select('facebook_page_id, client_status')
      .eq('id', clientId)
      .maybeSingle()
    if (error) throw error
    const row = data as ClientRow | null
    if (!row) return null
    return {
      facebook_page_id: row.facebook_page_id,
      // The clients table has no Instagram user id column yet, so an Instagram
      // story cannot be authorised until a registered Instagram account id
      // exists. Always null for now.
      instagram_user_id: null,
      client_status: row.client_status,
    }
  }

  async hasReplyOwner(clientId: string, dutyDate: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('story_reply_duty')
      .select('id')
      .eq('client_id', clientId)
      .eq('duty_date', dutyDate)
      .limit(1)
    if (error) throw error
    const rows = data as IdRow[] | null
    return (rows ?? []).length > 0
  }

  async getAssetUsage(mediaSha256: string): Promise<'UNUSED' | 'USED' | 'UNKNOWN'> {
    const { data, error } = await this.db
      .from('story_asset_usage')
      .select('used_in')
      .eq('media_sha256', mediaSha256)
    if (error) throw error
    const rows = data as UsedInRow[] | null
    // The table only records files that were used. An absent row means the
    // usage is unknown, never that the file is unused — so 'UNUSED' is
    // returned by nothing here.
    return (rows ?? []).length > 0 ? 'USED' : 'UNKNOWN'
  }
}

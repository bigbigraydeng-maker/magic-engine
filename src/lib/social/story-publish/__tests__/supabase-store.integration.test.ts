/**
 * Story auto-publish — SupabaseStoryStore integration rehearsal (slice 2b).
 *
 * This is an END-TO-END rehearsal against a real Postgres through PostgREST.
 * It is skipped unless STORY_REST_URL and STORY_REST_KEY are both set, so the
 * normal unit run never touches a database. The `it` blocks below share state
 * on purpose: they walk one pack through preview -> open -> authorise ->
 * revoke, exactly as the PM would, and assert what the real tables hold after
 * each step.
 *
 * Reading process.env in a test file is fine (CLAUDE.md §3 only forbids it in
 * library code). No `any`, no `as unknown as`: rows are read through small
 * interfaces and mapped explicitly.
 */
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { authorizeStoryPack, revokeStoryPack } from '../authorize'
import { buildStoryPackPreview, recordStoryItemOpen } from '../preview'
import { SupabaseStoryStore } from '../supabase-store'
import type { StoryActor, StoryServicePorts } from '../service-ports'
import type { StoryChannel } from '../types'

/** A fresh 64-hex hash per run: asset-usage rows are never deleted, so reruns must not share hashes. */
function freshSha(): string {
  return (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64)
}
const SHA_A = freshSha()
const SHA_B = freshSha()
const SHA_C = freshSha()
const SHA_D = freshSha()

const REST_URL = process.env.STORY_REST_URL
const REST_KEY = process.env.STORY_REST_KEY

/** Read a required env var, throwing a clear error when it is missing. */
function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} missing`)
  return value
}

// ---- row shapes (only the columns this test reads back) -------------------

interface ItemRow {
  item_id: string
  channel: string
  slot_at: string
  text_line: string
  authorization_id: string | null
}

interface AuthRow {
  id: string
  pack_id: string
  activated_at: string | null
  revoked_at: string | null
  expires_at: string
  manifest_hash: string
  approved_item_fingerprints: Record<string, string>
}

interface ClientRow {
  id: string
}

interface OpenRow {
  id: string
}

interface DutyRow {
  id: string
}

interface UsageRow {
  id: string
}

// ---- fixtures -------------------------------------------------------------

const NOW = new Date('2026-10-12T00:00:00.000Z')
const ADMIN: StoryActor = { id: randomUUID(), email: 'pm@example.com', allowedClientId: null }

/** The three items of the rehearsal pack: two facebook images, one facebook video. */
function packItems(clientId: string, packId: string): Array<Record<string, unknown>> {
  const base = {
    pack_id: packId,
    client_id: clientId,
    media_kind: 'image',
    media_url: 'https://cdn.example.com/x.jpg',
    text_line: 'Hello world',
    account_id: '1234567890',
    source_record_ids: ['fact-1'],
    website_ref: 'https://example.com/p',
    website_checked_on: '2026-10-12',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
  }
  return [
    {
      ...base,
      item_id: randomUUID(),
      channel: 'facebook_story',
      slot_at: '2026-10-12T20:00:00+13:00',
      media_sha256: SHA_A,
    },
    {
      ...base,
      item_id: randomUUID(),
      channel: 'facebook_story',
      slot_at: '2026-10-12T21:00:00+13:00',
      media_sha256: SHA_B,
    },
    {
      ...base,
      item_id: randomUUID(),
      channel: 'facebook_story',
      slot_at: '2026-10-12T22:00:00+13:00',
      media_kind: 'video',
      media_sha256: SHA_C,
    },
  ]
}

describe.skipIf(!REST_URL || !REST_KEY)('SupabaseStoryStore against a real database', () => {
  let db: SupabaseClient
  let store: SupabaseStoryStore
  let ports: StoryServicePorts
  let clientId: string
  let packId: string
  let items: Array<Record<string, unknown>>
  let videoItemId: string
  let authId: string

  beforeAll(async () => {
    db = createClient(env('STORY_REST_URL'), env('STORY_REST_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    store = new SupabaseStoryStore(db)
    ports = {
      store,
      adminEmails: new Set(['pm@example.com']),
      checkFile: async () => 'OK',
      checkPrice: async () => 'OK',
      sendEvent: vi.fn(async () => {}),
      newId: () => randomUUID(),
      config: {
        maxLateMinutes: 30,
        earlyMinutes: 30,
        staleClaimMinutes: 15,
        stalePublishingMinutes: 10,
        maxWebsiteAgeDays: 7,
        maxRetries: 3,
      },
    }

    // Fresh ids per run so reruns never collide with rows left behind (the
    // story tables are never deleted — see the cleanup note in afterAll).
    clientId = randomUUID()
    packId = randomUUID()
    items = packItems(clientId, packId)
    videoItemId = items[2].item_id as string

    const clientInsert = await db.from('clients').insert({
      id: clientId,
      facebook_page_id: '1234567890',
      client_status: 'active',
    })
    if (clientInsert.error) throw clientInsert.error

    const itemInsert = await db.from('story_pack_items').insert(items)
    if (itemInsert.error) throw itemInsert.error
  })

  afterAll(async () => {
    // The story tables are never deleted (triggers block it), so the rows this
    // run created stay behind under their unique random ids. Only the clients
    // row is removed, best effort.
    if (!db || !clientId) return
    try {
      await db.from('clients').delete().eq('id', clientId)
    } catch {
      // Best effort: a leftover clients row is harmless.
    }
  })

  // ---- 1. read paths ------------------------------------------------------

  /** The hash the REAL preview shows right now: a confirmation must carry it. */
  async function previewHash(): Promise<string> {
    const preview = await buildStoryPackPreview({ ports, packId, clientId, actor: ADMIN, now: NOW })
    if (!preview.ok) throw new Error('preview failed: ' + preview.error)
    return preview.value.content_hash
  }

  it('only links items that belong to the named pack and client', async () => {
    // a second pack of the same client, with its own items
    const otherPackId = randomUUID()
    const otherItems: Array<Record<string, unknown>> = packItems(clientId, otherPackId).map((row) => ({
      ...row,
      media_sha256: freshSha(),
    }))
    const insert = await db.from('story_pack_items').insert(otherItems)
    if (insert.error) throw insert.error

    const foreign = { item_id: String(otherItems[0].item_id), channel: 'facebook_story' as const }
    await expect(
      store.linkItemsToAuthorization({ authId: randomUUID(), packId, clientId, items: [foreign] }),
    ).rejects.toThrow('unknown item')
    await expect(
      store.linkItemsToAuthorization({ authId: randomUUID(), packId: otherPackId, clientId: randomUUID(), items: [foreign] }),
    ).rejects.toThrow('unknown item')

    const stored = await db.from('story_pack_items').select('authorization_id').eq('pack_id', otherPackId)
    expect(stored.error).toBeNull()
    expect((stored.data ?? []).every((row: { authorization_id: string | null }) => row.authorization_id === null)).toBe(true)
  })

  it('reads only the active circuit marks of the named pack', async () => {
    const pausedPackId = randomUUID()
    const rows = [
      { client_id: clientId, pack_id: pausedPackId, channel: null, item_id: null, reason_code: 'MANUAL', created_by: 'pm@example.com' },
      { client_id: clientId, pack_id: pausedPackId, channel: 'facebook_story', item_id: randomUUID(), reason_code: 'UNKNOWN_OUTCOME', created_by: 'system:circuit' },
      {
        client_id: clientId, pack_id: pausedPackId, channel: 'instagram_story', item_id: null, reason_code: 'LIFTED',
        created_by: 'system:circuit', lifted_at: new Date().toISOString(), lifted_by_email: 'pm@example.com',
      },
    ]
    const insert = await db.from('story_pack_pauses').insert(rows)
    if (insert.error) throw insert.error

    const marks = await store.getActivePauses(pausedPackId, clientId)
    expect(marks).toHaveLength(2)
    expect(marks).toContainEqual({ channel: null, item_id: null })
    expect(marks.some((m) => m.channel === 'facebook_story' && m.item_id !== null)).toBe(true)
    expect(marks.some((m) => m.channel === 'instagram_story')).toBe(false)
    expect(await store.getActivePauses(packId, clientId)).toEqual([])
    expect(await store.getActivePauses(pausedPackId, randomUUID())).toEqual([])
  })

  it('writes a fresh open record when the same unchanged item is opened again on a later day', async () => {
    const renewalPack = randomUUID()
    const rows: Array<Record<string, unknown>> = packItems(clientId, renewalPack).map((row) => ({
      ...row,
      media_sha256: freshSha(),
    }))
    const insert = await db.from('story_pack_items').insert(rows)
    if (insert.error) throw insert.error
    const itemId = String(rows[2].item_id)
    const user = randomUUID()
    const base = { item_id: itemId, channel: 'facebook_story' as const, opened_by_user_id: user, opened_fingerprint: 'a'.repeat(64) }

    await store.recordOpen({ ...base, opened_at: '2026-10-12T10:00:00.000Z' })
    await store.recordOpen({ ...base, opened_at: '2026-10-12T22:00:00.000Z' }) // same UTC day: one record
    expect(await store.listOpens(renewalPack)).toHaveLength(1)
    await store.recordOpen({ ...base, opened_at: '2026-10-13T11:00:00.000Z' }) // next day: renewal
    expect(await store.listOpens(renewalPack)).toHaveLength(2)
  })

  it('refuses a confirmation that carries a stale preview hash and writes nothing', async () => {
    const result = await authorizeStoryPack({
      ports, packId, clientId, actor: ADMIN, confirm: true, expectedContentHash: 'f'.repeat(64), now: NOW,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('PACK_CHANGED_SINCE_PREVIEW')
    const auths = await db.from('story_pack_auth').select('id').eq('pack_id', packId)
    expect(auths.data ?? []).toEqual([])
  })

  it('reads the pack back sorted with canonical timestamps', async () => {
    const read = await store.getPackItems(packId, clientId)
    expect(read).toHaveLength(3)
    expect(read.map((item) => item.item_id)).toEqual([
      items[0].item_id,
      items[1].item_id,
      items[2].item_id,
    ])
    for (const item of read) {
      expect(item.slot_at.endsWith('Z')).toBe(true)
      expect(item.website_checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('reads the registered accounts of the client', async () => {
    const accounts = await store.getRegisteredAccounts(clientId)
    expect(accounts).toEqual({
      facebook_page_id: '1234567890',
      instagram_user_id: null,
      client_status: 'active',
    })
  })

  it('reports reply duty only once a duty row exists', async () => {
    expect(await store.hasReplyOwner(clientId, '2026-10-12')).toBe(false)

    const duty = await db.from('story_reply_duty').insert({
      client_id: clientId,
      duty_date: '2026-10-12',
      on_duty_email: 'owner@example.com',
      created_by_email: 'pm@example.com',
    })
    if (duty.error) throw duty.error

    expect(await store.hasReplyOwner(clientId, '2026-10-12')).toBe(true)
  })

  // uses a hash no seeded item has, so it does not change the later authorisation checks
  it('reports asset usage as UNKNOWN until a usage row exists', async () => {
    expect(await store.getAssetUsage(SHA_D)).toBe('UNKNOWN')

    const usage = await db.from('story_asset_usage').insert({
      media_sha256: SHA_D,
      used_in: 'post',
      used_ref: `ref-${randomUUID()}`,
    })
    if (usage.error) throw usage.error

    expect(await store.getAssetUsage(SHA_D)).toBe('USED')
  })

  // ---- 2. preview fails closed on the real store --------------------------

  it('refuses to authorise while asset usage is unknown', async () => {
    const preview = await buildStoryPackPreview({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      now: NOW,
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.can_authorize).toBe(false)
    for (const item of preview.value.items) {
      expect(item.problems).toContain('ASSET_USAGE_UNKNOWN')
    }
  })

  // ---- 3. preview after the usage override --------------------------------

  it('shows the video item as needing an open, then refuses with ITEMS_NOT_OPENED', async () => {
    // The usage recorder ships later, so the real store can never return
    // UNUSED yet. Override only getAssetUsage to rehearse the rest of the flow.
    Object.assign(store, { getAssetUsage: async () => 'UNUSED' as const })

    const preview = await buildStoryPackPreview({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      now: NOW,
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const video = preview.value.items.find((item) => item.item_id === videoItemId)
    expect(video?.requires_open).toBe(true)
    expect(video?.opened_by_me).toBe(false)

    const result = await authorizeStoryPack({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      confirm: true,
      expectedContentHash: await previewHash(),
      now: NOW,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('ITEMS_NOT_OPENED')

    const auths = await db.from('story_pack_auth').select('id').eq('pack_id', packId)
    if (auths.error) throw auths.error
    expect((auths.data as ClientRow[] | null) ?? []).toHaveLength(0)
  })

  // ---- 4. open record is idempotent ---------------------------------------

  it('records the open once even when called twice', async () => {
    const first = await recordStoryItemOpen({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      itemId: videoItemId,
      channel: 'facebook_story',
      now: NOW,
    })
    expect(first.ok).toBe(true)

    const second = await recordStoryItemOpen({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      itemId: videoItemId,
      channel: 'facebook_story',
      now: NOW,
    })
    expect(second.ok).toBe(true)

    const opens = await db
      .from('story_pack_item_opens')
      .select('id')
      .eq('item_id', videoItemId)
      .eq('channel', 'facebook_story')
    if (opens.error) throw opens.error
    expect((opens.data as OpenRow[] | null) ?? []).toHaveLength(1)
  })

  // ---- 5. authorise and read the grant back -------------------------------

  it('authorises the pack and writes the grant, links and event', async () => {
    const result = await authorizeStoryPack({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      confirm: true,
      expectedContentHash: await previewHash(),
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mode).toBe('AUTHORIZED')
    if (result.value.mode !== 'AUTHORIZED') return
    authId = result.value.authorization_id

    const auths = await db.from('story_pack_auth').select('*').eq('pack_id', packId)
    if (auths.error) throw auths.error
    const rows = (auths.data as AuthRow[] | null) ?? []
    expect(rows).toHaveLength(1)
    const auth = rows[0]
    expect(auth.id).toBe(authId)
    expect(auth.activated_at).not.toBeNull()
    expect(auth.revoked_at).toBeNull()
    expect(auth.manifest_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(auth.approved_item_fingerprints)).toHaveLength(3)

    const stored = await db
      .from('story_pack_items')
      .select('item_id, channel, slot_at, text_line, authorization_id')
      .eq('pack_id', packId)
    if (stored.error) throw stored.error
    const storedRows = (stored.data as ItemRow[] | null) ?? []
    expect(storedRows).toHaveLength(3)
    for (const row of storedRows) {
      expect(row.authorization_id).toBe(authId)
    }

    expect(ports.sendEvent).toHaveBeenCalledTimes(1)
    const event = vi.mocked(ports.sendEvent).mock.calls[0][0]
    expect(event.name).toBe('story.pack.authorized')
    expect(event.data.provider_impact).toBe('NONE')
  })

  // ---- 6. database protections --------------------------------------------

  it('blocks edits to an authorised item and to the frozen grant', async () => {
    const itemEdit = await db
      .from('story_pack_items')
      .update({ text_line: 'Edited after authorisation' })
      .eq('item_id', videoItemId)
      .eq('channel', 'facebook_story')
    expect(itemEdit.error).not.toBeNull()

    const manifestEdit = await db
      .from('story_pack_auth')
      .update({ manifest_hash: 'f'.repeat(64) })
      .eq('id', authId)
    expect(manifestEdit.error).not.toBeNull()

    const expiryEdit = await db
      .from('story_pack_auth')
      .update({ expires_at: '2027-01-01T00:00:00.000Z' })
      .eq('id', authId)
    expect(expiryEdit.error).not.toBeNull()

    const unlink = await db
      .from('story_pack_items')
      .update({ authorization_id: null })
      .eq('item_id', videoItemId)
      .eq('channel', 'facebook_story')
    expect(unlink.error).not.toBeNull()

    const deleteAuth = await db.from('story_pack_auth').delete().eq('id', authId)
    expect(deleteAuth.error).not.toBeNull()

    // The stored values are unchanged.
    const auths = await db.from('story_pack_auth').select('*').eq('id', authId)
    if (auths.error) throw auths.error
    const auth = ((auths.data as AuthRow[] | null) ?? [])[0]
    expect(auth.manifest_hash).not.toBe('f'.repeat(64))
    expect(auth.expires_at).not.toBe('2027-01-01T00:00:00.000Z')

    const stored = await db
      .from('story_pack_items')
      .select('item_id, channel, slot_at, text_line, authorization_id')
      .eq('item_id', videoItemId)
      .eq('channel', 'facebook_story')
    if (stored.error) throw stored.error
    const row = ((stored.data as ItemRow[] | null) ?? [])[0]
    expect(row.text_line).toBe('Hello world')
    expect(row.authorization_id).toBe(authId)
  })

  // ---- 7. a second grant is refused ---------------------------------------

  it('refuses a second authorise and a second live grant', async () => {
    const second = await authorizeStoryPack({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      confirm: true,
      expectedContentHash: await previewHash(),
      now: NOW,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.status).toBe(409)
    expect(second.error).toBe('ALREADY_AUTHORIZED')

    const rawInsert = await db.from('story_pack_auth').insert({
      request_id: randomUUID(),
      client_id: clientId,
      pack_id: packId,
      authorized_by_email: 'pm@example.com',
      authorized_by_user_id: ADMIN.id,
      authorized_at: NOW.toISOString(),
      expires_at: '2026-10-19T00:00:00.000Z',
      manifest_hash: 'e'.repeat(64),
      approved_item_fingerprints: {},
    })
    expect(rawInsert.error).not.toBeNull()
  })

  // ---- 8. revoke releases the lock ----------------------------------------

  it('revokes the grant, releases the content lock and refuses a second revoke', async () => {
    const result = await revokeStoryPack({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      reason: 'rehearsal',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.authorization_id).toBe(authId)
    expect(result.value.in_flight).toEqual([])

    const auths = await db.from('story_pack_auth').select('*').eq('id', authId)
    if (auths.error) throw auths.error
    const auth = ((auths.data as AuthRow[] | null) ?? [])[0]
    expect(auth.revoked_at).not.toBeNull()

    // The content lock is released once the grant is revoked.
    const edit = await db
      .from('story_pack_items')
      .update({ text_line: 'Edited after revoke' })
      .eq('item_id', videoItemId)
      .eq('channel', 'facebook_story')
    expect(edit.error).toBeNull()

    const second = await revokeStoryPack({
      ports,
      packId,
      clientId,
      actor: ADMIN,
      reason: 'rehearsal',
      now: NOW,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.status).toBe(404)
    expect(second.error).toBe('NOTHING_TO_REVOKE')

    // A revocation is write-once.
    const clearRevoke = await db
      .from('story_pack_auth')
      .update({ revoked_at: null })
      .eq('id', authId)
    expect(clearRevoke.error).not.toBeNull()
  })
})

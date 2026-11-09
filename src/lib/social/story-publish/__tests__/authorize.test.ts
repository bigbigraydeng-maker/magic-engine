import { describe, expect, it, vi } from 'vitest'
import { InMemoryStoryStore } from '../in-memory-store'
import { computeItemFingerprint, computeManifestHash } from '../fingerprint'
import { authorizeStoryPack, revokeStoryPack } from '../authorize'
import { buildStoryPackPreview, recordStoryItemOpen } from '../preview'
import type { StoryActor, StoryServicePorts } from '../service-ports'
import type { StoredStoryItem } from '../store'
import { STORY_EVENTS } from '../types'

const NOW = new Date('2026-10-12T00:00:00.000Z')
const SLOT = '2026-10-12T00:00:00.000Z'
const ADMIN: StoryActor = { id: 'user-1', email: 'PM@Example.com', allowedClientId: null }

function greenItem(overrides: Partial<StoredStoryItem> = {}): StoredStoryItem {
  const base: StoredStoryItem = {
    item_id: 'item-1',
    pack_id: 'pack-1',
    client_id: 'client-1',
    channel: 'facebook_story',
    slot_at: SLOT,
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.jpg',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello world',
    account_id: '1234567890',
    source_record_ids: ['fact-1'],
    website_ref: 'https://example.com/page',
    website_checked_on: '2026-10-12',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
    authorization_id: null,
    paused_at: null,
  }
  return { ...base, ...overrides }
}

function makePorts(
  store: InMemoryStoryStore,
  overrides: Partial<StoryServicePorts> = {},
): StoryServicePorts {
  let counter = 0
  return {
    store,
    adminEmails: new Set(['pm@example.com']),
    checkFile: async () => 'OK',
    checkPrice: async () => 'OK',
    sendEvent: vi.fn(async () => {}),
    newId: () => `id-${(counter += 1)}`,
    config: {
      maxLateMinutes: 30,
      earlyMinutes: 30,
      staleClaimMinutes: 15,
      stalePublishingMinutes: 10,
      maxWebsiteAgeDays: 7,
      maxRetries: 3,
    },
    ...overrides,
  }
}

function seedGreenStore(items: StoredStoryItem[] = [greenItem()]): InMemoryStoryStore {
  const store = new InMemoryStoryStore()
  store.seedItems(items)
  store.seedAccounts('client-1', {
    facebook_page_id: '1234567890',
    instagram_user_id: '9876543210',
    client_status: 'active',
  })
  for (const item of items) {
    store.seedAssetUsage(item.media_sha256, 'UNUSED')
  }
  return store
}

/** A pack of three items: two facebook, one video that needs an open. */
function threeItemPack(): StoredStoryItem[] {
  return [
    greenItem({ item_id: 'item-1', channel: 'facebook_story' }),
    greenItem({
      item_id: 'item-2',
      channel: 'facebook_story',
      slot_at: '2026-10-12T01:00:00.000Z',
      media_sha256: 'b'.repeat(64),
    }),
    greenItem({
      item_id: 'item-3',
      channel: 'facebook_story',
      slot_at: '2026-10-12T02:00:00.000Z',
      media_kind: 'video',
      media_sha256: 'c'.repeat(64),
    }),
  ]
}

async function authorize(
  ports: StoryServicePorts,
  overrides: Partial<{
    packId: string
    clientId: string
    actor: StoryActor
    confirm: boolean
    expiresInDays: number
    expectedContentHash: string | null
    now: Date
  }> = {},
) {
  const packId = overrides.packId ?? 'pack-1'
  const clientId = overrides.clientId ?? 'client-1'
  const actor = overrides.actor ?? ADMIN
  const now = overrides.now ?? NOW
  // A confirmation must carry the hash its own preview showed; fetch it unless the test sets one
  // (`null` = send none).
  let expectedContentHash: string | undefined
  if (overrides.expectedContentHash === null) {
    expectedContentHash = undefined
  } else if (overrides.expectedContentHash !== undefined) {
    expectedContentHash = overrides.expectedContentHash
  } else {
    const preview = await buildStoryPackPreview({
      ports, packId, clientId, actor, now, expiresInDays: overrides.expiresInDays,
    })
    expectedContentHash = preview.ok ? preview.value.content_hash : undefined
  }
  return authorizeStoryPack({
    ports,
    packId,
    clientId,
    actor,
    confirm: overrides.confirm ?? true,
    expiresInDays: overrides.expiresInDays,
    expectedContentHash,
    now,
  })
}

async function openItem(
  ports: StoryServicePorts,
  itemId: string,
  channel: 'facebook_story' | 'instagram_story' = 'facebook_story',
) {
  return recordStoryItemOpen({
    ports,
    packId: 'pack-1',
    clientId: 'client-1',
    actor: ADMIN,
    itemId,
    channel,
    now: NOW,
  })
}

describe('authorizeStoryPack — access and expiry', () => {
  it('rejects a non-admin with 403', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await authorize(ports, {
      actor: { id: 'user-2', email: 'nobody@example.com', allowedClientId: null },
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a bad expiry with 400 BAD_EXPIRY', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await authorize(ports, { expiresInDays: 0 })

    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_EXPIRY' })
  })
})

describe('authorizeStoryPack — preview mode', () => {
  it('returns a PREVIEW and writes nothing when confirm is false', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await authorize(ports, { confirm: false })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mode).toBe('PREVIEW')
    expect(store.allAuthorizations()).toEqual([])
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })
})

describe('authorizeStoryPack — blocked packs', () => {
  it('returns 409 ITEMS_NOT_OPENED listing the unopened item and writes nothing', async () => {
    const store = seedGreenStore(threeItemPack())
    const ports = makePorts(store)
    const result = await authorize(ports)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('ITEMS_NOT_OPENED')
    expect(result.details).toEqual([{ item_id: 'item-3', channel: 'facebook_story' }])
    expect(store.allAuthorizations()).toEqual([])
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })

  it('returns 422 PACK_NOT_AUTHORIZABLE with per-item problems', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, { checkFile: async () => 'CHANGED' })
    const result = await authorize(ports)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.error).toBe('PACK_NOT_AUTHORIZABLE')
    expect(result.details).toEqual([
      { item_id: 'item-1', channel: 'facebook_story', problems: ['FILE_CHANGED'] },
    ])
    expect(store.allAuthorizations()).toEqual([])
  })
})

describe('authorizeStoryPack — success', () => {
  it('inserts, arms and links the grant and sends one event', async () => {
    const store = seedGreenStore(threeItemPack())
    const ports = makePorts(store)

    await openItem(ports, 'item-3')

    const result = await authorize(ports)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.mode).toBe('AUTHORIZED')
    if (result.value.mode !== 'AUTHORIZED') return

    const auths = store.allAuthorizations()
    expect(auths).toHaveLength(1)
    expect(auths[0].id).toBe(result.value.authorization_id)
    expect(auths[0].activated_at).not.toBeNull()
    expect(auths[0].revoked_at).toBeNull()

    for (const item of store.allItems()) {
      expect(item.authorization_id).toBe(result.value.authorization_id)
    }

    expect(ports.sendEvent).toHaveBeenCalledTimes(1)
    const event = vi.mocked(ports.sendEvent).mock.calls[0][0]
    expect(event.id).toBe(result.value.request_id)
    expect(event.name).toBe('story.pack.authorized')
    expect(event.data.provider_impact).toBe('NONE')

    const expiresAt = result.value.expires_at
    const items = store.allItems()
    expect(auths[0].manifest_hash).toBe(computeManifestHash(items, expiresAt))
    for (const item of items) {
      expect(auths[0].approved_item_fingerprints[`${item.item_id}:${item.channel}`]).toBe(
        computeItemFingerprint(item, expiresAt),
      )
    }
  })

  it('returns 409 ALREADY_AUTHORIZED on a second authorise', async () => {
    const store = seedGreenStore(threeItemPack())
    const ports = makePorts(store)
    await openItem(ports, 'item-3')

    const first = await authorize(ports)
    expect(first.ok).toBe(true)

    const second = await authorize(ports)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.status).toBe(409)
    expect(second.error).toBe('ALREADY_AUTHORIZED')
  })
})

describe('authorizeStoryPack — superseding', () => {
  it('supersedes an expired grant and revokes the old one', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)

    const old = await store.insertAuthorization({
      request_id: 'old-request',
      pack_id: 'pack-1',
      client_id: 'client-1',
      authorized_by_email: 'pm@example.com',
      authorized_by_user_id: 'user-1',
      authorized_at: '2026-10-01T00:00:00.000Z',
      expires_at: '2026-10-05T00:00:00.000Z',
      manifest_hash: 'old-manifest',
      approved_item_fingerprints: {},
    })
    expect(old.ok).toBe(true)
    if (!old.ok) return
    await store.activateAuthorization(old.authorization.id, 'client-1')

    const result = await authorize(ports)
    expect(result.ok).toBe(true)

    const oldAfter = store.allAuthorizations().find((a) => a.id === old.authorization.id)
    expect(oldAfter?.revoked_at).not.toBeNull()
    expect(store.allAuthorizations().filter((a) => a.revoked_at === null)).toHaveLength(1)
  })

  it('supersedes an un-armed grant older than five minutes', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)

    const old = await store.insertAuthorization({
      request_id: 'old-request',
      pack_id: 'pack-1',
      client_id: 'client-1',
      authorized_by_email: 'pm@example.com',
      authorized_by_user_id: 'user-1',
      authorized_at: '2026-10-11T23:00:00.000Z',
      expires_at: '2026-10-19T00:00:00.000Z',
      manifest_hash: 'old-manifest',
      approved_item_fingerprints: {},
    })
    expect(old.ok).toBe(true)

    const result = await authorize(ports)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.value.mode !== 'AUTHORIZED') return
    expect(result.value.authorization_id).not.toBe(old.ok ? old.authorization.id : '')
  })

  it('does not supersede a young un-armed grant', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)

    const old = await store.insertAuthorization({
      request_id: 'old-request',
      pack_id: 'pack-1',
      client_id: 'client-1',
      authorized_by_email: 'pm@example.com',
      authorized_by_user_id: 'user-1',
      authorized_at: '2026-10-11T23:59:00.000Z',
      expires_at: '2026-10-19T00:00:00.000Z',
      manifest_hash: 'old-manifest',
      approved_item_fingerprints: {},
    })
    expect(old.ok).toBe(true)

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('ALREADY_AUTHORIZED')
  })
})

describe('authorizeStoryPack — rollback', () => {
  it('rolls back when the authorisation event fails', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, {
      sendEvent: vi.fn(async () => {
        throw new Error('inngest down')
      }),
    })

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    expect(result.error).toBe('AUTHORIZATION_EVENT_NOT_SENT')
    expect(result.rollback).toBe('OK')
    expect(store.allAuthorizations().every((a) => a.revoked_at !== null)).toBe(true)
  })

  it('rolls back when activation throws', async () => {
    const store = seedGreenStore()
    Object.assign(store, {
      activateAuthorization: async () => {
        throw new Error('db')
      },
    })
    const ports = makePorts(store)

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    expect(result.error).toBe('AUTHORIZATION_NOT_ACTIVATED')
    expect(result.rollback).toBe('OK')
  })

  it('reports 409 AUTHORIZATION_REVOKED_DURING_ARMING when activation returns null', async () => {
    const store = seedGreenStore()
    Object.assign(store, {
      activateAuthorization: async () => null,
    })
    const ports = makePorts(store)

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('AUTHORIZATION_REVOKED_DURING_ARMING')
    expect(result.rollback).toBe('OK')
  })

  it('rolls back when linking items throws', async () => {
    const store = seedGreenStore()
    Object.assign(store, {
      linkItemsToAuthorization: async () => {
        throw new Error('db')
      },
    })
    const ports = makePorts(store)

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    expect(result.error).toBe('ITEMS_NOT_LINKED')
    expect(result.rollback).toBe('OK')
  })

  it('reports rollback FAILED when the revoke itself throws', async () => {
    const store = seedGreenStore()
    Object.assign(store, {
      activateAuthorization: async () => {
        throw new Error('db')
      },
      revokeAuthorization: async () => {
        throw new Error('db')
      },
    })
    const ports = makePorts(store)

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(500)
    expect(result.error).toBe('AUTHORIZATION_NOT_ACTIVATED')
    expect(result.rollback).toBe('FAILED')
  })

  it('refuses with 422 when a problem appears only in the write evaluation', async () => {
    const store = seedGreenStore()
    let calls = 0
    // the preview read sees the file fine; by the time the write evaluation runs it has changed
    const ports = makePorts(store, { checkFile: async () => ((calls += 1) === 1 ? 'OK' : 'CHANGED') })

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(422)
    expect(result.error).toBe('PACK_NOT_AUTHORIZABLE')
    expect(store.allAuthorizations()).toHaveLength(0)
  })

  it('refuses when an item changes between the preview read and the write read', async () => {
    const store = seedGreenStore(threeItemPack())
    const ports = makePorts(store)
    await openItem(ports, 'item-3')

    const original = store.getPackItems.bind(store)
    let calls = 0
    Object.assign(store, {
      getPackItems: async (packId: string, clientId: string) => {
        calls += 1
        const items = await original(packId, clientId)
        // read 1 = the helper's own preview, read 2 = authorize's preview (both look fine and opened);
        // read 3 = the write evaluation sees an edited video item
        if (calls === 3) {
          return items.map((item) => (item.item_id === 'item-3' ? { ...item, text_line: 'Edited after opening' } : item))
        }
        return items
      },
    })

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('PACK_CHANGED_SINCE_PREVIEW')
    expect(store.allAuthorizations()).toHaveLength(0)
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })

  it('rolls back and reports 409 PACK_CHANGED_DURING_AUTHORIZATION, before any event is sent', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)

    const original = store.getPackItems.bind(store)
    let calls = 0
    Object.assign(store, {
      getPackItems: async (packId: string, clientId: string) => {
        calls += 1
        const items = await original(packId, clientId)
        // reads 1-2 = the helper's preview and authorize's preview, read 3 = the write evaluation,
        // read 4 = the final check after linking: it sees an edit
        if (calls >= 4) {
          return items.map((item) => ({ ...item, text_line: 'Changed line' }))
        }
        return items
      },
    })

    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.error).toBe('PACK_CHANGED_DURING_AUTHORIZATION')
    expect(result.rollback).toBe('OK')
    expect(store.allAuthorizations().every((a) => a.revoked_at !== null)).toBe(true)
    // the check runs BEFORE the authorised event, so nothing downstream ever heard of this grant
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })

  it('refuses a confirmation whose lifetime differs from the previewed one', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const preview = await buildStoryPackPreview({
      ports, packId: 'pack-1', clientId: 'client-1', actor: ADMIN, now: NOW, expiresInDays: 7,
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const result = await authorize(ports, { expiresInDays: 14, expectedContentHash: preview.value.content_hash })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('PACK_CHANGED_SINCE_PREVIEW')
    expect(store.allAuthorizations()).toHaveLength(0)
  })

  it('announces the rollback when the grant was revoked by someone else during arming', async () => {
    const store = seedGreenStore()
    Object.assign(store, { activateAuthorization: async () => null })
    const names: string[] = []
    const ports = makePorts(store, { sendEvent: vi.fn(async (event: { name: string }) => { names.push(event.name) }) })
    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('AUTHORIZATION_REVOKED_DURING_ARMING')
    expect(names).toEqual([STORY_EVENTS.packAuthorized, STORY_EVENTS.packRevoked])
  })

  it('requires the preview content hash to confirm', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const missing = await authorize(ports, { expectedContentHash: null })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.status).toBe(400)
    expect(missing.error).toBe('CONTENT_HASH_REQUIRED')

    const malformed = await authorize(ports, { expectedContentHash: 'abc' })
    expect(malformed.ok).toBe(false)
    if (malformed.ok) return
    expect(malformed.error).toBe('CONTENT_HASH_REQUIRED')

    const stale = await authorize(ports, { expectedContentHash: 'f'.repeat(64) })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.status).toBe(409)
    expect(stale.error).toBe('PACK_CHANGED_SINCE_PREVIEW')
    expect(store.allAuthorizations()).toHaveLength(0)
    expect(ports.sendEvent).not.toHaveBeenCalled()
  })

  it('does not announce a revoked grant when the authorised event itself failed', async () => {
    const store = seedGreenStore()
    const names: string[] = []
    const sendEvent = vi.fn(async (event: { name: string }) => {
      names.push(event.name)
      if (event.name === STORY_EVENTS.packAuthorized) throw new Error('inngest down')
    })
    const ports = makePorts(store, { sendEvent })
    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('AUTHORIZATION_EVENT_NOT_SENT')
    expect(result.rollback).toBe('OK')
    expect(names).toEqual([STORY_EVENTS.packAuthorized])
  })

  it('announces the rollback when activation fails after the authorised event was sent', async () => {
    const store = seedGreenStore()
    Object.assign(store, { activateAuthorization: async () => { throw new Error('db') } })
    const names: string[] = []
    const sendEvent = vi.fn(async (event: { name: string }) => {
      names.push(event.name)
    })
    const ports = makePorts(store, { sendEvent })
    const result = await authorize(ports)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('AUTHORIZATION_NOT_ACTIVATED')
    expect(result.rollback).toBe('OK')
    expect(names).toEqual([STORY_EVENTS.packAuthorized, STORY_EVENTS.packRevoked])
  })

  it('links the items before it sends the authorised event', async () => {
    const store = seedGreenStore()
    const order: string[] = []
    const link = store.linkItemsToAuthorization.bind(store)
    Object.assign(store, {
      linkItemsToAuthorization: async (input: Parameters<typeof link>[0]) => {
        order.push('link')
        return link(input)
      },
    })
    const sendEvent = vi.fn(async () => {
      order.push('event')
    })
    const ports = makePorts(store, { sendEvent })
    const result = await authorize(ports)
    expect(result.ok).toBe(true)
    expect(order).toEqual(['link', 'event'])
  })

  it('reports the recorded-only note on success', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await authorize(ports)
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.mode !== 'AUTHORIZED') return
    expect(result.value.note).toBe('Recorded only. The automatic publisher is not running yet.')
  })
})

describe('revokeStoryPack', () => {
  it('rejects a non-admin with 403', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: { id: 'user-2', email: 'nobody@example.com', allowedClientId: null },
      reason: 'mistake',
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects an empty reason with 400 BAD_REASON', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: '   ',
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_REASON' })
  })

  it('rejects a reason longer than 300 chars with 400 BAD_REASON', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: 'x'.repeat(301),
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_REASON' })
  })

  it('returns 404 NOTHING_TO_REVOKE when there is no live grant', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: 'mistake', 
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'NOTHING_TO_REVOKE' })
  })

  it('revokes the live grant and returns the in-flight attempts', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    await openItem(ports, 'item-3')

    const authorized = await authorize(ports)
    expect(authorized.ok).toBe(true)
    if (!authorized.ok) return
    if (authorized.value.mode !== 'AUTHORIZED') return
    const authId = authorized.value.authorization_id

    store.seedAttempts(
      [
        { item_id: 'item-1', channel: 'facebook_story', status: 'PUBLISHING' },
        { item_id: 'item-2', channel: 'facebook_story', status: 'PUBLISHED' },
      ],
      'pack-1',
    )

    const result = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: 'mistake',
      now: NOW,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.authorization_id).toBe(authId)
    expect(result.value.in_flight).toEqual([
      { item_id: 'item-1', channel: 'facebook_story', status: 'PUBLISHING' },
    ])
    expect(result.value.note).toContain('NOT removed')

    const auth = store.allAuthorizations().find((a) => a.id === authId)
    expect(auth?.revoked_at).not.toBeNull()
  })

  it('does not undo the revoke when the event fails', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, {
      // only the revoke event fails; the authorisation event goes through
      sendEvent: vi.fn(async (event: { name: string }) => {
        if (event.name === STORY_EVENTS.packRevoked) throw new Error('inngest down')
      }),
    })
    await openItem(ports, 'item-3')

    const authorized = await authorize(ports)
    expect(authorized.ok).toBe(true)
    if (!authorized.ok) return
    if (authorized.value.mode !== 'AUTHORIZED') return
    const authId = authorized.value.authorization_id

    const result = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: 'mistake',
      now: NOW,
    })

    expect(result.ok).toBe(true)
    const auth = store.allAuthorizations().find((a) => a.id === authId)
    expect(auth?.revoked_at).not.toBeNull()
  })

  it('splits what is still in flight from what already went out', async () => {
    const store = seedGreenStore(threeItemPack())
    const ports = makePorts(store)
    await openItem(ports, 'item-3')
    const authorized = await authorize(ports)
    expect(authorized.ok).toBe(true)

    store.seedAttempts(
      [
        { item_id: 'item-1', channel: 'facebook_story', status: 'CLAIMED' },
        { item_id: 'item-2', channel: 'facebook_story', status: 'UNKNOWN_OUTCOME' },
        { item_id: 'item-3', channel: 'facebook_story', status: 'PUBLISHED_UNVERIFIED' },
      ],
      'pack-1',
    )
    const result = await revokeStoryPack({ ports, packId: 'pack-1', clientId: 'client-1', actor: ADMIN, reason: 'stop', now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.in_flight.map((a) => a.status).sort()).toEqual(['CLAIMED', 'UNKNOWN_OUTCOME'])
    expect(result.value.already_sent.map((a) => a.status)).toEqual(['PUBLISHED_UNVERIFIED'])
    expect(result.value.attempts_known).toBe(true)
  })

  it('still reports a successful revoke when the attempts cannot be read afterwards', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const authorized = await authorize(ports)
    expect(authorized.ok).toBe(true)
    Object.assign(store, { listAttempts: async () => { throw new Error('db') } })

    const result = await revokeStoryPack({ ports, packId: 'pack-1', clientId: 'client-1', actor: ADMIN, reason: 'stop', now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.attempts_known).toBe(false)
    expect(result.value.in_flight).toEqual([])
    expect(store.allAuthorizations().every((a) => a.revoked_at !== null)).toBe(true)
  })

  it('returns 404 NOTHING_TO_REVOKE on a second revoke', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    await openItem(ports, 'item-3')

    const authorized = await authorize(ports)
    expect(authorized.ok).toBe(true)

    const first = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: 'mistake',
      now: NOW,
    })
    expect(first.ok).toBe(true)

    const second = await revokeStoryPack({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: ADMIN,
      reason: 'mistake',
      now: NOW,
    })
    expect(second).toEqual({ ok: false, status: 404, error: 'NOTHING_TO_REVOKE' })
  })
})

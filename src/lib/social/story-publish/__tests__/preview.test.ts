import { describe, expect, it, vi } from 'vitest'
import { InMemoryStoryStore } from '../in-memory-store'
import { computeContentFingerprint } from '../fingerprint'
import { buildStoryPackPreview, recordStoryItemOpen } from '../preview'
import type { StoryActor, StoryServicePorts } from '../service-ports'
import type { StoredStoryItem } from '../store'

const NOW = new Date('2026-10-12T00:00:00.000Z')
const SLOT = '2026-10-12T00:00:00.000Z'

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
  return {
    store,
    adminEmails: new Set(['pm@example.com']),
    checkFile: async () => 'OK',
    checkPrice: async () => 'OK',
    sendEvent: vi.fn(async () => {}),
    newId: () => 'id-1',
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

function seedGreenStore(item: StoredStoryItem = greenItem()): InMemoryStoryStore {
  const store = new InMemoryStoryStore()
  store.seedItems([item])
  store.seedAccounts(item.client_id, {
    facebook_page_id: '1234567890',
    instagram_user_id: '9876543210',
    client_status: 'active',
  })
  store.seedAssetUsage(item.media_sha256, 'UNUSED')
  return store
}

const ADMIN: StoryActor = { id: 'user-1', email: 'PM@Example.com', allowedClientId: null }

async function preview(
  store: InMemoryStoryStore,
  ports: StoryServicePorts,
  overrides: Partial<{ packId: string; clientId: string; expiresInDays: number }> = {},
) {
  return buildStoryPackPreview({
    ports,
    packId: overrides.packId ?? 'pack-1',
    clientId: overrides.clientId ?? 'client-1',
    actor: ADMIN,
    now: NOW,
    expiresInDays: overrides.expiresInDays,
  })
}

async function open(
  store: InMemoryStoryStore,
  ports: StoryServicePorts,
  overrides: Partial<{ itemId: string; channel: 'facebook_story' | 'instagram_story'; actor: StoryActor }> = {},
) {
  return recordStoryItemOpen({
    ports,
    packId: 'pack-1',
    clientId: 'client-1',
    actor: overrides.actor ?? ADMIN,
    itemId: overrides.itemId ?? 'item-1',
    channel: overrides.channel ?? 'facebook_story',
    now: NOW,
  })
}

describe('requireGlobalAdmin (via buildStoryPackPreview)', () => {
  it('rejects a non-admin email with 403', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await buildStoryPackPreview({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: { id: 'user-2', email: 'nobody@example.com', allowedClientId: null },
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects an admin limited to one client with 403', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await buildStoryPackPreview({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: { id: 'user-1', email: 'pm@example.com', allowedClientId: 'client-x' },
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects a non-admin email on recordStoryItemOpen with 403', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await recordStoryItemOpen({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: { id: 'user-2', email: 'nobody@example.com', allowedClientId: null },
      itemId: 'item-1',
      channel: 'facebook_story',
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })

  it('rejects an admin limited to one client on recordStoryItemOpen with 403', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await recordStoryItemOpen({
      ports,
      packId: 'pack-1',
      clientId: 'client-1',
      actor: { id: 'user-1', email: 'pm@example.com', allowedClientId: 'client-x' },
      itemId: 'item-1',
      channel: 'facebook_story',
      now: NOW,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' })
  })
})

describe('buildStoryPackPreview — expiry validation', () => {
  it.each([0, 15, 1.5, Number.NaN])('rejects expiresInDays=%s with 400 BAD_EXPIRY', async (days) => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await preview(store, ports, { expiresInDays: days })

    expect(result).toEqual({ ok: false, status: 400, error: 'BAD_EXPIRY' })
  })

  it.each([1, 14])('accepts expiresInDays=%s', async (days) => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await preview(store, ports, { expiresInDays: days })

    expect(result.ok).toBe(true)
  })
})

describe('buildStoryPackPreview — pack lookup', () => {
  it('returns 404 PACK_NOT_FOUND for an empty pack', async () => {
    const store = new InMemoryStoryStore()
    const ports = makePorts(store)
    const result = await preview(store, ports)

    expect(result).toEqual({ ok: false, status: 404, error: 'PACK_NOT_FOUND' })
  })
})

describe('buildStoryPackPreview — green pack', () => {
  it('returns can_authorize true with counts', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await preview(store, ports)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.can_authorize).toBe(true)
    expect(result.value.blocking).toEqual([])
    expect(result.value.counts).toEqual({
      total: 1,
      requires_open: 0,
      opened: 0,
      with_problems: 0,
    })
    expect(result.value.items[0].problems).toEqual([])
    expect(result.value.items[0].opened_by_me).toBe(false)
  })
})

describe('buildStoryPackPreview — items not opened', () => {
  it('blocks a price item that has not been opened', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store)
    const result = await preview(store, ports)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.can_authorize).toBe(false)
    expect(result.value.blocking).toContain('ITEMS_NOT_OPENED')
    expect(result.value.counts.requires_open).toBe(1)
    expect(result.value.counts.opened).toBe(0)
  })

  it('becomes opened_by_me and can_authorize after the same actor opens it', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store)

    const opened = await open(store, ports)
    expect(opened.ok).toBe(true)

    const result = await preview(store, ports)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items[0].opened_by_me).toBe(true)
    expect(result.value.counts.opened).toBe(1)
    expect(result.value.can_authorize).toBe(true)
    expect(result.value.blocking).toEqual([])
  })

  it('does not count an open recorded by another user', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store)

    await open(store, ports, {
      actor: { id: 'user-2', email: 'pm@example.com', allowedClientId: null },
    })

    const result = await preview(store, ports)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items[0].opened_by_me).toBe(false)
    expect(result.value.can_authorize).toBe(false)
  })

  it('does not count an open after the item content changed', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store)

    await open(store, ports)

    store.seedItems([greenItem({ contains_price: true, text_line: 'Changed line' })])

    const result = await preview(store, ports)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items[0].opened_by_me).toBe(false)
    expect(result.value.can_authorize).toBe(false)
  })
})

describe('recordStoryItemOpen', () => {
  it('stores the server-computed fingerprint', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const item = store.allItems()[0]

    const result = await open(store, ports)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.fingerprint).toBe(computeContentFingerprint(item))

    const opens = await store.listOpens('pack-1')
    expect(opens).toHaveLength(1)
    expect(opens[0].opened_fingerprint).toBe(computeContentFingerprint(item))
    expect(opens[0].opened_by_user_id).toBe('user-1')
  })

  it('returns 404 ITEM_NOT_FOUND for an unknown item', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)
    const result = await open(store, ports, { itemId: 'missing' })

    expect(result).toEqual({ ok: false, status: 404, error: 'ITEM_NOT_FOUND' })
  })

  it('is idempotent when called twice', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store)

    await open(store, ports)
    await open(store, ports)

    const opens = await store.listOpens('pack-1')
    expect(opens).toHaveLength(1)
  })
})

describe('buildStoryPackPreview — problem items', () => {
  it('surfaces FILE_CHANGED and includes it in blocking', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, { checkFile: async () => 'CHANGED' })
    const result = await preview(store, ports)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items[0].problems).toEqual(['FILE_CHANGED'])
    expect(result.value.blocking).toContain('FILE_CHANGED')
    expect(result.value.can_authorize).toBe(false)
    expect(result.value.counts.with_problems).toBe(1)
  })
})

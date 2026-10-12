import { describe, expect, it, vi } from 'vitest'
import { InMemoryStoryStore } from '../in-memory-store'
import { computeContentFingerprint, computeItemFingerprint, computeManifestHash } from '../fingerprint'
import { evaluateStoryPack } from '../evaluate'
import type { StoryServicePorts } from '../service-ports'
import type { StoredStoryItem } from '../store'
import { storyItemKey, type StoryItemSpec } from '../types'

const NOW = new Date('2026-10-12T00:00:00.000Z')
const SLOT = '2026-10-12T00:00:00.000Z'
const EXPIRES_IN_DAYS = 7

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

const ACTOR = { id: 'user-1', email: 'PM@Example.com', allowedClientId: null }

async function evaluate(
  store: InMemoryStoryStore,
  ports: StoryServicePorts,
  overrides: Partial<{ packId: string; clientId: string; expiresInDays: number }> = {},
) {
  return evaluateStoryPack({
    ports,
    packId: overrides.packId ?? 'pack-1',
    clientId: overrides.clientId ?? 'client-1',
    actor: ACTOR,
    now: NOW,
    expiresInDays: overrides.expiresInDays ?? EXPIRES_IN_DAYS,
  })
}

describe('evaluateStoryPack — green path', () => {
  it('returns DRY_RUN with no problems for a green item', async () => {
    const store = seedGreenStore()
    const result = await evaluate(store, makePorts(store))

    expect(result.items).toHaveLength(1)
    expect(result.items[0].decision).toEqual({ action: 'DRY_RUN' })
    expect(result.items[0].problems).toEqual([])
  })

  it('builds a provisional grant that is never written', async () => {
    const store = seedGreenStore()
    const result = await evaluate(store, makePorts(store))

    expect(result.grant.id).toBe('provisional')
    expect(result.grant.activated_at).toBe(NOW.toISOString())
    expect(result.grant.revoked_at).toBeNull()
    expect(result.grant.authorized_by_email).toBe('pm@example.com')
    expect(result.grant.authorized_by_user_id).toBe('user-1')
    expect(store.allAuthorizations()).toEqual([])
  })

  it('computes expiresAt as now + expiresInDays', async () => {
    const store = seedGreenStore()
    const result = await evaluate(store, makePorts(store))

    expect(result.expiresAt).toBe(
      new Date(NOW.getTime() + EXPIRES_IN_DAYS * 86_400_000).toISOString(),
    )
  })

  it('matches computeManifestHash and computeItemFingerprint for the same expiry', async () => {
    const store = seedGreenStore()
    const result = await evaluate(store, makePorts(store))

    const items = store.allItems()
    expect(result.manifestHash).toBe(computeManifestHash(items, result.expiresAt))
    expect(result.approvedFingerprints).toEqual({
      [storyItemKey(items[0])]: computeItemFingerprint(items[0], result.expiresAt),
    })
  })

  it('returns no items for an empty pack', async () => {
    const store = new InMemoryStoryStore()
    const result = await evaluate(store, makePorts(store))

    expect(result.items).toEqual([])
    expect(result.manifestHash).toBe(computeManifestHash([], result.expiresAt))
  })
})

describe('evaluateStoryPack — file checks', () => {
  it('reports FILE_CHANGED when the file changed', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, { checkFile: async () => 'CHANGED' })
    const result = await evaluate(store, ports)

    expect(result.items[0].problems).toEqual(['FILE_CHANGED'])
  })

  it('reports FILE_UNREACHABLE as a retryable record', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, { checkFile: async () => 'UNREACHABLE' })
    const result = await evaluate(store, ports)

    expect(result.items[0].decision).toEqual({
      action: 'RECORD',
      status: 'RETRYABLE',
      reason_code: 'FILE_UNREACHABLE',
      retryable: true,
    })
    expect(result.items[0].problems).toEqual(['FILE_UNREACHABLE'])
  })

  it('fails closed when checkFile throws', async () => {
    const store = seedGreenStore()
    const ports = makePorts(store, {
      checkFile: async () => {
        throw new Error('boom')
      },
    })
    const result = await evaluate(store, ports)

    expect(result.items[0].problems).toEqual(['FILE_UNREACHABLE'])
  })
})

describe('evaluateStoryPack — price gate', () => {
  it('reports PRICE_GATE_BLOCKED when the price check blocks', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store, { checkPrice: async () => 'BLOCKED' })
    const result = await evaluate(store, ports)

    expect(result.items[0].problems).toEqual(['PRICE_GATE_BLOCKED'])
  })

  it('reports PRICE_GATE_ERROR when the price check errors', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store, { checkPrice: async () => 'ERROR' })
    const result = await evaluate(store, ports)

    expect(result.items[0].problems).toEqual(['PRICE_GATE_ERROR'])
  })

  it('fails closed when checkPrice throws', async () => {
    const store = seedGreenStore(greenItem({ contains_price: true }))
    const ports = makePorts(store, {
      checkPrice: async () => {
        throw new Error('boom')
      },
    })
    const result = await evaluate(store, ports)

    expect(result.items[0].problems).toEqual(['PRICE_GATE_ERROR'])
  })

  it('does not call checkPrice for an item without a price', async () => {
    const store = seedGreenStore()
    const checkPrice = vi.fn(async () => 'BLOCKED' as const)
    const ports = makePorts(store, { checkPrice })
    const result = await evaluate(store, ports)

    expect(checkPrice).not.toHaveBeenCalled()
    expect(result.items[0].problems).toEqual([])
  })
})

describe('evaluateStoryPack — asset usage', () => {
  it('reports ASSET_ALREADY_USED for a used facebook asset', async () => {
    const store = seedGreenStore()
    store.seedAssetUsage('a'.repeat(64), 'USED')
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['ASSET_ALREADY_USED'])
  })

  it('reports ASSET_USAGE_UNKNOWN when the asset usage is unknown on facebook', async () => {
    const store = new InMemoryStoryStore()
    const item = greenItem()
    store.seedItems([item])
    store.seedAccounts(item.client_id, {
      facebook_page_id: '1234567890',
      instagram_user_id: '9876543210',
      client_status: 'active',
    })
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['ASSET_USAGE_UNKNOWN'])
  })

  it('does not block an instagram item on unknown asset usage', async () => {
    const store = new InMemoryStoryStore()
    const item = greenItem({ channel: 'instagram_story' })
    store.seedItems([item])
    store.seedAccounts(item.client_id, {
      facebook_page_id: '1234567890',
      instagram_user_id: '1234567890',
      client_status: 'active',
    })
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual([])
  })
})

describe('evaluateStoryPack — context gates', () => {
  it('reports ACCOUNT_MISMATCH when the registered account differs', async () => {
    const store = seedGreenStore()
    store.seedAccounts('client-1', {
      facebook_page_id: '0000000000',
      instagram_user_id: '9876543210',
      client_status: 'active',
    })
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['ACCOUNT_MISMATCH'])
  })

  it('reports CLIENT_NOT_ACTIVE when the client is paused', async () => {
    const store = seedGreenStore()
    store.seedAccounts('client-1', {
      facebook_page_id: '1234567890',
      instagram_user_id: '9876543210',
      client_status: 'paused',
    })
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['CLIENT_NOT_ACTIVE'])
  })

  it('reports CIRCUIT_PAUSED when the item is paused', async () => {
    const store = seedGreenStore(greenItem({ paused_at: '2026-10-11T00:00:00.000Z' }))
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['CIRCUIT_PAUSED'])
  })

  it('reports SOURCE_MISSING when the item has no source records', async () => {
    const store = seedGreenStore(greenItem({ source_record_ids: [] }))
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['SOURCE_MISSING'])
  })
})

describe('evaluateStoryPack — timing and authorisation', () => {
  it('reports EXPIRED when the slot is after the grant expiry', async () => {
    const store = seedGreenStore(greenItem({ slot_at: '2026-10-25T00:00:00.000Z' }))
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].decision).toEqual({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'EXPIRED',
      retryable: false,
    })
    expect(result.items[0].problems).toEqual(['EXPIRED'])
  })

  it('reports WEBSITE_CHECK_STALE when the check is older than the max age', async () => {
    const store = seedGreenStore(greenItem({ website_checked_on: '2026-10-01' }))
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['WEBSITE_CHECK_STALE'])
  })
})

describe('evaluateStoryPack — reply owner', () => {
  it('reports NO_REPLY_OWNER when a reply CTA has no duty row', async () => {
    const store = seedGreenStore(greenItem({ has_reply_cta: true }))
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual(['NO_REPLY_OWNER'])
  })

  it('passes when a duty row exists for the NZ date of the slot', async () => {
    const store = seedGreenStore(greenItem({ has_reply_cta: true }))
    store.seedReplyDuty('client-1', '2026-10-12')
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].problems).toEqual([])
  })
})

describe('evaluateStoryPack — existing attempts', () => {
  it('reports ALREADY_ATTEMPTED and sets alreadyAttempted', async () => {
    const store = seedGreenStore()
    store.seedAttempts(
      [{ item_id: 'item-1', channel: 'facebook_story', status: 'PUBLISHED' }],
      'pack-1',
    )
    const result = await evaluate(store, makePorts(store))

    expect(result.items[0].alreadyAttempted).toBe('PUBLISHED')
    expect(result.items[0].problems).toContain('ALREADY_ATTEMPTED')
  })
})

describe('evaluateStoryPack — requiresOpen and openedByActor', () => {
  it('requires open for price, place and video items', async () => {
    const store = new InMemoryStoryStore()
    const items = [
      greenItem({ item_id: 'price', contains_price: true }),
      greenItem({ item_id: 'place', names_place: true }),
      greenItem({ item_id: 'video', media_kind: 'video' }),
      greenItem({ item_id: 'plain' }),
    ]
    store.seedItems(items)
    store.seedAccounts('client-1', {
      facebook_page_id: '1234567890',
      instagram_user_id: '9876543210',
      client_status: 'active',
    })
    for (const item of items) store.seedAssetUsage(item.media_sha256, 'UNUSED')

    const result = await evaluate(store, makePorts(store))
    const byId = new Map(result.items.map((entry) => [entry.item.item_id, entry]))

    expect(byId.get('price')?.requiresOpen).toBe(true)
    expect(byId.get('place')?.requiresOpen).toBe(true)
    expect(byId.get('video')?.requiresOpen).toBe(true)
    expect(byId.get('plain')?.requiresOpen).toBe(false)
  })

  it('marks openedByActor only for the same user and current fingerprint', async () => {
    const store = seedGreenStore()
    const item = store.allItems()[0]
    const currentFingerprint = computeContentFingerprint(item)

    store.seedItems([item])
    await store.recordOpen({
      item_id: item.item_id,
      channel: item.channel,
      opened_by_user_id: 'user-1',
      opened_fingerprint: currentFingerprint,
      opened_at: NOW.toISOString(),
    })

    const result = await evaluate(store, makePorts(store))
    expect(result.items[0].openedByActor).toBe(true)
  })

  it('does not mark openedByActor for another user', async () => {
    const store = seedGreenStore()
    const item = store.allItems()[0]
    await store.recordOpen({
      item_id: item.item_id,
      channel: item.channel,
      opened_by_user_id: 'someone-else',
      opened_fingerprint: computeContentFingerprint(item),
      opened_at: NOW.toISOString(),
    })

    const result = await evaluate(store, makePorts(store))
    expect(result.items[0].openedByActor).toBe(false)
  })

  it('does not mark openedByActor for a stale fingerprint', async () => {
    const store = seedGreenStore()
    const item = store.allItems()[0]
    await store.recordOpen({
      item_id: item.item_id,
      channel: item.channel,
      opened_by_user_id: 'user-1',
      opened_fingerprint: 'stale-fingerprint',
      opened_at: NOW.toISOString(),
    })

    const result = await evaluate(store, makePorts(store))
    expect(result.items[0].openedByActor).toBe(false)
  })
})

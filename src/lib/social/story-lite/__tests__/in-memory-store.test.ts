import { describe, expect, it } from 'vitest'

import { InMemoryLiteStore } from '../in-memory-store'
import type { ClientRegistration } from '../store'
import type { LiteItem, NewLiteItem } from '../types'

const CLIENT = 'client-1'
const OTHER_CLIENT = 'client-2'
const PACK_ID = 'pack-1'

function newItem(overrides: Partial<NewLiteItem> = {}): NewLiteItem {
  return {
    item_id: 'item-1',
    channel: 'facebook_story',
    slot_at: '2026-10-13T09:00:00.000Z',
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello',
    account_id: '1234567890',
    source_ref: 'https://example.com/claim',
    ...overrides,
  }
}

function fullItem(overrides: Partial<LiteItem> = {}): LiteItem {
  return {
    item_id: 'item-1',
    pack_id: PACK_ID,
    client_id: CLIENT,
    channel: 'facebook_story',
    slot_at: '2026-10-13T09:00:00.000Z',
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello',
    account_id: '1234567890',
    source_ref: 'https://example.com/claim',
    status: 'PENDING',
    authorized_fingerprint: null,
    attempt_count: 0,
    claimed_at: null,
    sent_at: null,
    provider_receipt: null,
    reason_code: null,
    last_check_at: null,
    last_check_result: null,
    ...overrides,
  }
}

const NOW = new Date('2026-10-12T00:00:00.000Z')
const EXPIRES = new Date('2026-10-19T00:00:00.000Z')

async function seedPack(store: InMemoryLiteStore, items: NewLiteItem[] = [newItem()]): Promise<void> {
  await store.insertPack({ id: PACK_ID, client_id: CLIENT, title: 'Week 1', now: NOW }, items)
}

describe('insertPack', () => {
  it('creates a pack with all authorisation fields null and PENDING items', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)

    const pack = await store.getPack(PACK_ID, CLIENT)
    expect(pack).not.toBeNull()
    expect(pack?.authorized_at).toBeNull()
    expect(pack?.revoked_at).toBeNull()
    expect(pack?.expires_at).toBeNull()
    expect(pack?.authorized_content_hash).toBeNull()
    expect(pack?.created_at).toBe(NOW.toISOString())

    const items = await store.getItems(PACK_ID, CLIENT)
    expect(items).toHaveLength(1)
    expect(items[0].status).toBe('PENDING')
    expect(items[0].attempt_count).toBe(0)
    expect(items[0].claimed_at).toBeNull()
    expect(items[0].sent_at).toBeNull()
    expect(items[0].provider_receipt).toBeNull()
    expect(items[0].authorized_fingerprint).toBeNull()
    expect(items[0].client_id).toBe(CLIENT)
    expect(items[0].pack_id).toBe(PACK_ID)
  })

  it('throws on a duplicate pack id and stores nothing', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await expect(seedPack(store)).rejects.toThrow('duplicate pack')
    expect(store.allPacks()).toHaveLength(1)
  })

  it('throws on a duplicate item id and stores nothing', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack({ id: PACK_ID, client_id: CLIENT, title: 'Week 1', now: NOW }, [newItem()])
    await expect(
      store.insertPack({ id: 'pack-2', client_id: CLIENT, title: 'Week 2', now: NOW }, [newItem()]),
    ).rejects.toThrow('duplicate item')
    expect(store.allPacks()).toHaveLength(1)
    expect(store.allItems()).toHaveLength(1)
  })
})

describe('getPack / getItems', () => {
  it('returns null / empty for a mismatched client', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    expect(await store.getPack(PACK_ID, OTHER_CLIENT)).toBeNull()
    expect(await store.getItems(PACK_ID, OTHER_CLIENT)).toEqual([])
  })

  it('sorts items by slot_at then item_id', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store, [
      newItem({ item_id: 'b', slot_at: '2026-10-13T10:00:00.000Z' }),
      newItem({ item_id: 'a', slot_at: '2026-10-13T10:00:00.000Z' }),
      newItem({ item_id: 'c', slot_at: '2026-10-13T09:00:00.000Z' }),
    ])
    const items = await store.getItems(PACK_ID, CLIENT)
    expect(items.map((item) => item.item_id)).toEqual(['c', 'a', 'b'])
  })

  it('returns deep copies', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const pack = await store.getPack(PACK_ID, CLIENT)
    const items = await store.getItems(PACK_ID, CLIENT)
    if (pack) pack.title = 'mutated'
    items[0].status = 'SENT'
    expect((await store.getPack(PACK_ID, CLIENT))?.title).toBe('Week 1')
    expect((await store.getItems(PACK_ID, CLIENT))[0].status).toBe('PENDING')
  })
})

describe('authorizePack', () => {
  it('sets the authorisation fields and each item fingerprint', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const result = await store.authorizePack({
      packId: PACK_ID,
      clientId: CLIENT,
      byEmail: 'pm@example.com',
      byUserId: 'user-1',
      now: NOW,
      expiresAt: EXPIRES,
      contentHash: 'c'.repeat(64),
      fingerprints: { 'item-1': 'f'.repeat(64) },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pack.authorized_at).toBe(NOW.toISOString())
      expect(result.pack.expires_at).toBe(EXPIRES.toISOString())
      expect(result.pack.authorized_content_hash).toBe('c'.repeat(64))
    }
    const items = await store.getItems(PACK_ID, CLIENT)
    expect(items[0].authorized_fingerprint).toBe('f'.repeat(64))
  })

  it('returns NOT_FOUND for a mismatched client', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const result = await store.authorizePack({
      packId: PACK_ID,
      clientId: OTHER_CLIENT,
      byEmail: 'pm@example.com',
      byUserId: 'user-1',
      now: NOW,
      expiresAt: EXPIRES,
      contentHash: 'c'.repeat(64),
      fingerprints: { 'item-1': 'f'.repeat(64) },
    })
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' })
  })

  it('returns ALREADY_AUTHORIZED on a second call', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const input = {
      packId: PACK_ID,
      clientId: CLIENT,
      byEmail: 'pm@example.com',
      byUserId: 'user-1',
      now: NOW,
      expiresAt: EXPIRES,
      contentHash: 'c'.repeat(64),
      fingerprints: { 'item-1': 'f'.repeat(64) },
    }
    await store.authorizePack(input)
    expect(await store.authorizePack(input)).toEqual({ ok: false, error: 'ALREADY_AUTHORIZED' })
  })

  it('returns REVOKED for a revoked pack', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await store.revokePack({ packId: PACK_ID, clientId: CLIENT, byEmail: 'pm@example.com', reason: 'stop', now: NOW })
    const result = await store.authorizePack({
      packId: PACK_ID,
      clientId: CLIENT,
      byEmail: 'pm@example.com',
      byUserId: 'user-1',
      now: NOW,
      expiresAt: EXPIRES,
      contentHash: 'c'.repeat(64),
      fingerprints: { 'item-1': 'f'.repeat(64) },
    })
    expect(result).toEqual({ ok: false, error: 'REVOKED' })
  })

  it('is all-or-nothing when a fingerprint is missing', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store, [newItem({ item_id: 'item-1' }), newItem({ item_id: 'item-2' })])
    await expect(
      store.authorizePack({
        packId: PACK_ID,
        clientId: CLIENT,
        byEmail: 'pm@example.com',
        byUserId: 'user-1',
        now: NOW,
        expiresAt: EXPIRES,
        contentHash: 'c'.repeat(64),
        fingerprints: { 'item-1': 'f'.repeat(64) },
      }),
    ).rejects.toThrow('missing fingerprint')

    const pack = await store.getPack(PACK_ID, CLIENT)
    expect(pack?.authorized_at).toBeNull()
    const items = await store.getItems(PACK_ID, CLIENT)
    expect(items.every((item) => item.authorized_fingerprint === null)).toBe(true)
  })
})

describe('revokePack', () => {
  it('revokes a pack that was never authorised', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const revoked = await store.revokePack({
      packId: PACK_ID,
      clientId: CLIENT,
      byEmail: 'pm@example.com',
      reason: 'stop',
      now: NOW,
    })
    expect(revoked?.revoked_at).toBe(NOW.toISOString())
    expect(revoked?.revoked_reason).toBe('stop')
  })

  it('returns null for a mismatched client and for a repeat revoke', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    expect(
      await store.revokePack({ packId: PACK_ID, clientId: OTHER_CLIENT, byEmail: 'pm@example.com', reason: 'stop', now: NOW }),
    ).toBeNull()
    await store.revokePack({ packId: PACK_ID, clientId: CLIENT, byEmail: 'pm@example.com', reason: 'stop', now: NOW })
    expect(
      await store.revokePack({ packId: PACK_ID, clientId: CLIENT, byEmail: 'pm@example.com', reason: 'stop', now: NOW }),
    ).toBeNull()
  })
})

describe('listLivePacks', () => {
  it('returns only authorised, unrevoked, unexpired packs', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    expect(await store.listLivePacks(NOW)).toEqual([])

    await store.authorizePack({
      packId: PACK_ID,
      clientId: CLIENT,
      byEmail: 'pm@example.com',
      byUserId: 'user-1',
      now: NOW,
      expiresAt: EXPIRES,
      contentHash: 'c'.repeat(64),
      fingerprints: { 'item-1': 'f'.repeat(64) },
    })
    expect((await store.listLivePacks(NOW)).map((pack) => pack.id)).toEqual([PACK_ID])
    expect(await store.listLivePacks(EXPIRES)).toEqual([])

    await store.revokePack({ packId: PACK_ID, clientId: CLIENT, byEmail: 'pm@example.com', reason: 'stop', now: NOW })
    expect(await store.listLivePacks(NOW)).toEqual([])
  })
})

describe('claimItem', () => {
  it('claims a PENDING item once and increments attempt_count', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const claimed = await store.claimItem('item-1', NOW)
    expect(claimed?.status).toBe('CLAIMED')
    expect(claimed?.claimed_at).toBe(NOW.toISOString())
    expect(claimed?.attempt_count).toBe(1)
  })

  it('returns null on a second claim (race)', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await store.claimItem('item-1', NOW)
    expect(await store.claimItem('item-1', NOW)).toBeNull()
  })

  it('returns null for an unknown item', async () => {
    const store = new InMemoryLiteStore()
    expect(await store.claimItem('nope', NOW)).toBeNull()
  })
})

describe('settleItem', () => {
  async function claimedStore(): Promise<InMemoryLiteStore> {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await store.claimItem('item-1', NOW)
    return store
  }

  it('returns false when the item is not CLAIMED', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    expect(await store.settleItem({ itemId: 'item-1', to: 'FAILED', reasonCode: 'X', now: NOW })).toBe(false)
  })

  it('settles to SENT with a receipt and sets sent_at', async () => {
    const store = await claimedStore()
    const ok = await store.settleItem({
      itemId: 'item-1',
      to: 'SENT',
      reasonCode: null,
      providerReceipt: 'story-123',
      now: NOW,
    })
    expect(ok).toBe(true)
    const item = (await store.getItems(PACK_ID, CLIENT))[0]
    expect(item.status).toBe('SENT')
    expect(item.provider_receipt).toBe('story-123')
    expect(item.sent_at).toBe(NOW.toISOString())
  })

  it('throws when SENT has no receipt', async () => {
    const store = await claimedStore()
    await expect(store.settleItem({ itemId: 'item-1', to: 'SENT', reasonCode: null, now: NOW })).rejects.toThrow(
      'SENT needs a receipt',
    )
  })

  it('throws when a receipt is given for a non-SENT status', async () => {
    const store = await claimedStore()
    await expect(
      store.settleItem({ itemId: 'item-1', to: 'FAILED', reasonCode: 'X', providerReceipt: 'story-123', now: NOW }),
    ).rejects.toThrow('receipt only when SENT')
  })

  it('releases back to PENDING and clears claimed_at', async () => {
    const store = await claimedStore()
    const ok = await store.settleItem({ itemId: 'item-1', to: 'PENDING', reasonCode: null, now: NOW })
    expect(ok).toBe(true)
    const item = (await store.getItems(PACK_ID, CLIENT))[0]
    expect(item.status).toBe('PENDING')
    expect(item.claimed_at).toBeNull()
  })
})

describe('recordCheck', () => {
  it('records the last check without changing status', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await store.recordCheck('item-1', 'ok', NOW)
    const item = (await store.getItems(PACK_ID, CLIENT))[0]
    expect(item.last_check_at).toBe(NOW.toISOString())
    expect(item.last_check_result).toBe('ok')
    expect(item.status).toBe('PENDING')
  })

  it('throws for an unknown item', async () => {
    const store = new InMemoryLiteStore()
    await expect(store.recordCheck('nope', 'ok', NOW)).rejects.toThrow('unknown item')
  })
})

describe('expireStaleClaims', () => {
  it('turns old CLAIMED rows into UNKNOWN_OUTCOME', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await store.claimItem('item-1', new Date('2026-10-12T00:00:00.000Z'))
    const ids = await store.expireStaleClaims(new Date('2026-10-12T01:00:00.000Z'), 30 * 60 * 1000)
    expect(ids).toEqual(['item-1'])
    const item = (await store.getItems(PACK_ID, CLIENT))[0]
    expect(item.status).toBe('UNKNOWN_OUTCOME')
    expect(item.reason_code).toBe('STALE_CLAIM')
  })

  it('leaves fresh claims alone', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    await store.claimItem('item-1', new Date('2026-10-12T00:00:00.000Z'))
    const ids = await store.expireStaleClaims(new Date('2026-10-12T00:10:00.000Z'), 30 * 60 * 1000)
    expect(ids).toEqual([])
    expect((await store.getItems(PACK_ID, CLIENT))[0].status).toBe('CLAIMED')
  })
})

describe('getClientRegistration', () => {
  it('returns the seeded registration or null', async () => {
    const store = new InMemoryLiteStore()
    const registration: ClientRegistration = { facebook_page_id: '1234567890', client_status: 'active' }
    store.seedClient(CLIENT, registration)
    expect(await store.getClientRegistration(CLIENT)).toEqual(registration)
    expect(await store.getClientRegistration(OTHER_CLIENT)).toBeNull()
  })

  it('returns a copy', async () => {
    const store = new InMemoryLiteStore()
    store.seedClient(CLIENT, { facebook_page_id: '1234567890', client_status: 'active' })
    const registration = await store.getClientRegistration(CLIENT)
    if (registration) registration.client_status = 'mutated'
    expect((await store.getClientRegistration(CLIENT))?.client_status).toBe('active')
  })
})

describe('allPacks / allItems', () => {
  it('returns copies of everything', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const packs = store.allPacks()
    const items = store.allItems()
    packs[0].title = 'mutated'
    items[0].status = 'SENT'
    expect(store.allPacks()[0].title).toBe('Week 1')
    expect(store.allItems()[0].status).toBe('PENDING')
  })

  it('exposes a full item shape', async () => {
    const store = new InMemoryLiteStore()
    await seedPack(store)
    const item = store.allItems()[0]
    expect(item).toEqual(fullItem())
  })
})

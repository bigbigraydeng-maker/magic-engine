/**
 * Draft tests for the in-memory StoryStore implementation.
 *
 * These exercise the rules the real database enforces: single live grant per
 * pack, item linkage validation, idempotent opens, copy semantics, client
 * isolation and the asset-usage default.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryStoryStore } from '../in-memory-store'
import type { NewStoryAuthorization, StoredStoryItem } from '../store'
import type { StoryChannel, StoryItemSpec } from '../types'

function makeItem(overrides: Partial<StoredStoryItem> = {}): StoredStoryItem {
  const base: StoryItemSpec = {
    item_id: 'item-1',
    pack_id: 'pack-1',
    client_id: 'client-1',
    channel: 'facebook_story',
    slot_at: '2026-10-12T09:00:00.000Z',
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello',
    account_id: 'page-1',
    source_record_ids: ['rec-1'],
    website_ref: 'https://example.com/page',
    website_checked_on: '2026-10-11',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
  }
  return {
    ...base,
    ...overrides,
    authorization_id: overrides.authorization_id ?? null,
    paused_at: overrides.paused_at ?? null,
  }
}

function makeAuthRow(
  overrides: Partial<NewStoryAuthorization> = {},
): NewStoryAuthorization {
  return {
    pack_id: 'pack-1',
    client_id: 'client-1',
    authorized_by_email: 'pm@example.com',
    authorized_by_user_id: 'user-1',
    authorized_at: '2026-10-12T08:00:00.000Z',
    expires_at: '2026-10-12T20:00:00.000Z',
    manifest_hash: 'manifest-hash',
    approved_item_fingerprints: { 'item-1:facebook_story': 'fp-1' },
    request_id: 'req-1',
    ...overrides,
  }
}

describe('InMemoryStoryStore', () => {
  describe('getPackItems', () => {
    it('returns items of the pack and client sorted by slot, item id, channel', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([
        makeItem({ item_id: 'b', slot_at: '2026-10-12T10:00:00.000Z' }),
        makeItem({ item_id: 'a', slot_at: '2026-10-12T10:00:00.000Z' }),
        makeItem({ item_id: 'a0', slot_at: '2026-10-12T09:00:00.000Z' }),
        makeItem({
          item_id: 'a0',
          slot_at: '2026-10-12T09:00:00.000Z',
          channel: 'instagram_story',
        }),
      ])
      const items = await store.getPackItems('pack-1', 'client-1')
      expect(items.map((i) => `${i.slot_at}|${i.item_id}|${i.channel}`)).toEqual([
        '2026-10-12T09:00:00.000Z|a0|facebook_story',
        '2026-10-12T09:00:00.000Z|a0|instagram_story',
        '2026-10-12T10:00:00.000Z|a|facebook_story',
        '2026-10-12T10:00:00.000Z|b|facebook_story',
      ])
    })

    it('isolates clients sharing a pack id', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([
        makeItem({ client_id: 'client-1' }),
        makeItem({ client_id: 'client-2' }),
      ])
      const items = await store.getPackItems('pack-1', 'client-2')
      expect(items).toHaveLength(1)
      expect(items[0].client_id).toBe('client-2')
    })

    it('returns deep copies', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([makeItem()])
      const items = await store.getPackItems('pack-1', 'client-1')
      items[0].source_record_ids.push('mutated')
      items[0].text_line = 'mutated'
      const again = await store.getPackItems('pack-1', 'client-1')
      expect(again[0].source_record_ids).toEqual(['rec-1'])
      expect(again[0].text_line).toBe('Hello')
    })
  })

  describe('authorization lifecycle', () => {
    it('inserts an inactive grant and returns a copy', async () => {
      const store = new InMemoryStoryStore()
      const result = await store.insertAuthorization(makeAuthRow())
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.authorization.activated_at).toBeNull()
      expect(result.authorization.revoked_at).toBeNull()
      expect(result.authorization.id).toBeTruthy()
      result.authorization.manifest_hash = 'mutated'
      const live = await store.getLiveAuthorization('pack-1', 'client-1')
      expect(live?.manifest_hash).toBe('manifest-hash')
    })

    it('rejects a second live grant for the same pack', async () => {
      const store = new InMemoryStoryStore()
      await store.insertAuthorization(makeAuthRow())
      const second = await store.insertAuthorization(makeAuthRow())
      expect(second).toEqual({ ok: false, error: 'ALREADY_AUTHORIZED' })
    })

    it('allows a new grant after the previous one is revoked', async () => {
      const store = new InMemoryStoryStore()
      const first = await store.insertAuthorization(makeAuthRow())
      if (!first.ok) throw new Error('expected ok')
      await store.revokeAuthorization({
        authId: first.authorization.id,
        packId: 'pack-1',
        clientId: 'client-1',
        byEmail: 'pm@example.com',
        reason: 'changed mind',
        now: new Date('2026-10-12T09:00:00.000Z'),
      })
      const second = await store.insertAuthorization(makeAuthRow())
      expect(second.ok).toBe(true)
    })

    it('activates once and is idempotent', async () => {
      const store = new InMemoryStoryStore()
      const inserted = await store.insertAuthorization(makeAuthRow())
      if (!inserted.ok) throw new Error('expected ok')
      const id = inserted.authorization.id
      const first = await store.activateAuthorization(id, 'client-1')
      expect(first?.activated_at).toBeTruthy()
      const stamp = first?.activated_at
      const second = await store.activateAuthorization(id, 'client-1')
      expect(second?.activated_at).toBe(stamp)
    })

    it('returns null when activating an unknown, wrong-client or revoked grant', async () => {
      const store = new InMemoryStoryStore()
      const inserted = await store.insertAuthorization(makeAuthRow())
      if (!inserted.ok) throw new Error('expected ok')
      const id = inserted.authorization.id
      expect(await store.activateAuthorization('missing', 'client-1')).toBeNull()
      expect(await store.activateAuthorization(id, 'client-2')).toBeNull()
      await store.revokeAuthorization({
        authId: id,
        packId: 'pack-1',
        clientId: 'client-1',
        byEmail: 'pm@example.com',
        reason: 'stop',
        now: new Date('2026-10-12T09:00:00.000Z'),
      })
      expect(await store.activateAuthorization(id, 'client-1')).toBeNull()
    })

    it('revokes only the matching grant and records the reason', async () => {
      const store = new InMemoryStoryStore()
      const inserted = await store.insertAuthorization(makeAuthRow())
      if (!inserted.ok) throw new Error('expected ok')
      const id = inserted.authorization.id
      expect(
        await store.revokeAuthorization({
          authId: id,
          packId: 'other-pack',
          clientId: 'client-1',
          byEmail: 'pm@example.com',
          reason: 'wrong pack',
          now: new Date(),
        }),
      ).toBeNull()
      expect(
        await store.revokeAuthorization({
          authId: id,
          packId: 'pack-1',
          clientId: 'other-client',
          byEmail: 'pm@example.com',
          reason: 'wrong client',
          now: new Date(),
        }),
      ).toBeNull()
      const revoked = await store.revokeAuthorization({
        authId: id,
        packId: 'pack-1',
        clientId: 'client-1',
        byEmail: 'pm@example.com',
        reason: 'stop',
        now: new Date('2026-10-12T09:00:00.000Z'),
      })
      expect(revoked?.revoked_at).toBe('2026-10-12T09:00:00.000Z')
      expect(store.revocationOf(id)).toEqual({
        byEmail: 'pm@example.com',
        reason: 'stop',
        at: '2026-10-12T09:00:00.000Z',
      })
      const second = await store.revokeAuthorization({
        authId: id,
        packId: 'pack-1',
        clientId: 'client-1',
        byEmail: 'pm@example.com',
        reason: 'again',
        now: new Date(),
      })
      expect(second).toBeNull()
    })

    it('getLiveAuthorization ignores revoked grants', async () => {
      const store = new InMemoryStoryStore()
      const inserted = await store.insertAuthorization(makeAuthRow())
      if (!inserted.ok) throw new Error('expected ok')
      await store.revokeAuthorization({
        authId: inserted.authorization.id,
        packId: 'pack-1',
        clientId: 'client-1',
        byEmail: 'pm@example.com',
        reason: 'stop',
        now: new Date(),
      })
      expect(await store.getLiveAuthorization('pack-1', 'client-1')).toBeNull()
    })
  })

  describe('linkItemsToAuthorization', () => {
    it('links every listed item', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([makeItem({ item_id: 'a' }), makeItem({ item_id: 'b' })])
      await store.linkItemsToAuthorization({
        authId: 'auth-1',
        packId: 'pack-1',
        clientId: 'client-1',
        items: [
          { item_id: 'a', channel: 'facebook_story' },
          { item_id: 'b', channel: 'facebook_story' },
        ],
      })
      const items = await store.getPackItems('pack-1', 'client-1')
      expect(items.every((i) => i.authorization_id === 'auth-1')).toBe(true)
    })

    it('validates all items before changing any', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([makeItem({ item_id: 'a' })])
      await expect(
        store.linkItemsToAuthorization({
          authId: 'auth-1',
          packId: 'pack-1',
          clientId: 'client-1',
          items: [
            { item_id: 'a', channel: 'facebook_story' },
            { item_id: 'missing', channel: 'facebook_story' },
          ],
        }),
      ).rejects.toThrow('unknown item')
      const items = await store.getPackItems('pack-1', 'client-1')
      expect(items[0].authorization_id).toBeNull()
    })
  })

  describe('recordOpen', () => {
    it('is idempotent per user and fingerprint', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([makeItem()])
      const record = {
        item_id: 'item-1',
        channel: 'facebook_story' as StoryChannel,
        opened_by_user_id: 'user-1',
        opened_fingerprint: 'fp-1',
        opened_at: '2026-10-12T08:30:00.000Z',
      }
      await store.recordOpen(record)
      await store.recordOpen(record)
      const opens = await store.listOpens('pack-1')
      expect(opens).toHaveLength(1)
    })

    it('throws for an unknown item', async () => {
      const store = new InMemoryStoryStore()
      await expect(
        store.recordOpen({
          item_id: 'missing',
          channel: 'facebook_story',
          opened_by_user_id: 'user-1',
          opened_fingerprint: 'fp-1',
          opened_at: '2026-10-12T08:30:00.000Z',
        }),
      ).rejects.toThrow('unknown item')
    })

    it('returns copies from listOpens', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([makeItem()])
      await store.recordOpen({
        item_id: 'item-1',
        channel: 'facebook_story',
        opened_by_user_id: 'user-1',
        opened_fingerprint: 'fp-1',
        opened_at: '2026-10-12T08:30:00.000Z',
      })
      const opens = await store.listOpens('pack-1')
      opens[0].opened_fingerprint = 'mutated'
      const again = await store.listOpens('pack-1')
      expect(again[0].opened_fingerprint).toBe('fp-1')
    })
  })

  describe('attempts, accounts, reply duty and asset usage', () => {
    it('returns seeded attempts as copies', async () => {
      const store = new InMemoryStoryStore()
      store.seedAttempts(
        [{ item_id: 'item-1', channel: 'facebook_story', status: 'PUBLISHED' }],
        'pack-1',
      )
      const attempts = await store.listAttempts('pack-1')
      expect(attempts).toHaveLength(1)
      attempts[0].status = 'FAILED_FINAL'
      const again = await store.listAttempts('pack-1')
      expect(again[0].status).toBe('PUBLISHED')
      expect(await store.listAttempts('other-pack')).toEqual([])
    })

    it('returns seeded accounts or null', async () => {
      const store = new InMemoryStoryStore()
      store.seedAccounts('client-1', {
        facebook_page_id: 'page-1',
        instagram_user_id: 'ig-1',
        client_status: 'active',
      })
      const accounts = await store.getRegisteredAccounts('client-1')
      expect(accounts?.facebook_page_id).toBe('page-1')
      expect(await store.getRegisteredAccounts('missing')).toBeNull()
    })

    it('reports reply duty only when seeded', async () => {
      const store = new InMemoryStoryStore()
      store.seedReplyDuty('client-1', '2026-10-12')
      expect(await store.hasReplyOwner('client-1', '2026-10-12')).toBe(true)
      expect(await store.hasReplyOwner('client-1', '2026-10-13')).toBe(false)
    })

    it('defaults asset usage to UNKNOWN', async () => {
      const store = new InMemoryStoryStore()
      expect(await store.getAssetUsage('a'.repeat(64))).toBe('UNKNOWN')
      store.seedAssetUsage('a'.repeat(64), 'USED')
      expect(await store.getAssetUsage('a'.repeat(64))).toBe('USED')
    })
  })

  describe('read helpers', () => {
    it('allAuthorizations and allItems return copies', async () => {
      const store = new InMemoryStoryStore()
      store.seedItems([makeItem()])
      await store.insertAuthorization(makeAuthRow())
      const auths = store.allAuthorizations()
      auths[0].manifest_hash = 'mutated'
      expect(store.allAuthorizations()[0].manifest_hash).toBe('manifest-hash')
      const items = store.allItems()
      items[0].text_line = 'mutated'
      expect(store.allItems()[0].text_line).toBe('Hello')
    })
  })
})

describe('linkItemsToAuthorization scope', () => {
  it('treats an item of another pack or client as unknown and changes nothing', async () => {
    const store = new InMemoryStoryStore()
    store.seedItems([makeItem({ item_id: 'a' }), makeItem({ item_id: 'other', pack_id: 'pack-2' })])
    await expect(
      store.linkItemsToAuthorization({
        authId: 'auth-1',
        packId: 'pack-1',
        clientId: 'client-1',
        items: [
          { item_id: 'a', channel: 'facebook_story' },
          { item_id: 'other', channel: 'facebook_story' },
        ],
      }),
    ).rejects.toThrow('unknown item')
    expect(store.allItems().every((i) => i.authorization_id === null)).toBe(true)

    await expect(
      store.linkItemsToAuthorization({
        authId: 'auth-1',
        packId: 'pack-1',
        clientId: 'client-other',
        items: [{ item_id: 'a', channel: 'facebook_story' }],
      }),
    ).rejects.toThrow('unknown item')
  })
})

describe('getActivePauses', () => {
  it('returns only the active marks of that pack and client, as copies', async () => {
    const store = new InMemoryStoryStore()
    store.seedPause('pack-1', 'client-1', { channel: null, item_id: null })
    store.seedPause('pack-1', 'client-1', { channel: 'facebook_story', item_id: 'a' }, true)
    store.seedPause('pack-2', 'client-1', { channel: null, item_id: null })
    store.seedPause('pack-1', 'client-2', { channel: null, item_id: null })
    const marks = await store.getActivePauses('pack-1', 'client-1')
    expect(marks).toEqual([{ channel: null, item_id: null }])
    marks[0].channel = 'instagram_story'
    expect(await store.getActivePauses('pack-1', 'client-1')).toEqual([{ channel: null, item_id: null }])
  })
})

describe('recordOpen renewal', () => {
  it('writes a new record when the same person opens the same version on a later UTC day', async () => {
    const store = new InMemoryStoryStore()
    store.seedItems([makeItem()])
    const base = {
      item_id: 'item-1',
      channel: 'facebook_story' as StoryChannel,
      opened_by_user_id: 'user-1',
      opened_fingerprint: 'a'.repeat(64),
    }
    await store.recordOpen({ ...base, opened_at: '2026-10-12T10:00:00.000Z' })
    await store.recordOpen({ ...base, opened_at: '2026-10-12T23:00:00.000Z' })
    expect(await store.listOpens('pack-1')).toHaveLength(1)
    await store.recordOpen({ ...base, opened_at: '2026-10-13T11:00:00.000Z' })
    expect(await store.listOpens('pack-1')).toHaveLength(2)
  })
})

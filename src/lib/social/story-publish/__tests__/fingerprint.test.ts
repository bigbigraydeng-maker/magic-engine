import { describe, expect, it } from 'vitest'
import {
  canonicalFingerprintInput,
  computeContentFingerprint,
  computeContentManifestHash,
  computeItemFingerprint,
  computeManifestHash,
} from '../fingerprint'
import { storyItemKey, type StoryItemSpec } from '../types'

const EXPIRES_AT = '2026-11-01T00:00:00.000Z'

function baseItem(): StoryItemSpec {
  return {
    item_id: 'item-0001',
    pack_id: 'pack-0001',
    client_id: '00000000-0000-0000-0000-000000000001',
    channel: 'facebook_story',
    slot_at: '2026-10-20T09:00:00.000Z',
    media_kind: 'image',
    media_url: 'https://cdn.example.com/story/item-0001.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Did you know this?',
    account_id: 'page-1234567890',
    source_record_ids: ['record-a', 'record-b'],
    website_ref: 'https://example.com/facts/item-0001',
    website_checked_on: '2026-10-10',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
  }
}

const HEX_64 = /^[0-9a-f]{64}$/

describe('computeItemFingerprint', () => {
  it('returns 64 lowercase hex characters', () => {
    const hash = computeItemFingerprint(baseItem(), EXPIRES_AT)
    expect(hash).toMatch(HEX_64)
  })

  it('is stable for the same item and expiry', () => {
    const first = computeItemFingerprint(baseItem(), EXPIRES_AT)
    const second = computeItemFingerprint(baseItem(), EXPIRES_AT)
    expect(first).toBe(second)
  })

  it('does not depend on the key order of the input object', () => {
    const item = baseItem()
    const reordered: StoryItemSpec = {
      has_reply_cta: item.has_reply_cta,
      contains_price: item.contains_price,
      names_place: item.names_place,
      website_checked_on: item.website_checked_on,
      website_ref: item.website_ref,
      source_record_ids: item.source_record_ids,
      account_id: item.account_id,
      text_line: item.text_line,
      media_sha256: item.media_sha256,
      media_url: item.media_url,
      media_kind: item.media_kind,
      slot_at: item.slot_at,
      channel: item.channel,
      client_id: item.client_id,
      pack_id: item.pack_id,
      item_id: item.item_id,
    }

    expect(computeItemFingerprint(reordered, EXPIRES_AT)).toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
  })

  it('changes when any single field changes', () => {
    const baseHash = computeItemFingerprint(baseItem(), EXPIRES_AT)

    const mutations: Array<{ name: string; mutate: (item: StoryItemSpec) => StoryItemSpec }> = [
      { name: 'item_id', mutate: (i) => ({ ...i, item_id: i.item_id + 'x' }) },
      { name: 'pack_id', mutate: (i) => ({ ...i, pack_id: i.pack_id + 'x' }) },
      { name: 'client_id', mutate: (i) => ({ ...i, client_id: i.client_id + 'x' }) },
      {
        name: 'channel',
        mutate: (i) => ({
          ...i,
          channel: i.channel === 'facebook_story' ? 'instagram_story' : 'facebook_story',
        }),
      },
      { name: 'slot_at', mutate: (i) => ({ ...i, slot_at: i.slot_at + 'x' }) },
      {
        name: 'media_kind',
        mutate: (i) => ({ ...i, media_kind: i.media_kind === 'image' ? 'video' : 'image' }),
      },
      { name: 'media_url', mutate: (i) => ({ ...i, media_url: i.media_url + 'x' }) },
      { name: 'media_sha256', mutate: (i) => ({ ...i, media_sha256: i.media_sha256 + 'x' }) },
      { name: 'text_line', mutate: (i) => ({ ...i, text_line: i.text_line + 'x' }) },
      { name: 'account_id', mutate: (i) => ({ ...i, account_id: i.account_id + 'x' }) },
      {
        name: 'source_record_ids',
        mutate: (i) => ({ ...i, source_record_ids: [...i.source_record_ids, 'record-c'] }),
      },
      { name: 'website_ref', mutate: (i) => ({ ...i, website_ref: i.website_ref + 'x' }) },
      {
        name: 'website_checked_on',
        mutate: (i) => ({ ...i, website_checked_on: i.website_checked_on + 'x' }),
      },
      { name: 'has_reply_cta', mutate: (i) => ({ ...i, has_reply_cta: !i.has_reply_cta }) },
      { name: 'contains_price', mutate: (i) => ({ ...i, contains_price: !i.contains_price }) },
      { name: 'names_place', mutate: (i) => ({ ...i, names_place: !i.names_place }) },
    ]

    const hashes = mutations.map(({ name, mutate }) => {
      const hash = computeItemFingerprint(mutate(baseItem()), EXPIRES_AT)
      expect(hash, `mutation of ${name} should change the hash`).not.toBe(baseHash)
      return hash
    })

    // Every mutation must also be distinct from every other mutation.
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('is insensitive to the order of source_record_ids but sensitive to their content', () => {
    const item = baseItem()
    const reversed: StoryItemSpec = { ...item, source_record_ids: ['record-b', 'record-a'] }
    const changed: StoryItemSpec = { ...item, source_record_ids: ['record-a', 'record-c'] }

    expect(computeItemFingerprint(reversed, EXPIRES_AT)).toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
    expect(computeItemFingerprint(changed, EXPIRES_AT)).not.toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
  })

  it('changes when expiresAt changes', () => {
    const item = baseItem()
    expect(computeItemFingerprint(item, '2026-11-02T00:00:00.000Z')).not.toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
  })

  it('does not mutate the input item', () => {
    const item = baseItem()
    const clone: StoryItemSpec = { ...item, source_record_ids: [...item.source_record_ids] }

    computeItemFingerprint(item, EXPIRES_AT)

    expect(item).toEqual(clone)
  })
})

describe('canonicalFingerprintInput', () => {
  it('serialises the fields in the fixed canonical order', () => {
    const item = baseItem()
    const parsed = JSON.parse(canonicalFingerprintInput(item, EXPIRES_AT)) as Record<string, unknown>

    expect(Object.keys(parsed)).toEqual([
      'item_id',
      'pack_id',
      'client_id',
      'channel',
      'slot_at',
      'media_kind',
      'media_url',
      'media_sha256',
      'text_line',
      'account_id',
      'source_record_ids',
      'website_ref',
      'website_checked_on',
      'has_reply_cta',
      'contains_price',
      'names_place',
      'expires_at',
    ])
  })

  it('sorts source_record_ids without mutating the input array', () => {
    const item = baseItem()
    const original = [...item.source_record_ids]

    const parsed = JSON.parse(canonicalFingerprintInput(item, EXPIRES_AT)) as {
      source_record_ids: string[]
    }

    expect(parsed.source_record_ids).toEqual([...original].sort())
    expect(item.source_record_ids).toEqual(original)
  })
})

describe('computeManifestHash', () => {
  function itemA(): StoryItemSpec {
    return baseItem()
  }

  function itemB(): StoryItemSpec {
    return { ...baseItem(), item_id: 'item-0002' }
  }

  function itemC(): StoryItemSpec {
    return { ...baseItem(), item_id: 'item-0003' }
  }

  it('returns 64 lowercase hex characters', () => {
    const hash = computeManifestHash([itemA(), itemB()], EXPIRES_AT)
    expect(hash).toMatch(HEX_64)
  })

  it('is stable for the same items and expiry', () => {
    const first = computeManifestHash([itemA(), itemB()], EXPIRES_AT)
    const second = computeManifestHash([itemA(), itemB()], EXPIRES_AT)
    expect(first).toBe(second)
  })

  it('is independent of the order of the input items', () => {
    const forward = computeManifestHash([itemA(), itemB(), itemC()], EXPIRES_AT)
    const reversed = computeManifestHash([itemC(), itemB(), itemA()], EXPIRES_AT)
    const shuffled = computeManifestHash([itemB(), itemA(), itemC()], EXPIRES_AT)

    expect(reversed).toBe(forward)
    expect(shuffled).toBe(forward)
  })

  it('changes when any single item changes', () => {
    const baseHash = computeManifestHash([itemA(), itemB()], EXPIRES_AT)

    const mutations: Array<{ name: string; mutate: (item: StoryItemSpec) => StoryItemSpec }> = [
      { name: 'item_id', mutate: (i) => ({ ...i, item_id: i.item_id + 'x' }) },
      { name: 'pack_id', mutate: (i) => ({ ...i, pack_id: i.pack_id + 'x' }) },
      { name: 'client_id', mutate: (i) => ({ ...i, client_id: i.client_id + 'x' }) },
      {
        name: 'channel',
        mutate: (i) => ({
          ...i,
          channel: i.channel === 'facebook_story' ? 'instagram_story' : 'facebook_story',
        }),
      },
      { name: 'slot_at', mutate: (i) => ({ ...i, slot_at: i.slot_at + 'x' }) },
      {
        name: 'media_kind',
        mutate: (i) => ({ ...i, media_kind: i.media_kind === 'image' ? 'video' : 'image' }),
      },
      { name: 'media_url', mutate: (i) => ({ ...i, media_url: i.media_url + 'x' }) },
      { name: 'media_sha256', mutate: (i) => ({ ...i, media_sha256: i.media_sha256 + 'x' }) },
      { name: 'text_line', mutate: (i) => ({ ...i, text_line: i.text_line + 'x' }) },
      { name: 'account_id', mutate: (i) => ({ ...i, account_id: i.account_id + 'x' }) },
      {
        name: 'source_record_ids',
        mutate: (i) => ({ ...i, source_record_ids: [...i.source_record_ids, 'record-c'] }),
      },
      { name: 'website_ref', mutate: (i) => ({ ...i, website_ref: i.website_ref + 'x' }) },
      {
        name: 'website_checked_on',
        mutate: (i) => ({ ...i, website_checked_on: i.website_checked_on + 'x' }),
      },
      { name: 'has_reply_cta', mutate: (i) => ({ ...i, has_reply_cta: !i.has_reply_cta }) },
      { name: 'contains_price', mutate: (i) => ({ ...i, contains_price: !i.contains_price }) },
      { name: 'names_place', mutate: (i) => ({ ...i, names_place: !i.names_place }) },
    ]

    for (const { name, mutate } of mutations) {
      const hash = computeManifestHash([mutate(itemA()), itemB()], EXPIRES_AT)
      expect(hash, `mutation of ${name} should change the manifest hash`).not.toBe(baseHash)
    }
  })

  it('changes when an item is added or removed', () => {
    const two = computeManifestHash([itemA(), itemB()], EXPIRES_AT)
    const three = computeManifestHash([itemA(), itemB(), itemC()], EXPIRES_AT)
    const one = computeManifestHash([itemA()], EXPIRES_AT)

    expect(three).not.toBe(two)
    expect(one).not.toBe(two)
  })

  it('changes when expiresAt changes', () => {
    const items = [itemA(), itemB()]
    expect(computeManifestHash(items, '2026-11-02T00:00:00.000Z')).not.toBe(
      computeManifestHash(items, EXPIRES_AT),
    )
  })

  it('allows an empty list and gives a stable hash', () => {
    const first = computeManifestHash([], EXPIRES_AT)
    const second = computeManifestHash([], EXPIRES_AT)

    expect(first).toMatch(HEX_64)
    expect(first).toBe(second)
  })

  it('throws on a duplicate item key (same item_id and channel)', () => {
    const duplicate = [itemA(), itemA()]

    expect(() => computeManifestHash(duplicate, EXPIRES_AT)).toThrow(
      'computeManifestHash: duplicate item key',
    )
  })

  it('treats the same item_id on two different channels as two distinct keys', () => {
    const facebook = itemA()
    const instagram: StoryItemSpec = { ...itemA(), channel: 'instagram_story' }

    expect(storyItemKey(facebook)).not.toBe(storyItemKey(instagram))

    expect(() => computeManifestHash([facebook, instagram], EXPIRES_AT)).not.toThrow()
    expect(computeManifestHash([facebook, instagram], EXPIRES_AT)).toMatch(HEX_64)
  })

  it('does not mutate the input array', () => {
    const items = [itemC(), itemA(), itemB()]
    const original = [...items]

    computeManifestHash(items, EXPIRES_AT)

    expect(items).toEqual(original)
    expect(items.map((item) => item.item_id)).toEqual(['item-0003', 'item-0001', 'item-0002'])
  })
})

describe('instant spelling', () => {
  it('fingerprints the same moment identically however it is written', () => {
    const a = computeItemFingerprint({ ...baseItem(), slot_at: '2026-10-12T09:00:00Z' }, '2026-10-19T09:00:00Z')
    const b = computeItemFingerprint({ ...baseItem(), slot_at: '2026-10-12T09:00:00.000Z' }, '2026-10-19T09:00:00.000+00:00')
    expect(a).toBe(b)
  })

  it('still changes when the moment itself changes', () => {
    const a = computeItemFingerprint({ ...baseItem(), slot_at: '2026-10-12T09:00:00Z' }, '2026-10-19T09:00:00Z')
    const b = computeItemFingerprint({ ...baseItem(), slot_at: '2026-10-12T09:00:01Z' }, '2026-10-19T09:00:00Z')
    expect(a).not.toBe(b)
  })

  it('never lets an unreadable instant equal a real one', () => {
    const a = computeItemFingerprint({ ...baseItem(), slot_at: 'not a date' }, '2026-10-19T09:00:00Z')
    const b = computeItemFingerprint({ ...baseItem(), slot_at: '1970-01-01T00:00:00.000Z' }, '2026-10-19T09:00:00Z')
    expect(a).not.toBe(b)
  })
})

describe('computeContentFingerprint', () => {
  it('is 64 hex, stable, and independent of any expiry', () => {
    const a = computeContentFingerprint(baseItem())
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(computeContentFingerprint(baseItem())).toBe(a)
    // it must differ from the expiry-bound fingerprint
    expect(a).not.toBe(computeItemFingerprint(baseItem(), EXPIRES_AT))
  })

  it('changes when any content field changes', () => {
    const base = computeContentFingerprint(baseItem())
    const changed: StoryItemSpec[] = [
      { ...baseItem(), text_line: 'other' },
      { ...baseItem(), media_sha256: 'b'.repeat(64) },
      { ...baseItem(), contains_price: !baseItem().contains_price },
      { ...baseItem(), names_place: !baseItem().names_place },
      { ...baseItem(), slot_at: '2026-10-13T09:00:00.000Z' },
    ]
    for (const item of changed) expect(computeContentFingerprint(item)).not.toBe(base)
  })

  it('treats two spellings of the same instant as equal', () => {
    const a = computeContentFingerprint({ ...baseItem(), slot_at: '2026-10-12T09:00:00Z' })
    const b = computeContentFingerprint({ ...baseItem(), slot_at: '2026-10-12T09:00:00.000+00:00' })
    expect(a).toBe(b)
  })
})

describe('computeContentManifestHash lifetime', () => {
  it('binds the previewed lifetime when one is given and stays unbound otherwise', () => {
    const items = [baseItem()]
    const plain = computeContentManifestHash(items)
    expect(computeContentManifestHash(items)).toBe(plain)
    const seven = computeContentManifestHash(items, { lifetimeDays: 7 })
    const fourteen = computeContentManifestHash(items, { lifetimeDays: 14 })
    expect(seven).not.toBe(fourteen)
    expect(seven).not.toBe(plain)
    expect(computeContentManifestHash(items, { lifetimeDays: 7 })).toBe(seven)
  })
})
